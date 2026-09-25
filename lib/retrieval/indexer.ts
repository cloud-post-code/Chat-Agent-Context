import { prisma } from "../db";
import { chunkText } from "./chunking";
import { embedModelName, embedTexts, vecToBytes } from "./embed";
import {
  extractEntities,
  entityKey,
  MAX_KNOWN_IN_PROMPT,
  type EntityExtractor,
  type ExtractedGraph,
} from "./entities";

/**
 * Indexing for one *origin* — any admin surface whose content the chatbot
 * should be able to retrieve: a Source, the Profile, the Persona, a Project, a
 * Photo, or an approved answer (see `origins.ts` for what each contributes).
 *
 * Chunk the text, embed each chunk, extract entities + relations, and persist
 * chunks / entities / mentions / edges. Idempotent — an origin's chunks are
 * replaced wholesale, entities and edges are upserted, so entities named in
 * two different origins converge on one row and the graph links across them.
 *
 * Everything is scoped to one user: origin ids like "profile" repeat across
 * tenants, and one tenant's graph must never link into another's.
 *
 * Callers treat this as best-effort: a thrown error must not fail the admin
 * save that triggered it, so call sites wrap it in a catch.
 */

export type IndexOpts = { extract?: EntityExtractor };

export type OriginInput = {
  /// source | profile | persona | project | photo | activity
  kind: string;
  id: string;
  /// Human-readable label used when citing this content in the prompt.
  label: string;
  text: string;
  /// Set for source-derived chunks so they cascade with the Source row.
  sourceId?: string;
};

/**
 * One user's graph writes run one at a time.
 *
 * Indexing is concurrent now — onboarding extracts several origins at once
 * (lib/onboarding/graphIndex.ts) — and the model call is the slow part, so that
 * is what overlaps. The writes must not: `persistGraph` upserts an entity and
 * only then attaches its mentions, while every graph write ends by pruning
 * entities that have none. Two interleaved writers would prune each other's
 * just-created entities out from under the mention insert. The writes are
 * milliseconds each, so queuing them costs nothing next to the calls they
 * follow. In-process, like the onboarding job that needs it.
 */
const graphWrites: Map<string, Promise<void>> =
  ((globalThis as Record<string, unknown>).__graphWrites as Map<string, Promise<void>>) ??
  new Map<string, Promise<void>>();
(globalThis as Record<string, unknown>).__graphWrites = graphWrites;

function withGraphLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const run = (graphWrites.get(userId) ?? Promise.resolve()).then(fn);
  // The queue's tail never rejects, so one failed write doesn't fail the next.
  const tail = run.then(() => {}, () => {});
  graphWrites.set(userId, tail);
  void tail.then(() => {
    if (graphWrites.get(userId) === tail) graphWrites.delete(userId);
  });
  return run;
}

/**
 * Retract everything an origin contributed: its chunks (mentions cascade with
 * them), its ownership of extracted relations, and any entity left with nothing
 * supporting it. Deleting content is the admin's retraction mechanism, so it has
 * to reach the graph too — a relation whose last owner is gone would otherwise
 * keep being fed to the model as fact long after its source was deleted.
 */
export async function dropOrigin(userId: string, kind: string, id: string): Promise<void> {
  await prisma.chunk.deleteMany({ where: { userId, originKind: kind, originId: id } });
  await withGraphLock(userId, async () => {
    await retractEdgeOwnership(userId, kind, id);
    await pruneUnsupportedEntities(userId);
  });
}

/**
 * Drop this origin's claim on every relation it asserted, then delete the ones
 * left with no owner at all.
 *
 * Scoped to edges this origin actually owned: an edge with no ownership rows is
 * either hand-added on the Graph tab or predates provenance, and neither may be
 * swept up here.
 */
async function retractEdgeOwnership(userId: string, kind: string, id: string): Promise<void> {
  const owned = await prisma.entityEdgeOrigin.findMany({
    where: { userId, originKind: kind, originId: id },
    select: { edgeId: true },
  });
  if (!owned.length) return;

  const edgeIds = [...new Set(owned.map((o) => o.edgeId))];
  await prisma.entityEdgeOrigin.deleteMany({
    where: { userId, originKind: kind, originId: id },
  });
  await prisma.entityEdge.deleteMany({
    where: { id: { in: edgeIds }, origins: { none: {} } },
  });
}

/**
 * Delete entities nothing supports any more — no chunk mentions them and no
 * relation needs them as an endpoint. An entity with no mentions but a live
 * edge is kept on purpose: the extractor creates edge endpoints it never
 * describes, and they still carry the relation.
 */
async function pruneUnsupportedEntities(userId: string): Promise<void> {
  await prisma.entity.deleteMany({
    where: { userId, mentions: { none: {} }, edgesOut: { none: {} }, edgesIn: { none: {} } },
  });
}

/**
 * Clear an origin's chunks, including rows written before the origin columns
 * existed. Those legacy rows carry an empty `originId`, so matching on
 * kind+id alone would leave them behind as duplicates of the content we are
 * about to rewrite.
 *
 * Chunks only — graph claims are rewritten by `persistGraph` once extraction
 * has actually returned. Retracting them here instead would mean a flaky
 * extraction call silently deletes relations the origin still asserts.
 */
async function clearOriginChunks(userId: string, origin: OriginInput): Promise<void> {
  await prisma.chunk.deleteMany({
    where: { userId, originKind: origin.kind, originId: origin.id },
  });
  if (origin.sourceId) {
    await prisma.chunk.deleteMany({
      where: { userId, sourceId: origin.sourceId, originId: "" },
    });
  }
}

export async function indexOrigin(
  userId: string,
  origin: OriginInput,
  opts: IndexOpts = {},
): Promise<void> {
  const text = origin.text.trim();
  // An origin with no text asserts nothing — retract its claims as well as its
  // chunks, the same as if it had been deleted.
  if (!text) {
    await clearOriginChunks(userId, origin);
    return dropOrigin(userId, origin.kind, origin.id);
  }

  const pieces = chunkText(text);
  const { vectors, model } = await embedTexts(pieces);

  // Replace this origin's chunks (mentions cascade away with them).
  await clearOriginChunks(userId, origin);
  const written: { id: string; text: string }[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const v = vectors[i];
    const c = await prisma.chunk.create({
      data: {
        userId,
        originKind: origin.kind,
        originId: origin.id,
        originLabel: origin.label,
        sourceId: origin.sourceId ?? null,
        seq: i,
        text: pieces[i],
        embedding: v ? vecToBytes(v) : null,
        embedModel: v ? model : null,
      },
      select: { id: true, text: true },
    });
    written.push(c);
  }

  // Names already in the graph steer the extractor toward reusing canonical
  // spellings instead of forking variants ("Blake" vs "Blake Mauri").
  // Most-mentioned first so the best-established names survive the prompt cap.
  // Best-effort: an empty list only costs dedup quality, never the index.
  const known = await prisma.entity
    .findMany({
      where: { userId },
      select: { name: true },
      orderBy: { mentions: { _count: "desc" } },
      take: MAX_KNOWN_IN_PROMPT,
    })
    .then((rows) => rows.map((r) => r.name))
    .catch(() => [] as string[]);

  // Entity extraction is the only model call here; keep it best-effort so a
  // flaky extraction never loses the chunks we just wrote.
  let graph: ExtractedGraph;
  try {
    graph = await (opts.extract ?? extractEntities)(text, origin.label, known);
  } catch {
    return;
  }
  await persistGraph(userId, graph, written, origin);
}

/** Index one Source (the Knowledge tab's links, PDFs and notes). */
export async function indexSource(
  userId: string,
  sourceId: string,
  opts: IndexOpts = {},
): Promise<void> {
  const src = await prisma.source.findFirst({ where: { id: sourceId, userId } });
  if (!src) return dropOrigin(userId, "source", sourceId);

  const label = src.title ?? src.url ?? src.filename ?? "source";
  await indexOrigin(
    userId,
    {
      kind: "source",
      id: sourceId,
      label,
      sourceId,
      text: (src.rawText ?? "").trim() || (src.summary ?? "").trim(),
    },
    opts,
  );
}

/** How many unembedded chunks go into one embedding request. */
const EMBED_BACKFILL_BATCH = 32;

export type EmbedBackfill = {
  /// Chunks found carrying no embedding.
  attempted: number;
  /// How many now have one. Short of `attempted` means the provider failed.
  embedded: number;
  /// Model the new vectors were written with.
  model: string;
};

/**
 * Embed one user's chunks that have no embedding, and nothing else.
 *
 * A provider hiccup during indexing leaves chunks unembedded on purpose (see
 * `embed.ts`): the text, its mentions and the graph it fed are all intact and
 * still lexically searchable — only the vector is missing, so cosine can never
 * reach them. Repairing that needs the embedding call and nothing more, which
 * is why this deliberately does NOT re-run `indexOrigin`: that would re-chunk
 * unchanged text, spend a Claude extraction call per origin, and rewrite edges
 * that were never wrong.
 *
 * Vectors are written with the CURRENT model — the same one `retrieve()`
 * embeds the visitor's question with — so a repaired chunk is comparable to
 * queries even when the rest of the index sits on an older provider. Chunks
 * that already carry an embedding are never touched, whatever produced them:
 * closing a gap must not become a silent migration of the whole index.
 *
 * Fails soft, the same way indexing does. A failed batch comes back as null
 * vectors, those rows stay null, and the shortfall is reported in the result
 * rather than discarding the batches that worked.
 */
export async function embedMissingChunks(
  userId: string,
  opts: { batchSize?: number; embed?: typeof embedTexts } = {},
): Promise<EmbedBackfill> {
  const batchSize = Math.max(1, opts.batchSize ?? EMBED_BACKFILL_BATCH);
  const embed = opts.embed ?? embedTexts;

  const pending = await prisma.chunk.findMany({
    where: { userId, embedding: null },
    select: { id: true, text: true },
  });

  let embedded = 0;
  let model = embedModelName();
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const res = await embed(batch.map((c) => c.text));
    model = res.model;
    for (let j = 0; j < batch.length; j++) {
      const v = res.vectors[j];
      if (!v) continue; // provider failed — stays null, and the count says so
      await prisma.chunk.update({
        where: { id: batch[j].id },
        data: { embedding: vecToBytes(v), embedModel: res.model },
      });
      embedded++;
    }
  }

  return { attempted: pending.length, embedded, model };
}

export function persistGraph(
  userId: string,
  graph: ExtractedGraph,
  chunks: { id: string; text: string }[],
  origin: OriginInput,
): Promise<void> {
  return withGraphLock(userId, () => writeGraph(userId, graph, chunks, origin));
}

async function writeGraph(
  userId: string,
  graph: ExtractedGraph,
  chunks: { id: string; text: string }[],
  origin: OriginInput,
): Promise<void> {
  // Ownership this origin held going in. Re-indexing re-asserts what the text
  // still says, so anything it drops has to lose this origin as an owner —
  // captured before the rewrite so the edges can be pruned after it.
  const priorEdgeIds = (
    await prisma.entityEdgeOrigin.findMany({
      where: { userId, originKind: origin.kind, originId: origin.id },
      select: { edgeId: true },
    })
  ).map((o) => o.edgeId);
  await prisma.entityEdgeOrigin.deleteMany({
    where: { userId, originKind: origin.kind, originId: origin.id },
  });

  // Upsert every named entity — including edge endpoints the extractor didn't
  // list (they may be described in another origin; the edge still connects).
  const wanted = new Map<string, { name: string; type: string }>();
  for (const e of graph.entities) wanted.set(entityKey(e.name), e);
  for (const e of graph.edges) {
    for (const name of [e.from, e.to]) {
      if (!wanted.has(entityKey(name))) wanted.set(entityKey(name), { name, type: "other" });
    }
  }

  const idByKey = new Map<string, string>();
  for (const [key, e] of wanted) {
    const row = await prisma.entity.upsert({
      where: { userId_key: { userId, key } },
      update: {},
      create: { userId, key, name: e.name, type: e.type },
      select: { id: true },
    });
    idByKey.set(key, row.id);
  }

  // Mentions: an entity is "in" every chunk whose text contains its name
  // (case-insensitive). Extractor-listed entities that match nowhere attach
  // to the first chunk so they stay reachable from this origin.
  const mentions: { chunkId: string; entityId: string }[] = [];
  for (const e of graph.entities) {
    const key = entityKey(e.name);
    const entityId = idByKey.get(key)!;
    const hits = chunks.filter((c) => c.text.toLowerCase().includes(key));
    for (const c of hits.length ? hits : chunks.slice(0, 1)) {
      mentions.push({ chunkId: c.id, entityId });
    }
  }
  if (mentions.length) {
    await prisma.entityMention.createMany({ data: mentions, skipDuplicates: true });
  }

  for (const e of graph.edges) {
    const fromId = idByKey.get(entityKey(e.from))!;
    const toId = idByKey.get(entityKey(e.to))!;
    const edge = await prisma.entityEdge.upsert({
      where: { fromId_toId_relation: { fromId, toId, relation: e.relation } },
      update: {},
      create: { fromId, toId, relation: e.relation },
      select: { id: true },
    });
    // Claim it for this origin. Another origin asserting the same relation
    // keeps its own row, so the edge survives until the last owner is gone.
    await prisma.entityEdgeOrigin.createMany({
      data: [{ userId, edgeId: edge.id, originKind: origin.kind, originId: origin.id }],
      skipDuplicates: true,
    });
  }

  // Relations this origin used to assert and no longer does, now unowned.
  if (priorEdgeIds.length) {
    await prisma.entityEdge.deleteMany({
      where: { id: { in: priorEdgeIds }, origins: { none: {} } },
    });
  }
  await pruneUnsupportedEntities(userId);
}

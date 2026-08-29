import { prisma } from "../db";
import { entityKey } from "./entities";
import { retrieve } from "./search";

/**
 * Read + repair layer for the extracted knowledge graph.
 *
 * The graph is written by an LLM extraction pass at ingest time
 * (`indexer.ts`), so it carries the usual extraction faults: the same thing
 * named two ways, entities nobody mentions, relations that were never stated.
 * Those faults are invisible in chat and quietly weaken one-hop expansion in
 * `search.ts`, so the admin needs to see and correct them.
 *
 * Everything here is plain data access with no request/auth context, so the
 * admin server actions stay thin wrappers and this logic stays testable.
 */

export type GraphStats = {
  /// Distinct origins feeding the graph — one per profile, persona claim,
  /// project, photo, saved source, approved answer and overview. Counts every
  /// admin surface, not just the Knowledge tab's `Source` rows, so it reads as
  /// the head of the same funnel as `chunks` and `entities`.
  sources: number;
  chunks: number;
  entities: number;
  edges: number;
  /// Chunks whose embedding failed — invisible to vector scoring.
  chunksWithoutEmbedding: number;
  /// Chunks per embedding model. More than one entry means the index is mixed
  /// and cosine is skipped across the boundary (see `search.ts`).
  embedModels: { model: string; count: number }[];
  /// Chunks per admin surface — shows at a glance whether the graph is being
  /// fed by everything or by one lopsided origin.
  origins: { kind: string; count: number }[];
  orphanEntities: number;
};

export type GraphEntity = {
  id: string;
  name: string;
  type: string;
  /// How many chunks mention it. Zero = unreachable by retrieval.
  mentions: number;
  /// Titles of the sources those chunks came from.
  sources: string[];
  edges: number;
};

export type GraphEdge = {
  id: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  relation: string;
};

export async function graphStats(userId: string): Promise<GraphStats> {
  const [chunks, entities, edges, models, originRows, orphanEntities] = await Promise.all([
    prisma.chunk.count({ where: { userId } }),
    prisma.entity.count({ where: { userId } }),
    prisma.entityEdge.count({ where: { from: { userId } } }),
    prisma.chunk.groupBy({ by: ["embedModel"], where: { userId }, _count: { _all: true } }),
    prisma.chunk.groupBy({ by: ["originKind", "originId"], where: { userId }, _count: { _all: true } }),
    prisma.entity.count({ where: { userId, mentions: { none: {} } } }),
  ]);

  // One groupBy feeds both the Sources tile and the per-origin breakdown, so
  // the headline number can never drift from the pills that explain it.
  const sources = originRows.length;
  const perKind = new Map<string, number>();
  for (const o of originRows) {
    perKind.set(o.originKind, (perKind.get(o.originKind) ?? 0) + o._count._all);
  }
  const origins = [...perKind]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  let chunksWithoutEmbedding = 0;
  const embedModels: { model: string; count: number }[] = [];
  for (const m of models) {
    if (m.embedModel) embedModels.push({ model: m.embedModel, count: m._count._all });
    else chunksWithoutEmbedding += m._count._all;
  }
  embedModels.sort((a, b) => b.count - a.count);

  return {
    sources, chunks, entities, edges,
    chunksWithoutEmbedding, embedModels, origins, orphanEntities,
  };
}

export async function listEntities(userId: string): Promise<GraphEntity[]> {
  const rows = await prisma.entity.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { edgesOut: true, edgesIn: true } },
      mentions: { select: { chunk: { select: { originLabel: true, originKind: true } } } },
    },
  });

  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    mentions: e.mentions.length,
    sources: [
      ...new Set(e.mentions.map((m) => m.chunk.originLabel || m.chunk.originKind)),
    ],
    edges: e._count.edgesOut + e._count.edgesIn,
  }));
}

export async function listEdges(userId: string): Promise<GraphEdge[]> {
  const rows = await prisma.entityEdge.findMany({
    where: { from: { userId } },
    include: { from: { select: { id: true, name: true } }, to: { select: { id: true, name: true } } },
  });
  return rows
    .map((e) => ({
      id: e.id,
      fromId: e.from.id,
      fromName: e.from.name,
      toId: e.to.id,
      toName: e.to.name,
      relation: e.relation,
    }))
    .sort((a, b) => a.fromName.localeCompare(b.fromName) || a.relation.localeCompare(b.relation));
}

/**
 * Rename and/or retype an entity. When the new name normalizes to a key that
 * another entity already owns, the two are merged into that existing entity
 * rather than colliding on the unique key — this is the main cleanup path, so
 * "Blake" and "Blake Mauri" can be made one node.
 */
export async function renameEntity(
  userId: string,
  id: string,
  name: string,
  type: string,
): Promise<{ merged: boolean }> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean) return { merged: false };

  const entity = await prisma.entity.findFirst({ where: { id, userId } });
  if (!entity) return { merged: false };

  const key = entityKey(clean);
  const existing =
    key === entity.key
      ? null
      : await prisma.entity.findUnique({ where: { userId_key: { userId, key } } });

  if (!existing) {
    await prisma.entity.update({ where: { id }, data: { name: clean, key, type } });
    return { merged: false };
  }

  await mergeInto(userId, entity.id, existing.id);
  return { merged: true };
}

/**
 * Fold `fromId` into `intoId`: move its mentions and rewire its edges, then
 * delete it (remaining mentions/edges cascade). Duplicate edges collapse and
 * edges whose endpoints become identical are dropped.
 */
async function mergeInto(userId: string, fromId: string, intoId: string): Promise<void> {
  const mentions = await prisma.entityMention.findMany({ where: { entityId: fromId } });
  if (mentions.length) {
    await prisma.entityMention.createMany({
      data: mentions.map((m) => ({ chunkId: m.chunkId, entityId: intoId })),
      skipDuplicates: true,
    });
  }

  const edges = await prisma.entityEdge.findMany({
    where: { OR: [{ fromId }, { toId: fromId }] },
  });
  for (const e of edges) {
    const a = e.fromId === fromId ? intoId : e.fromId;
    const b = e.toId === fromId ? intoId : e.toId;
    if (a === b) continue; // self-loop — carries no information
    const merged = await prisma.entityEdge.upsert({
      where: { fromId_toId_relation: { fromId: a, toId: b, relation: e.relation } },
      update: {},
      create: { fromId: a, toId: b, relation: e.relation },
      select: { id: true },
    });
    // Carry ownership onto the rewired edge, or deleting the origin that
    // asserted it would no longer find it and the relation would outlive its
    // source. The old edge's rows cascade away with the entity below.
    const owners = await prisma.entityEdgeOrigin.findMany({
      where: { edgeId: e.id },
      select: { originKind: true, originId: true },
    });
    if (owners.length) {
      await prisma.entityEdgeOrigin.createMany({
        data: owners.map((o) => ({ ...o, userId, edgeId: merged.id })),
        skipDuplicates: true,
      });
    }
  }

  await prisma.entity.delete({ where: { id: fromId } });
}

/** Remove an entity. Mentions and edges cascade; chunks and sources are untouched. */
export async function deleteEntity(userId: string, id: string): Promise<void> {
  await prisma.entity.deleteMany({ where: { id, userId } }).catch(() => {});
}

export type MergeSuggestion = {
  /// Merge `from` into `into`; `into` survives.
  fromId: string;
  fromName: string;
  intoId: string;
  intoName: string;
  /// Human-readable, shown next to the pair so the admin can judge it.
  reason: string;
};

const MIN_CONDENSED_KEY = 4;
const MIN_SHARED_NEIGHBORS = 2;
const MIN_NEIGHBOR_JACCARD = 0.5;
const MIN_SHARED_WORD = 3;
const MAX_SUGGESTIONS = 20;

/**
 * Likely-duplicate entity pairs, computed from the graph itself — no model
 * call, so the list is deterministic and free. Two signals:
 *
 * - Name containment: one condensed key inside the other ("brambleworks" ⊂
 *   "brambleworksltd"), shorter side at least MIN_CONDENSED_KEY chars so
 *   pairs like "AI" ⊂ "AI Safety" don't fire.
 * - Shared neighbors + a shared name word: mostly-overlapping edge-neighbor
 *   sets AND a common word of MIN_SHARED_WORD+ chars. The word requirement is
 *   load-bearing: nearly everything in this graph neighbors Blake, so raw
 *   neighbor overlap would pair unrelated skills ("TypeScript" / "React"),
 *   and a one-click merge of a false positive is worse than a missed
 *   suggestion.
 *
 * The higher-mention entity survives (ties: more edges, then longer name —
 * fuller names are usually canonical). Containment pairs sort first.
 */
export async function suggestedMerges(userId: string): Promise<MergeSuggestion[]> {
  const [entities, edges, dismissals] = await Promise.all([
    prisma.entity.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        key: true,
        _count: { select: { mentions: true, edgesOut: true, edgesIn: true } },
      },
    }),
    prisma.entityEdge.findMany({
      where: { from: { userId } },
      select: { fromId: true, toId: true },
    }),
    prisma.mergeDismissal.findMany({ where: { userId }, select: { keyA: true, keyB: true } }),
  ]);
  const dismissed = new Set(dismissals.map((d) => pairKey(d.keyA, d.keyB)));

  const neighbors = new Map<string, Set<string>>();
  for (const e of edges) {
    (neighbors.get(e.fromId) ?? neighbors.set(e.fromId, new Set()).get(e.fromId)!).add(e.toId);
    (neighbors.get(e.toId) ?? neighbors.set(e.toId, new Set()).get(e.toId)!).add(e.fromId);
  }

  const rows = entities.map((e) => ({
    id: e.id,
    name: e.name,
    key: e.key,
    condensed: e.key.replace(/[^a-z0-9]/g, ""),
    words: new Set(e.key.split(" ").filter((w) => w.length >= MIN_SHARED_WORD)),
    mentions: e._count.mentions,
    edges: e._count.edgesOut + e._count.edgesIn,
    neighbors: neighbors.get(e.id) ?? new Set<string>(),
  }));

  type Row = (typeof rows)[number];
  const containment = (a: Row, b: Row): boolean => {
    const [short, long] =
      a.condensed.length <= b.condensed.length ? [a.condensed, b.condensed] : [b.condensed, a.condensed];
    return short.length >= MIN_CONDENSED_KEY && long.includes(short);
  };
  const sharesWord = (a: Row, b: Row): boolean => {
    for (const w of a.words) if (b.words.has(w)) return true;
    return false;
  };
  const neighborOverlap = (a: Row, b: Row): number => {
    if (a.neighbors.size < MIN_SHARED_NEIGHBORS || b.neighbors.size < MIN_SHARED_NEIGHBORS) return 0;
    let shared = 0;
    for (const n of a.neighbors) if (b.neighbors.has(n)) shared++;
    if (shared < MIN_SHARED_NEIGHBORS) return 0;
    const union = a.neighbors.size + b.neighbors.size - shared;
    return shared / union >= MIN_NEIGHBOR_JACCARD ? shared : 0;
  };

  const found: (MergeSuggestion & { rank: number })[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (dismissed.has(pairKey(a.key, b.key))) continue; // admin said "don't merge"
      let reason: string | null = null;
      let rank = 0;
      if (containment(a, b)) {
        reason = "one name contains the other";
        rank = 2;
      } else {
        const shared = sharesWord(a, b) ? neighborOverlap(a, b) : 0;
        if (shared) {
          reason = `share a name word and ${shared} graph neighbors`;
          rank = 1;
        }
      }
      if (!reason) continue;
      // Survivor: more mentions, then more edges, then the longer name.
      const cmp =
        b.mentions - a.mentions || b.edges - a.edges || b.name.length - a.name.length;
      const [from, into] = cmp > 0 ? [a, b] : [b, a];
      found.push({
        fromId: from.id,
        fromName: from.name,
        intoId: into.id,
        intoName: into.name,
        reason,
        rank: rank * 1000 + from.mentions + into.mentions,
      });
    }
  }

  return found
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ rank: _rank, ...s }) => s);
}

/** Order-independent dismissal key for a pair of normalized entity keys. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/**
 * "Don't merge": persist that this suggested pair is not the same thing, so
 * suggestedMerges() stops proposing it. Keyed by the pair's normalized entity
 * keys (sorted, so direction doesn't matter) rather than ids — the judgment
 * must survive entity rows being pruned and recreated on re-index. Fails soft
 * on stale ids; repeating a dismissal is a no-op.
 */
export async function dismissMerge(
  userId: string,
  fromId: string,
  intoId: string,
): Promise<boolean> {
  if (!fromId || !intoId || fromId === intoId) return false;
  const rows = await prisma.entity.findMany({
    where: { id: { in: [fromId, intoId] }, userId },
    select: { key: true },
  });
  if (rows.length !== 2) return false;
  const [keyA, keyB] = rows[0].key < rows[1].key
    ? [rows[0].key, rows[1].key]
    : [rows[1].key, rows[0].key];
  await prisma.mergeDismissal.upsert({
    where: { userId_keyA_keyB: { userId, keyA, keyB } },
    update: {},
    create: { userId, keyA, keyB },
  });
  return true;
}

/**
 * One-click merge for a suggestion: fold `fromId` into `intoId` through the
 * same machinery renaming onto an existing name uses. Fails soft — a stale
 * form resubmit (either side already merged away) changes nothing.
 */
export async function mergeEntities(
  userId: string,
  fromId: string,
  intoId: string,
): Promise<boolean> {
  if (!fromId || !intoId || fromId === intoId) return false;
  const endpoints = await prisma.entity.count({
    where: { id: { in: [fromId, intoId] }, userId },
  });
  if (endpoints !== 2) return false;
  await mergeInto(userId, fromId, intoId);
  return true;
}

/**
 * Assert a relation the extractor missed. Returns false for a self-loop or a
 * missing endpoint; repeating the same triple is a no-op.
 */
export async function addEdge(
  userId: string,
  fromId: string,
  toId: string,
  relation: string,
): Promise<boolean> {
  const rel = relation.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!rel || !fromId || !toId || fromId === toId) return false;

  const endpoints = await prisma.entity.count({
    where: { id: { in: [fromId, toId] }, userId },
  });
  if (endpoints !== 2) return false;

  await prisma.entityEdge.upsert({
    where: { fromId_toId_relation: { fromId, toId, relation: rel } },
    update: {},
    create: { fromId, toId, relation: rel },
  });
  return true;
}

export async function deleteEdge(userId: string, id: string): Promise<void> {
  await prisma.entityEdge.deleteMany({ where: { id, from: { userId } } }).catch(() => {});
}

export type RetrievalPreview = {
  chunks: {
    ref: string;
    originKind: string;
    text: string;
    score: number;
    /// "rank" = lexical+vector seed; "graph" = pulled in by one-hop expansion.
    via: "rank" | "graph";
  }[];
  relations: string[];
  /// Entity names whose keys appear verbatim in the query — the same match
  /// retrieve() uses to seed expansion, so this shows whether the graph
  /// "sees" the question at all.
  queryEntities: string[];
  /// True when nothing is indexed yet, so the UI can say so instead of
  /// implying the query missed.
  indexEmpty: boolean;
};

/**
 * What the chatbot would be given for this question — the real retrieve()
 * result, plus which entities the query itself matched. Read-only; exists so
 * graph edits can be driven by observation instead of re-asking the chatbot
 * and guessing.
 */
export async function retrievalPreview(
  userId: string,
  query: string,
): Promise<RetrievalPreview> {
  const q = query.trim();
  if (!q) return { chunks: [], relations: [], queryEntities: [], indexEmpty: false };

  const [chunkCount, entities] = await Promise.all([
    prisma.chunk.count({ where: { userId } }),
    prisma.entity.findMany({ where: { userId }, select: { name: true, key: true } }),
  ]);
  const ql = q.toLowerCase();
  const queryEntities = entities.filter((e) => ql.includes(e.key)).map((e) => e.name);

  const r = await retrieve(userId, q);
  return {
    chunks: r.chunks.map((c) => ({
      ref: c.ref,
      originKind: c.originKind,
      text: c.text,
      score: c.score,
      via: c.via,
    })),
    relations: r.relations,
    queryEntities,
    indexEmpty: chunkCount === 0,
  };
}

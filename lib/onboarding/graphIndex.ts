import { prisma } from "@/lib/db";
import { persistGraph } from "@/lib/retrieval/indexer";
import {
  extractEntities,
  MAX_KNOWN_IN_PROMPT,
  type EntityExtractor,
  type ExtractedGraph,
} from "@/lib/retrieval/entities";

/**
 * The graph half of indexing, for Sources that onboarding wrote itself.
 *
 * Onboarding does NOT go through `indexSource`, and must not: it controls its
 * own chunk boundaries on purpose (one chunk per testimonial, one per bio, one
 * per swept fact), while `indexOrigin` re-chunks `rawText` with `chunkText`.
 * Routing onboarding through it would spend an embedding call per source to
 * replace curated chunks with blind splits — strictly worse retrieval.
 *
 * So this runs the one step onboarding was missing: read each source's chunks,
 * extract entities + relations from its text, and attach them to the chunks
 * that already exist. Chunks, embeddings and ids are never touched; the same
 * `persistGraph` the normal indexer uses does the writing, so onboarding
 * entities converge with dashboard-ingested ones on the same rows.
 *
 * Best-effort per source, like the rest of the indexer: a failed extraction
 * loses that source's graph, never its chunks, and never the whole run. The
 * report says how many failed rather than pretending the graph is complete.
 */

export type GraphIndexReport = {
  /// Sources whose entities/relations were extracted and persisted.
  indexed: number;
  /// Sources whose extraction call failed; their chunks are untouched.
  failed: number;
  /// Distinct entity rows the user's graph holds afterwards.
  entities: number;
  /// Relation rows afterwards.
  relations: number;
};

export type GraphIndexOpts = {
  extract?: EntityExtractor;
  /// Delay between model calls, matching scripts/reindex.ts pacing.
  paceMs?: number;
  onEvent?: (message: string) => void;
};

/** Pace between extraction calls; onboarding runs unattended, so it defaults
 *  to the same per-minute-limit spacing the backfill script uses. */
const DEFAULT_PACE_MS = Number(process.env.EMBED_PACE_MS ?? 0);

export async function indexOnboardingGraph(
  userId: string,
  opts: GraphIndexOpts = {},
): Promise<GraphIndexReport> {
  const extract = opts.extract ?? extractEntities;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const log = opts.onEvent ?? (() => {});

  // Only sources that actually carry chunks — a source whose extraction saved
  // nothing has no chunks for mentions to attach to.
  const sources = await prisma.source.findMany({
    where: { userId, chunks: { some: {} } },
    select: { id: true, title: true, url: true, filename: true, rawText: true, summary: true },
    orderBy: { createdAt: "asc" },
  });

  let indexed = 0;
  let failed = 0;

  for (const src of sources) {
    const label = src.title ?? src.url ?? src.filename ?? "source";
    const text = (src.rawText ?? "").trim() || (src.summary ?? "").trim();
    if (!text) continue;

    const chunks = await prisma.chunk.findMany({
      where: { userId, originKind: "source", originId: src.id },
      select: { id: true, text: true },
      orderBy: { seq: "asc" },
    });
    if (!chunks.length) continue;

    // Names already in the graph steer the extractor toward canonical
    // spellings instead of forking variants — same rationale as indexOrigin.
    const known = await prisma.entity
      .findMany({
        where: { userId },
        select: { name: true },
        orderBy: { mentions: { _count: "desc" } },
        take: MAX_KNOWN_IN_PROMPT,
      })
      .then((rows) => rows.map((r) => r.name))
      .catch(() => [] as string[]);

    if (indexed > 0 && paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));

    let graph: ExtractedGraph;
    try {
      graph = await extract(text, label, known);
    } catch {
      failed++;
      log(`Couldn't read the connections in “${label}” — its text is still saved`);
      continue;
    }

    await persistGraph(userId, graph, chunks, {
      kind: "source",
      id: src.id,
      label,
      sourceId: src.id,
      text,
    });
    indexed++;
  }

  const [entities, relations] = await Promise.all([
    prisma.entity.count({ where: { userId } }),
    prisma.entityEdge.count({ where: { from: { userId } } }),
  ]);

  return { indexed, failed, entities, relations };
}

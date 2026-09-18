import { prisma } from "@/lib/db";
import { persistGraph } from "@/lib/retrieval/indexer";
import { indexEverything } from "@/lib/retrieval/origins";
import { buildClusterOverviews, computeClusters } from "@/lib/retrieval/clusters";
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

/**
 * Pace between extraction calls. One model call per source fired back to back
 * trips entry-tier per-minute limits (see lib/retrieval/origins.ts), so this
 * matches the spacing indexEverything and scripts/reindex.ts already use.
 * Override with EMBED_PACE_MS (0 disables) on a higher-limit plan.
 */
export const DEFAULT_PACE_MS = Number(process.env.EMBED_PACE_MS ?? 21_000);

export async function indexOnboardingGraph(
  userId: string,
  opts: GraphIndexOpts = {},
): Promise<GraphIndexReport> {
  const extract = opts.extract ?? extractEntities;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const log = opts.onEvent ?? (() => {});

  // Scanned sources that actually carry chunks: a source whose extraction
  // saved nothing has no chunks for mentions to attach to, and a pending or
  // failed one asserts nothing yet. Same scoping as scripts/reindex.ts, so
  // this stays correct if it is ever run outside the onboarding flow.
  const sources = await prisma.source.findMany({
    where: { userId, status: "scanned", chunks: { some: {} } },
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

/**
 * The whole indexing pass for a finished onboarding run.
 *
 * Onboarding fills more than Sources: the review steps write the Profile
 * (company name, owner, phone, email, addresses, opening hours), the
 * persona/brand voice, and gallery photos — through
 * `app/api/admin/onboarding/save/route.ts`, which calls no indexer. Those rows
 * are therefore saved but unretrievable, so a visitor asking "what are your
 * opening hours?" gets nothing from data the user just confirmed.
 *
 * This runs at completion, when every stage has saved: `indexEverything` for
 * the non-Source origins, the graph pass for onboarding's own chunks, then the
 * cluster overviews computed from the resulting graph.
 *
 * Best-effort throughout, like `personalizeStarterQuestions`: completion must
 * never fail because indexing did. A partial index is reported, not hidden.
 */
export async function finishOnboardingIndex(
  userId: string,
  opts: GraphIndexOpts = {},
): Promise<GraphIndexReport & { origins: number }> {
  const log = opts.onEvent ?? (() => {});
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;

  let origins = 0;
  try {
    origins = await indexEverything(userId, { paceMs, ...(opts.extract ? { extract: opts.extract } : {}) });
  } catch {
    log("Couldn't index your profile details — they're saved and still shown on your page");
  }

  const report = await indexOnboardingGraph(userId, opts);

  // Overviews are computed FROM the graph that was just built, so they run
  // last and only when there is a graph to summarize.
  if (report.entities > 0) {
    await buildClusterOverviews(userId).catch(() => 0);
  }

  return { ...report, origins };
}

/** What the filing pass will have to do, counted before it starts. */
export type FilingWork = {
  /// Non-Source origins indexEverything steps through (profile, persona, ...).
  origins: number;
  /// Scanned sources with chunks that the graph pass re-reads.
  sources: number;
  /// Cluster overviews that will be summarized from the resulting graph.
  clusters: number;
};

/** Model calls that follow filing before the run is done: starter questions
 *  plus the card planner. Counted so the estimate is "until done", not "until
 *  the next quiet stage". */
export const TAIL_CALLS = 3;
/** A typical model call plus its database writes. */
export const CALL_MS = 6_000;

/**
 * Seconds the rest of the run should take. Pure and deterministic: every
 * origin and source costs one paced model call (indexEverything and the graph
 * pass each sleep `paceMs` between their own steps, never before the first),
 * each cluster costs one unpaced summary call, and the tail stages cost their
 * calls. Rounded up to a whole ten seconds so the number reads as an estimate.
 */
export function filingSeconds(work: FilingWork, paceMs = DEFAULT_PACE_MS): number {
  const pauses = Math.max(work.origins - 1, 0) + Math.max(work.sources - 1, 0);
  const calls = work.origins + work.sources + work.clusters + TAIL_CALLS;
  const ms = pauses * paceMs + calls * CALL_MS;
  return Math.max(10, Math.ceil(ms / 10_000) * 10);
}

/** Count the filing work with the same queries the pass itself runs. */
export async function estimateFilingWork(userId: string): Promise<FilingWork> {
  const [projects, photos, approved, appointments, sources, entities, edges] = await Promise.all([
    prisma.project.count({ where: { userId } }),
    prisma.photo.count({ where: { userId } }),
    prisma.chatMessage.count({ where: { role: "assistant", rating: "up", session: { userId } } }),
    prisma.appointment.count({ where: { userId } }),
    prisma.source.count({ where: { userId, status: "scanned", chunks: { some: {} } } }),
    prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, _count: { select: { mentions: true } } },
    }),
    prisma.entityEdge.findMany({ where: { from: { userId } }, select: { fromId: true, toId: true } }),
  ]);
  const clusters = computeClusters(
    entities.map((e) => ({ id: e.id, name: e.name, mentions: e._count.mentions })),
    edges,
  ).length;
  // Profile and persona are always stepped through, whether or not they are filled.
  return { origins: 2 + projects + photos + approved + appointments, sources, clusters };
}

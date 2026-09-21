import { prisma } from "@/lib/db";
import { persistGraph } from "@/lib/retrieval/indexer";
import { indexEverything } from "@/lib/retrieval/origins";
import {
  buildClusterOverviews, computeClusters, summarizeCluster, MAX_CLUSTERS,
} from "@/lib/retrieval/clusters";
import {
  extractEntities,
  MAX_KNOWN_IN_PROMPT,
  type EntityExtractor,
  type ExtractedGraph,
} from "@/lib/retrieval/entities";
import { createPacer, mapPool, modelCall, onboardingConcurrency } from "./pool";

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
 *
 * Sources are read several at a time. The extraction call is the slow part and
 * sources don't depend on each other, so the calls overlap (through the shared
 * model gate, pool.ts) while the graph writes they end in queue up per user
 * inside `persistGraph`. This replaced a fixed 21s sleep between calls that
 * made a forty-page site a quarter of an hour of mostly waiting.
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
  /// Minimum spacing between the starts of model calls; 0 for none.
  paceMs?: number;
  /// Sources (and origins) read at once. Defaults to ONBOARDING_CONCURRENCY.
  concurrency?: number;
  onEvent?: (message: string) => void;
};

/**
 * Spacing between the starts of indexing calls during onboarding — none by
 * default. The per-minute limits the old fixed 21s sleep was guarding are
 * handled by the shared model gate instead: a bounded number of calls in
 * flight, and a rate-limit response cools every agent down before the retry
 * (pool.ts). EMBED_PACE_MS is still honored when an operator sets it — the
 * brake for an entry-tier key — and scripts/reindex.ts keeps its own 21s
 * default either way.
 */
export const DEFAULT_PACE_MS = Number(process.env.EMBED_PACE_MS ?? 0);

export async function indexOnboardingGraph(
  userId: string,
  opts: GraphIndexOpts = {},
): Promise<GraphIndexReport> {
  const extract = opts.extract ?? extractEntities;
  const pace = createPacer(opts.paceMs ?? DEFAULT_PACE_MS);
  const concurrency = opts.concurrency ?? onboardingConcurrency();
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

  await mapPool(sources, concurrency, async (src) => {
    const label = src.title ?? src.url ?? src.filename ?? "source";
    const text = (src.rawText ?? "").trim() || (src.summary ?? "").trim();
    if (!text) return;

    const chunks = await prisma.chunk.findMany({
      where: { userId, originKind: "source", originId: src.id },
      select: { id: true, text: true },
      orderBy: { seq: "asc" },
    });
    if (!chunks.length) return;

    await pace();

    let graph: ExtractedGraph;
    try {
      graph = await modelCall(async () => {
        // Names already in the graph steer the extractor toward canonical
        // spellings instead of forking variants — same rationale as
        // indexOrigin. Read inside the gate, at the moment the call really
        // starts, so it sees what the sources ahead of it have persisted.
        const known = await prisma.entity
          .findMany({
            where: { userId },
            select: { name: true },
            orderBy: { mentions: { _count: "desc" } },
            take: MAX_KNOWN_IN_PROMPT,
          })
          .then((rows) => rows.map((r) => r.name))
          .catch(() => [] as string[]);
        return extract(text, label, known);
      });
    } catch {
      failed++;
      log(`Couldn't read the connections in “${label}” — its text is still saved`);
      return;
    }

    await persistGraph(userId, graph, chunks, {
      kind: "source",
      id: src.id,
      label,
      sourceId: src.id,
      text,
    });
    indexed++;
  });

  return { indexed, failed, ...(await graphSize(userId)) };
}

/** Distinct entities and relations the user's graph holds right now. */
async function graphSize(userId: string): Promise<{ entities: number; relations: number }> {
  const [entities, relations] = await Promise.all([
    prisma.entity.count({ where: { userId } }),
    prisma.entityEdge.count({ where: { from: { userId } } }),
  ]);
  return { entities, relations };
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
 * the non-Source origins and the graph pass for onboarding's own chunks — side
 * by side, since neither reads what the other writes — then the cluster
 * overviews computed from the resulting graph.
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
  const concurrency = opts.concurrency ?? onboardingConcurrency();
  // indexEverything calls its extractor directly, so the gate goes on here:
  // both passes then draw on the one budget of model calls in flight.
  const base = opts.extract ?? extractEntities;
  const extract: EntityExtractor = (text, title, known) =>
    modelCall(() => base(text, title, known));

  const [origins, report] = await Promise.all([
    indexEverything(userId, { paceMs, concurrency, extract }).catch(() => {
      log("Couldn't index your profile details — they're saved and still shown on your page");
      return 0;
    }),
    indexOnboardingGraph(userId, opts),
  ]);

  // The graph pass counted while the origins pass was still writing.
  const size = await graphSize(userId);

  // Overviews are computed FROM the graph that was just built, so they run
  // last and only when there is a graph to summarize.
  if (size.entities > 0) {
    await buildClusterOverviews(userId, {
      concurrency,
      summarize: (label, members, text) => modelCall(() => summarizeCluster(label, members, text)),
    }).catch(() => 0);
  }

  return { ...report, ...size, origins };
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
 * Seconds the rest of the run should take. Pure and deterministic, and shaped
 * like the pass it describes: origins and sources index side by side on one
 * shared budget of `concurrency` model calls in flight, so together they cost
 * a call per wave of that many; a pace, when one is set, spaces each pass's
 * starts apart, and since the passes overlap the longer one sets the floor.
 * Cluster overviews follow, a wave at a time, then the tail stages one call
 * each. Rounded up to a whole ten seconds so the number reads as an estimate.
 */
export function filingSeconds(
  work: FilingWork,
  paceMs = DEFAULT_PACE_MS,
  concurrency = onboardingConcurrency(),
): number {
  const waves = (n: number) => Math.ceil(n / Math.max(1, Math.floor(concurrency)));
  const indexing = work.origins + work.sources;
  const pooledMs = waves(indexing) * CALL_MS;
  const pacedMs = paceMs > 0 && indexing > 0
    ? (Math.max(work.origins, work.sources) - 1) * paceMs + CALL_MS
    : 0;
  const ms = Math.max(pooledMs, pacedMs) + (waves(work.clusters) + TAIL_CALLS) * CALL_MS;
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
  // The graph is built BY the pass being estimated, so on a first run there is
  // nothing to cluster yet. Budget for the cap then — an estimate that runs
  // short reads worse than one that finishes early.
  const clusters = computeClusters(
    entities.map((e) => ({ id: e.id, name: e.name, mentions: e._count.mentions })),
    edges,
  ).length || (sources > 0 ? MAX_CLUSTERS : 0);
  // Profile and persona are always stepped through, whether or not they are filled.
  return { origins: 2 + projects + photos + approved + appointments, sources, clusters };
}

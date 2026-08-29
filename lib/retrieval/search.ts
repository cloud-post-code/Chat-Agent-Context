import { prisma } from "../db";
import { tokenize } from "./chunking";
import { bytesToVec, cosine, embedModelName, embedTexts } from "./embed";

/**
 * Hybrid retrieval with one-hop graph expansion.
 *
 * 1. Score every chunk lexically (BM25-style) and by embedding cosine
 *    (same-model vectors only), blend the normalized scores, and take the
 *    top seeds.
 * 2. Collect the entities the seeds mention plus entities named in the query,
 *    expand one hop over EntityEdge, and pull in chunks that mention the
 *    neighbors — facts connected to the question but phrased differently.
 * 3. Return the best chunks under a character budget plus human-readable
 *    relation lines for the prompt.
 *
 * The whole chunk table is scanned in-process; the corpus is a personal
 * site's knowledge base (hundreds of chunks), so this beats maintaining a
 * vector index.
 */

export type RetrievedChunk = {
  chunkId: string;
  /// Which admin surface this came from: source | profile | persona |
  /// project | photo | activity.
  originKind: string;
  originId: string;
  /// Set only for source-derived chunks.
  sourceId: string | null;
  /// Human-readable pointer used to cite the chunk in the prompt.
  ref: string;
  text: string;
  score: number;
  via: "rank" | "graph";
};

export type Retrieval = { chunks: RetrievedChunk[]; relations: string[] };

const BM25_K1 = 1.4;
const BM25_B = 0.6;

export async function retrieve(
  userId: string,
  query: string,
  opts: { seedLimit?: number; graphLimit?: number; charBudget?: number } = {},
): Promise<Retrieval> {
  const { seedLimit = 6, graphLimit = 4, charBudget = 6000 } = opts;

  // Cluster overviews are synthesized FROM these chunks (lib/retrieval/
  // clusters.ts) and are served whole for broad questions; letting them
  // compete here would serve the same facts twice and crowd out primary
  // sources under the char budget.
  const chunks = await prisma.chunk.findMany({
    where: { userId, originKind: { not: "cluster" } },
    include: { mentions: { select: { entityId: true } } },
  });
  if (chunks.length === 0) return { chunks: [], relations: [] };

  // ── Lexical (BM25-style) ──
  const qTokens = [...new Set(tokenize(query))];
  const docs = chunks.map((c) => tokenize(c.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(d)) if (qTokens.includes(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const lex = docs.map((d) => {
    let score = 0;
    for (const t of qTokens) {
      const n = df.get(t);
      if (!n) continue;
      const tf = d.filter((x) => x === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / avgLen));
    }
    return score;
  });

  // ── Vector (same-model cosine) ──
  const model = embedModelName();
  const [qVec] = (await embedTexts([query])).vectors;
  const vec = chunks.map((c) =>
    qVec && c.embedding && c.embedModel === model
      ? Math.max(0, cosine(qVec, bytesToVec(c.embedding)))
      : 0,
  );

  // ── Blend: normalize each signal to [0,1], lexical-leaning weights (the
  // default local embedding is n-gram based, so lexical carries more). ──
  const maxLex = Math.max(...lex, 0);
  const maxVec = Math.max(...vec, 0);
  const combined = chunks.map(
    (_, i) =>
      0.6 * (maxLex ? lex[i] / maxLex : 0) + 0.4 * (maxVec ? vec[i] / maxVec : 0),
  );

  const ranked = chunks
    .map((c, i) => ({ c, score: combined[i] }))
    .filter((r) => r.score > 0.05)
    .sort((a, b) => b.score - a.score);
  const seeds = ranked.slice(0, seedLimit);

  // ── One-hop graph expansion ──
  const seedEntityIds = new Set(seeds.flatMap((s) => s.c.mentions.map((m) => m.entityId)));
  const q = query.toLowerCase();
  const allEntities = await prisma.entity.findMany({
    where: { userId },
    select: { id: true, name: true, key: true },
  });
  for (const e of allEntities) if (q.includes(e.key)) seedEntityIds.add(e.id);

  const ids = [...seedEntityIds];
  const edges = ids.length
    ? await prisma.entityEdge.findMany({
        where: { OR: [{ fromId: { in: ids } }, { toId: { in: ids } }] },
        include: { from: { select: { name: true } }, to: { select: { name: true } } },
      })
    : [];
  const neighborIds = new Set<string>();
  for (const e of edges) {
    if (seedEntityIds.has(e.fromId)) neighborIds.add(e.toId);
    if (seedEntityIds.has(e.toId)) neighborIds.add(e.fromId);
  }
  for (const id of seedEntityIds) neighborIds.delete(id);

  const seedChunkIds = new Set(seeds.map((s) => s.c.id));
  const graphRows = chunks
    .map((c, i) => ({ c, score: combined[i] }))
    .filter(
      (r) =>
        !seedChunkIds.has(r.c.id) &&
        r.c.mentions.some((m) => neighborIds.has(m.entityId)),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, graphLimit);

  const relations = edges.map((e) => `${e.from.name} — ${e.relation} → ${e.to.name}`);

  // ── Assemble under the character budget: seeds first, then graph hops ──
  const out: RetrievedChunk[] = [];
  let used = 0;
  const push = (r: { c: (typeof chunks)[number]; score: number }, via: "rank" | "graph") => {
    if (used + r.c.text.length > charBudget && out.length > 0) return;
    out.push({
      chunkId: r.c.id,
      originKind: r.c.originKind,
      originId: r.c.originId,
      sourceId: r.c.sourceId,
      ref: r.c.originLabel || r.c.originKind,
      text: r.c.text,
      score: r.score,
      via,
    });
    used += r.c.text.length;
  };
  for (const r of seeds) push(r, "rank");
  for (const r of graphRows) push(r, "graph");

  return { chunks: out, relations: [...new Set(relations)].slice(0, 12) };
}

/** Render a Retrieval as the prompt's knowledge block. */
export function formatContext(r: Retrieval): string {
  if (r.chunks.length === 0) return "(Nothing in the knowledge base matched this question.)";
  const blocks = r.chunks.map((c) => `[${c.ref}]\n${c.text}`).join("\n\n");
  const rel = r.relations.length
    ? `\n\nKNOWN RELATIONSHIPS:\n${r.relations.map((l) => `- ${l}`).join("\n")}`
    : "";
  return blocks + rel;
}

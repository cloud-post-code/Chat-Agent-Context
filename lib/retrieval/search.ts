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

type RetrievedChunk = {
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

/**
 * An origin this small is served whole once any of its chunks is a seed. A
 * price list is saved one item per chunk ("Dip. $50"), so ranking alone hands
 * the model six rows of a forty-row menu — enough to answer nothing about
 * "all services", "the cheapest pedicure" or a combo. Long documents stay
 * chunk-ranked: they blow this cap.
 */
const WHOLE_ORIGIN_CHARS = 5000;

/**
 * Visitor words → the forms a site uses. Lexical only: tokenize() also feeds
 * the stored local embeddings, so it must not change. Plurals, -ing and a
 * trailing e fold together (prices/pricing/price); hyphenated tokens also
 * count as their parts (fill-in → fill, in).
 */
function stems(text: string): string[] {
  const out: string[] = [];
  for (const tok of tokenize(text)) {
    for (const part of tok.includes("-") ? [tok, ...tok.split("-")] : [tok]) {
      let t = part.replace(/'s$/, "");
      if (t.length > 4 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
      else if (t.length > 4 && t.endsWith("ses")) t = t.slice(0, -2);
      else if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
      if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
      if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
      if (t.length > 1) out.push(t);
    }
  }
  return out;
}

const originKey = (c: { originKind: string; originId: string }) =>
  `${c.originKind}:${c.originId}`;

/** Equal stems, or one abbreviates the other ("mani" → "manicur"). */
function stemMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a));
}

export async function retrieve(
  userId: string,
  query: string,
  opts: { seedLimit?: number; graphLimit?: number; charBudget?: number } = {},
): Promise<Retrieval> {
  const { seedLimit = 6, graphLimit = 4, charBudget = 9000 } = opts;

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
  const qTokens = [...new Set(stems(query))];
  const docs = chunks.map((c) => stems(c.text));
  const avgLen = docs.reduce((s, d) => s + d.length, 0) / docs.length || 1;
  const tfs = docs.map((d) => qTokens.map((t) => d.filter((x) => stemMatch(x, t)).length));
  const df = new Map<string, number>();
  qTokens.forEach((t, qi) => df.set(t, tfs.filter((row) => row[qi] > 0).length));
  // A menu row never says "services" — its source's title does. Title hits are
  // weighed across origins, not chunks: forty rows sharing one title is one
  // rare title, not forty common words.
  const labels = new Map<string, string[]>();
  for (const c of chunks) labels.set(originKey(c), stems(c.originLabel ?? ""));
  const labelScore = new Map<string, number>();
  for (const t of qTokens) {
    const hits = [...labels].filter(([, l]) => l.some((x) => stemMatch(x, t))).map(([k]) => k);
    const idf = Math.log(1 + (labels.size - hits.length + 0.5) / (hits.length + 0.5));
    for (const k of hits) labelScore.set(k, (labelScore.get(k) ?? 0) + idf);
  }
  const lex = docs.map((d, di) => {
    let score = 0;
    for (const [qi, t] of qTokens.entries()) {
      const n = df.get(t);
      if (!n) continue;
      const tf = tfs[di][qi];
      if (!tf) continue;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / avgLen));
    }
    return score + (labelScore.get(originKey(chunks[di])) ?? 0);
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
  // A seed from a small multi-chunk origin brings the whole origin, in order,
  // as one block. Blocks are what count toward the seed limit, so a menu's
  // rows filling the top ranks don't shut every other source out.
  const byOrigin = new Map<string, typeof chunks>();
  for (const c of chunks) byOrigin.set(originKey(c), [...(byOrigin.get(originKey(c)) ?? []), c]);
  const served = new Set<string>();
  let blocks = 0;
  for (const r of ranked) {
    if (blocks >= seedLimit) break;
    const k = originKey(r.c);
    if (served.has(k)) continue;
    const family = byOrigin.get(k) ?? [];
    const text = [...family].sort((a, b) => a.seq - b.seq).map((c) => c.text).join("\n");
    const whole = family.length > 1 && text.length <= WHOLE_ORIGIN_CHARS;
    if (whole) served.add(k);
    push({ c: whole ? { ...r.c, text } : r.c, score: r.score }, "rank");
    blocks++;
  }
  for (const r of graphRows) {
    if (!served.has(originKey(r.c))) push(r, "graph");
  }

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

/**
 * Shared tokenizer and scoring for every small addressable index (photos,
 * projects): one place decides what counts as a "meaningful word" and how two
 * bags of words overlap, so a photo filter and a project filter agree on what
 * a shared term is worth.
 *
 * Pure and import-free on purpose, like lib/adminElements.ts — either side of the app can reach it cheaply, and a
 * proof can drive it with no setup.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "our", "your", "this", "that", "from", "into",
  "over", "about", "have", "will", "just", "some", "more", "than", "then",
  "are", "was", "were", "been", "being", "has", "had", "not", "but", "you",
  "all", "can", "her", "his", "its", "out", "who", "get", "got",
]);

/** Light stem so plurals and -ing forms collapse to the same term: "nails"
 *  and "nail" should overlap, "gel" polishes and "gels" should too. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Lowercase, split on anything that isn't a letter or digit, drop stopwords
 * and anything under 3 characters, stem what's left, and dedupe keeping the
 * first-seen order — so scoring and display both see a stable term list.
 */
export function meaningfulWords(text: string): string[] {
  const raw = (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    const s = stem(w);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Inverse-document-frequency weight for every term across a corpus of
 * already-tokenized docs: log((N+1)/(df+1)) + 1, so a term in every doc
 * (like "nails" in a nail salon's whole catalog) counts for less than a term
 * that picks out just a few.
 */
export function idfWeights(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const n = docs.length;
  const weights = new Map<string, number>();
  for (const [term, count] of df) {
    weights.set(term, Math.log((n + 1) / (count + 1)) + 1);
  }
  return weights;
}

/**
 * How much a query and a document have in common: the sum of each shared
 * term's idf weight (or 1 per shared term when no weights are given). Zero
 * when nothing overlaps.
 */
export function overlapScore(query: string[], doc: string[], idf?: Map<string, number>): number {
  const docSet = new Set(doc);
  let score = 0;
  for (const term of new Set(query)) {
    if (docSet.has(term)) score += idf?.get(term) ?? 1;
  }
  return score;
}

import { priceAmountOf } from "@/lib/util/money";

/** The numeric amount a price label states, or null when it states none — "$45", "$45+", "from $45" all yield 45. */
export const priceAmountFromLabel = priceAmountOf;
/**
 * Service and project selection: the small addressable index behind
 * show_services, show_booking, and show_projects, in the same spirit as
 * lib/menuTypes.ts and lib/adminElements.ts. Pure and import-free (beyond the
 * shared tokenizer) so it can be driven by an offline proof and shared by the
 * booking flow, the services card, and the projects card without either side
 * inventing its own notion of "matches" or "similar".
 *
 * A service or project is addressed three ways: by id (explicit, caller
 * order kept, unknown ids dropped), by a closed facet (category, exact and
 * case-insensitive), or by free text (query, scored by IDF-weighted term
 * overlap against name/description/tags so a rare shared word like "gel"
 * counts for more than a common one like "manicure"). "Similar" reuses the
 * same term weights plus category and price closeness so "book that" after
 * "gel manicure" narrows to the other nail services, not the whole catalog.
 */

import { meaningfulWords, idfWeights, overlapScore } from "./terms";

export type ServiceMeta = {
  id: string;
  name: string;
  description: string;
  category?: string;
  priceLabel?: string;
  priceAmount?: number | null;
  tags?: string[];
};

export type ServiceFilter = { ids?: string[]; category?: string; query?: string; limit?: number };

export type ProjectFilter = { ids?: string[]; tags?: string[]; query?: string; limit?: number };

type ProjectMeta = { id: string; name: string; blurb: string; tags: string[] };

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(limit)));
}

/** words(name) ∪ words(first 200 chars of description) ∪ tags. Tags are run
 *  through meaningfulWords too (not just lowercased) so a query term like
 *  "nails" — stemmed to "nail" — still overlaps a service whose only "nails"
 *  signal is a plain tag, not just prose in the name/description. */
export function serviceTerms(s: ServiceMeta): string[] {
  const nameWords = meaningfulWords(s.name);
  const descWords = meaningfulWords(s.description.slice(0, 200));
  const tagWords = (s.tags ?? []).flatMap((t) => meaningfulWords(t));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...nameWords, ...descWords, ...tagWords]) {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

export function isEmptyServiceFilter(f: ServiceFilter): boolean {
  return !f.ids?.length && !(f.category ?? "").trim() && !(f.query ?? "").trim();
}

function byIds<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const out: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item) out.push(item);
  }
  return out;
}

/** Empty filter => all, no limit. ids ordered/unknown dropped; category
 *  case-insensitive exact; query = idf-weighted overlap > 0 sorted desc then
 *  catalog order; limit only with a non-empty filter. */
export function filterServices<T extends ServiceMeta>(items: T[], f: ServiceFilter): T[] {
  if (isEmptyServiceFilter(f)) return items;

  let pool = items;
  if (f.ids?.length) pool = byIds(items, f.ids);
  if (f.category) {
    const category = f.category.toLowerCase().trim();
    pool = pool.filter((it) => (it.category ?? "").toLowerCase().trim() === category);
  }
  if (f.query) {
    const docs = pool.map((it) => serviceTerms(it));
    const idf = idfWeights(docs);
    const queryTerms = meaningfulWords(f.query);
    const scored = pool
      .map((it, i) => ({ it, i, score: overlapScore(queryTerms, docs[i], idf) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    pool = scored.map((s) => s.it);
  }
  return pool.slice(0, clampLimit(f.limit));
}

function priceOf(s: ServiceMeta): number | null {
  if (s.priceAmount !== undefined && s.priceAmount !== null) return s.priceAmount;
  if (s.priceLabel) return priceAmountFromLabel(s.priceLabel);
  return null;
}

function withinPriceBand(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (lo <= 0) return lo === hi;
  return (hi - lo) / lo <= 0.4;
}

function similarityScore(candidate: ServiceMeta, focusList: ServiceMeta[], idf: Map<string, number>): number {
  let best = 0;
  const candNameTerms = new Set(meaningfulWords(candidate.name));
  const candDescTerms = new Set(meaningfulWords(candidate.description.slice(0, 200)));
  const candPrice = priceOf(candidate);
  for (const focus of focusList) {
    let score = 0;
    if (focus.category && candidate.category && focus.category.toLowerCase() === candidate.category.toLowerCase()) {
      score += 3;
    }
    const focusNameTerms = new Set(meaningfulWords(focus.name));
    score += 2 * overlapScore([...candNameTerms], [...focusNameTerms], idf);
    const focusDescTerms = new Set(meaningfulWords(focus.description.slice(0, 200)));
    score += overlapScore([...candDescTerms], [...focusDescTerms], idf);
    const focusPrice = priceOf(focus);
    if (candPrice !== null && focusPrice !== null && withinPriceBand(candPrice, focusPrice)) score += 0.5;
    if (score > best) best = score;
  }
  return best;
}

/** Excludes focus; scores each remaining item against the closest focus item;
 *  stable tie-break by catalog order; never empty when n>0 and other items
 *  exist — falls back to the next n in catalog order with close=false. */
export function similarServices<T extends ServiceMeta>(
  items: T[],
  focus: T[],
  n: number,
): { items: T[]; close: boolean } {
  if (n <= 0) return { items: [], close: false };
  const focusIds = new Set(focus.map((f) => f.id));
  const candidates = items.filter((it) => !focusIds.has(it.id));
  if (!candidates.length) return { items: [], close: false };

  const docs = items.map((it) => serviceTerms(it));
  const idf = idfWeights(docs);

  const scored = candidates.map((it, i) => ({
    it,
    i,
    score: similarityScore(it, focus, idf),
  }));
  const anyPositive = scored.some((s) => s.score > 0);
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const top = scored.slice(0, n).map((s) => s.it);
  return { items: top, close: anyPositive };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** "- <id> | <name> | <category> | <priceLabel> | up to 6 terms"; "" when
 *  none; cap chars with an "- … and N more" tail like menuPromptSection. */
export function serviceIndexLines(items: ServiceMeta[], cap = 3000): string {
  if (!items.length) return "";
  const lines: string[] = [];
  for (const s of items) {
    const category = s.category ?? "";
    const priceLabel = s.priceLabel ?? (s.priceAmount != null ? `$${s.priceAmount}` : "");
    const terms = serviceTerms(s).slice(0, 6).join(", ");
    lines.push(`- ${s.id} | ${truncate(s.name, 60)} | ${category} | ${priceLabel} | ${terms}`);
  }
  let out = "";
  let shown = 0;
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > cap && shown > 0) break;
    out = next;
    shown += 1;
  }
  if (shown < lines.length) out += `\n- … and ${lines.length - shown} more`;
  return out;
}

export function isEmptyProjectFilter(f: ProjectFilter): boolean {
  return !f.ids?.length && !f.tags?.length && !(f.query ?? "").trim();
}

/** Same semantics as filterPhotos: empty filter => all, no limit; ids kept in
 *  caller order with unknowns dropped; tags ANDed against tags ∪
 *  words(name+blurb); query = overlap > 0 sorted desc then catalog order;
 *  limit only with a non-empty filter. */
export function filterProjects<T extends ProjectMeta>(items: T[], f: ProjectFilter): T[] {
  if (isEmptyProjectFilter(f)) return items;

  let pool = items;
  if (f.ids?.length) pool = byIds(items, f.ids);
  if (f.tags?.length) {
    // Stem the filter's tags and the item's own tags the same way (via
    // meaningfulWords) so a filter tag like "nails" matches an item whose
    // stored tag is the same word, consistent with the query path below.
    const wanted = f.tags.flatMap((t) => meaningfulWords(t));
    pool = pool.filter((it) => {
      const ownTags = new Set(it.tags.flatMap((t) => meaningfulWords(t)));
      const textWords = new Set(meaningfulWords(`${it.name} ${it.blurb}`));
      return wanted.every((tag) => ownTags.has(tag) || textWords.has(tag));
    });
  }
  if (f.query) {
    // Stem tags via meaningfulWords, same as the `tags` filter's own
    // comparison above, so query terms and tag terms agree on what "nails"
    // means.
    const docs = pool.map((it) => [
      ...it.tags.flatMap((t) => meaningfulWords(t)),
      ...meaningfulWords(`${it.name} ${it.blurb}`),
    ]);
    const idf = idfWeights(docs);
    const queryTerms = meaningfulWords(f.query);
    const scored = pool
      .map((it, i) => ({ it, i, score: overlapScore(queryTerms, docs[i], idf) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    pool = scored.map((s) => s.it);
  }
  return pool.slice(0, clampLimit(f.limit));
}

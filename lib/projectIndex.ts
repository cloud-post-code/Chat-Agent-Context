/**
 * Project selection: the small addressable index behind show_projects, in the
 * same spirit as lib/photoIndex.ts. Pure and import-free (beyond the shared
 * tokenizer) so it can be driven by an offline proof.
 *
 * A project is addressed three ways: by id (explicit, caller order kept,
 * unknown ids dropped), by tags (ANDed, matched against the project's own
 * tags or the words of its name and blurb), or by free text (query, scored by
 * IDF-weighted term overlap so a rare shared word counts for more than a
 * common one).
 */

import { meaningfulWords, idfWeights, overlapScore } from "./terms";

export type ProjectFilter = { ids?: string[]; tags?: string[]; query?: string; limit?: number };

type ProjectMeta = { id: string; name: string; blurb: string; tags: string[] };

const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 12;

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.round(limit)));
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

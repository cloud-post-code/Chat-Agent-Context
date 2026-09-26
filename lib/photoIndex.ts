import { meaningfulWords, overlapScore } from "./terms";

/**
 * The gallery's small addressable items: what a `show_gallery` filter can
 * name (ids, tags, free text) and how the prompt lists them, so the model
 * can ask for "the red ones" instead of getting the whole gallery every
 * time. Pure and import-free apart from the shared tokenizer, so a proof can
 * drive it with no setup.
 */

export type PhotoMeta = {
  id: string;
  src: string;
  caption: string;
  description: string;
  tags: string[];
};

export type PhotoFilter = {
  ids?: string[];
  tags?: string[];
  query?: string;
  limit?: number;
};

/**
 * A photo's stored tags column (JSON string, or already an array from a
 * caller that parsed it) as lowercase, trimmed, unique strings. Never
 * throws: malformed JSON, a non-array, or non-string entries all just drop
 * out rather than blowing up an admin save or a chat turn.
 */
export function parsePhotoTags(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const t = v.trim().toLowerCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Whether a filter names nothing at all — the "everything" case. */
export function isEmptyPhotoFilter(f: PhotoFilter): boolean {
  return !(f.ids?.length) && !(f.tags?.length) && !(f.query ?? "").trim();
}

const MIN_LIMIT = 1;
const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 6;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(limit)));
}

/** A photo's own words: its tags plus whatever meaningfulWords finds in its
 *  caption and description — so an untagged photo whose caption says "red
 *  gel nails" is still reachable by a `tags: ["red"]` filter. Tags are
 *  passed through meaningfulWords too (a no-op for an already-clean tag
 *  like "red", but it stems a plural tag like "nails" to "nail" so it lines
 *  up with the stemmed words pulled from prose). */
function photoWords(item: PhotoMeta): Set<string> {
  const words = new Set(meaningfulWords(`${item.caption} ${item.description}`));
  for (const t of item.tags) for (const w of meaningfulWords(t)) words.add(w);
  return words;
}

/** A filter tag, stemmed the same way photoWords stems each photo's terms,
 *  so "nails" (what the model or vocabulary offers) matches a photo whose
 *  only "nails" comes from stemmed prose ("nail"). */
function stemTag(tag: string): string {
  return meaningfulWords(tag)[0] ?? tag;
}

/**
 * The items a filter names.
 *
 * EMPTY FILTER returns every item, in original order, with NO limit —
 * canned rows and the old "show everything" callers depend on this.
 *
 * With a filter: `ids` keep the caller's order and drop unknown ids; `tags`
 * are ANDed against each photo's own words (tags ∪ caption/description
 * words); `query` is a weighted term-overlap search over caption +
 * description + tags, sorted by score descending then original order.
 * `limit` only applies when the filter is non-empty (default 6, max 12,
 * min 1).
 */
export function filterPhotos(items: PhotoMeta[], f: PhotoFilter): PhotoMeta[] {
  if (isEmptyPhotoFilter(f)) return items;

  let out = items;
  const ids = (f.ids ?? []).filter(Boolean);
  if (ids.length) {
    out = ids.map((id) => items.find((i) => i.id === id)).filter((i): i is PhotoMeta => !!i);
  }

  const tags = (f.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean).map(stemTag);
  if (tags.length) {
    out = out.filter((item) => {
      const words = photoWords(item);
      return tags.every((t) => words.has(t));
    });
  }

  const query = (f.query ?? "").trim();
  if (query) {
    const queryWords = meaningfulWords(query);
    // Stem tags the same way photoWords/stemTag do for the `tags` filter
    // above, so a query like "nails" (stemmed to "nail") still overlaps a
    // photo whose only tag is the plural "nails" and whose caption is
    // otherwise neutral — matching the tags filter's own stemmed comparison.
    const docs = out.map((item) => [
      ...meaningfulWords(`${item.caption} ${item.description}`),
      ...item.tags.flatMap((t) => meaningfulWords(t)),
    ]);
    const scored = out
      .map((item, i) => ({ item, score: overlapScore(queryWords, docs[i]) }))
      .filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    out = scored.map((s) => s.item);
  }

  const limit = clampLimit(f.limit);
  return out.slice(0, limit);
}

const MAX_LINE_CHARS = 3000;

/**
 * "PHOTO INDEX" lines for the system prompt: `- <id> | <caption ≤60 chars>
 * | tag1, tag2`. Empty string when there are no photos. Stops adding lines
 * once the running length would exceed `cap`, and appends a "… and N more"
 * tail naming how many were left out, mirroring menuPromptSection.
 */
export function photoIndexLines(items: PhotoMeta[], cap = MAX_LINE_CHARS): string {
  if (!items.length) return "";
  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const item of items) {
    const caption = item.caption.trim().slice(0, 60);
    const tags = item.tags.join(", ");
    const line = `- ${item.id} | ${caption} | ${tags}`;
    if (used + line.length + 1 > cap) break;
    lines.push(line);
    used += line.length + 1;
    shown++;
  }
  const remaining = items.length - shown;
  if (remaining > 0) lines.push(`- … and ${remaining} more`);
  return lines.join("\n");
}

const MAX_VOCAB = 40;

/** Every distinct tag across the photos, most frequent first, capped at 40 —
 *  for the null-result tool message ("No photos match. Tags on file: …"). */
export function tagVocabulary(items: PhotoMeta[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const t of item.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_VOCAB)
    .map(([tag]) => tag);
}

/**
 * Match a name (a service, a staff member…) against a set of captioned
 * photos by word overlap, so a photo the site or the tenant already has can
 * stand in for a picture nobody attached directly.
 *
 * Pure and tiny on purpose: lib/booking/store.ts uses it to illustrate
 * services written from an older tenant's records, and onboarding's
 * services/team extractors reuse it to match a crawled image to what it's
 * a picture of. No imports, so either side can reach it cheaply.
 */

export type GalleryPhoto = { src: string; text: string };

const STOPWORDS = new Set([
  "the", "and", "for", "with", "our", "your", "this", "that", "from", "into",
  "over", "about", "have", "will", "just", "some", "more", "than", "then",
]);

/** Words of 4+ letters, lowercased, stopwords dropped — short connective
 *  words ("a", "spa", "our") would overlap almost anything and mean nothing. */
function meaningfulWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOPWORDS.has(w));
}

/**
 * How many of the name's words a caption must share for the photo to count
 * as a picture OF the thing named: every word of a one- or two-word name,
 * and at least two (and most) of a longer one. One shared word — "massage"
 * in "Our Massage Services" — is a page heading, not a match, and the old
 * one-word rule hung the same hero image on every service on the page.
 */
export function wordsNeeded(nameWords: number): number {
  if (nameWords <= 2) return nameWords;
  return Math.max(2, Math.ceil(nameWords * 0.6));
}

/**
 * The best-matching photo's src, or null when no photo's caption covers
 * enough of `name` (wordsNeeded). Ties keep the first (earliest) photo at
 * that score. `taken` are photos already matched to something else — a
 * picture is of one thing, so it is never handed out twice.
 */
export function bestImageFor(name: string, photos: GalleryPhoto[], taken: ReadonlySet<string> = new Set()): string | null {
  const words = new Set(meaningfulWords(name));
  if (!words.size) return null;
  const needed = wordsNeeded(words.size);
  let best: { src: string; score: number } | null = null;
  for (const p of photos) {
    if (taken.has(p.src)) continue;
    const score = new Set(meaningfulWords(p.text).filter((w) => words.has(w))).size;
    if (score >= needed && (!best || score > best.score)) best = { src: p.src, score };
  }
  return best?.src ?? null;
}

/**
 * Match a name (a service, a staff member…) against a set of
 * captioned photos by word overlap, so a gallery photo the tenant already
 * uploaded can stand in for a picture nobody attached directly.
 *
 * Pure and tiny on purpose: lib/booking/store.ts uses it to illustrate
 * services derived from the old text-only booking form, and onboarding's
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
 * The best-matching photo's src, or null when nothing shares a meaningful
 * word with `name`. Ties keep the first (earliest) photo at that score.
 */
export function bestImageFor(name: string, photos: GalleryPhoto[]): string | null {
  const words = new Set(meaningfulWords(name));
  if (!words.size) return null;
  let best: { src: string; score: number } | null = null;
  for (const p of photos) {
    const score = meaningfulWords(p.text).filter((w) => words.has(w)).length;
    if (score >= 1 && (!best || score > best.score)) best = { src: p.src, score };
  }
  return best?.src ?? null;
}

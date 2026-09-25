/**
 * Match a name (a legacy service, a staff member…) against a set of
 * captioned photos by word overlap, so a gallery photo the tenant already
 * uploaded can stand in for a picture nobody attached directly.
 *
 * Tiny on purpose: lib/booking/store.ts uses it to illustrate services
 * derived from the old text-only booking form, and onboarding's
 * services/team extractors reuse it to match a crawled image to what it's a
 * picture of. The tokenizer is lib/terms.ts's meaningfulWords, shared with
 * the photo/service/project indexes, so every part of the app agrees on what
 * a "meaningful word" is.
 */

import { meaningfulWords as sharedMeaningfulWords } from "@/lib/terms";

export type GalleryPhoto = { src: string; text: string };

/** Words of 4+ letters — short connective words ("a", "spa", "our") would
 *  overlap almost anything and mean nothing. Delegates to the shared
 *  tokenizer (which already drops stopwords and stems) and additionally
 *  drops the 3-letter words it would otherwise keep, preserving this
 *  function's original, slightly stricter behavior. */
function meaningfulWords(s: string): string[] {
  return sharedMeaningfulWords(s).filter((w) => w.length >= 4);
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

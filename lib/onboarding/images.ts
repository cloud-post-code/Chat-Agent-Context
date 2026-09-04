import type { Crawler, Page } from "./crawl";
import { saveBytes } from "@/lib/uploads";

/**
 * The gallery-images stage: photos from the user's site, each with the
 * caption the site itself gives it (figcaption, then alt, then title —
 * never invented; an uncaptioned photo stays uncaptioned for the user to
 * fill in). Every kept image is downloaded through the crawler (on-domain,
 * like the logo) and stored in the app's upload store, so the review card
 * previews `/api/uploads/...` URLs and saving is just row creation.
 */

export const MAX_GALLERY_IMAGES = 25;

export type GalleryImage = { src: string; caption: string };

/** Skip chrome, not content: logos, icons, sprites, tracking pixels. */
const NOISE_RE = /logo|icon|sprite|favicon|pixel|badge|avatar-default|placeholder/i;

/** Pages likely to hold photos: what we already have plus gallery-ish links. */
export async function discoverImagePages(
  crawler: Crawler,
  home: Page,
  preloaded: Page[],
): Promise<Page[]> {
  const seen = new Set<string>([home.url, ...preloaded.map((p) => p.url)]);
  const pages: Page[] = [home, ...preloaded];

  const candidates = crawler
    .navLinks(home)
    .filter((l) => /gallery|photos?|portfolio|our work|projects|services|about|team/i.test(l.text))
    .map((l) => l.url);
  for (const p of ["/gallery", "/photos", "/portfolio", "/work"]) {
    const abs = crawler.resolve(p);
    if (abs) candidates.push(abs);
  }

  for (const url of [...new Set(candidates)].slice(0, 6)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await crawler.load(url);
    if (page) pages.push(page);
  }
  return pages;
}

type Candidate = { url: string; caption: string };

/** Every content image on the pages, deduped, with its stated caption. */
export function collectImageCandidates(crawler: Crawler, pages: Page[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const page of pages) {
    page.$("img").each((_, el) => {
      const $el = page.$(el);
      const rawSrc = $el.attr("src") || $el.attr("data-src") || "";
      if (!rawSrc || rawSrc.startsWith("data:") || /\.svg(\?|$)/i.test(rawSrc)) return;
      const url = crawler.resolve(rawSrc, page.url);
      if (!url || seen.has(url)) return;
      const alt = $el.attr("alt") || "";
      const hint = `${rawSrc} ${$el.attr("class") || ""} ${alt}`;
      if (NOISE_RE.test(hint)) return;
      const w = Number($el.attr("width") || 0);
      const h = Number($el.attr("height") || 0);
      if ((w && w < 80) || (h && h < 80)) return; // stated-tiny: an icon
      const figcaption = $el.closest("figure").find("figcaption").first().text().trim();
      seen.add(url);
      out.push({ url, caption: figcaption || alt.trim() || $el.attr("title")?.trim() || "" });
    });
  }
  return out;
}

/**
 * Download candidates into the upload store until MAX_GALLERY_IMAGES stick.
 * Failures (off-domain, unsupported format, dead link) are skipped silently —
 * the gallery is best-effort by design.
 */
export async function extractImages(
  crawler: Crawler,
  home: Page,
  preloaded: Page[],
  log: (msg: string) => void,
): Promise<GalleryImage[]> {
  const pages = await discoverImagePages(crawler, home, preloaded);
  const candidates = collectImageCandidates(crawler, pages);
  log(candidates.length
    ? `Found ${candidates.length} photo${candidates.length === 1 ? "" : "s"} across ${pages.length} page${pages.length === 1 ? "" : "s"}`
    : "No photos found on this site");

  const images: GalleryImage[] = [];
  for (const c of candidates) {
    if (images.length >= MAX_GALLERY_IMAGES) break;
    const got = await crawler.loadBytes(c.url);
    if (!got) continue;
    try {
      const filename = await saveBytes(got.bytes, got.contentType);
      images.push({ src: `/api/uploads/${filename}`, caption: c.caption });
      log(c.caption ? `Imported photo: ${c.caption}` : `Imported photo ${images.length}`);
    } catch {
      // unsupported format — skip
    }
  }
  return images;
}

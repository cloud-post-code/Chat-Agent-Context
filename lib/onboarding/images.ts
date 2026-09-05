import type { Crawler, Page } from "./crawl";
import { saveBytes } from "@/lib/uploads";
import { llmExtractVision, type VisionImage, type VisionMediaType } from "./knowledgeLlm";

/**
 * The gallery-images stage. Candidates are collected from the crawled pages
 * (rendered <img> sources plus CSS background heroes), downloaded, and then
 * CURATED by the model looking at the actual pixels: it keeps only photos a
 * potential customer would care about, writes each kept photo's caption from
 * what the image shows (the site's alt text is context, never the caption —
 * alt text is routinely a person's name), and steers the set toward variety.
 * Kept images land in the app's upload store, so the review card previews
 * `/api/uploads/...` URLs and saving is just row creation.
 */

export const MAX_GALLERY_IMAGES = 25;

/** Candidates downloaded for the model to look at; the rest never upload. */
const MAX_CANDIDATE_DOWNLOADS = 60;

/** Images per vision call — enough for cross-image diversity judgment. */
const VISION_BATCH = 10;

/** Anthropic's per-image request ceiling, with headroom. */
const MAX_IMAGE_BYTES = 3_500_000;

const VISION_TYPES = new Set<VisionMediaType>([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);

export const GALLERY_SYSTEM_PROMPT = `You curate photos scraped from a business's website into the photo gallery of that business's customer-facing page, and caption the ones you keep. Each numbered image arrives with the site's own alt text as context.

Rules:
- "keep" is true for an image a potential customer would find useful or interesting: the storefront or premises, work being done, finished work, products, food, spaces, equipment, the team at work. Genuine photos and realistic renderings of the business's work both count. Most real photographs a business puts on its own site ARE worth keeping — exclusion is for junk, not editorial taste; when unsure whether a customer would care, keep it.
- Always exclude: logos, icons, avatar or profile-picture tiles (letter/initial placeholders, generated avatars), webcam-style headshots, screenshots of software, charts, badges, text-only banners, and empty or decorative filler.
- "caption" (kept images only) is one short sentence you write describing what the IMAGE SHOWS. Never use a person's name and never copy the alt text — alt text is often just a name ("Peter Richmond"), which tells a customer nothing. Describe the scene: "A barber trimming a client's hair at the chair."
- "subject" is a 1-3 word category for the image ("storefront", "haircut", "products").
- Variety is a tie-breaker, not a quota: only when images are near-duplicate shots of the SAME scene keep just the best one or two. Different photos of the same kind of work (e.g. many different haircuts) are each worth keeping. ALREADY_KEPT lists subjects from earlier batches — use it to spot near-duplicates, not to veto a category.

Respond with ONLY this JSON, no other text:
{"images":[{"index":0,"keep":false,"caption":"","subject":""}]}`;

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

/** The largest-descriptor url out of a srcset attribute, "" when unusable. */
function largestSrcsetUrl(srcset: string): string {
  let best = "";
  let bestSize = -1;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = parseFloat(descriptor || "1") || 1;
    if (size > bestSize) {
      bestSize = size;
      best = url;
    }
  }
  return best;
}

/** Absolute url for an image the site displayed. Images may live on another
 *  host (a CDN) — unlike page crawling, they are not origin-pinned. */
function resolveImageUrl(raw: string, pageUrl: string): string | null {
  try {
    const u = new URL(raw, pageUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Every content image on the pages, deduped, with its stated caption:
 *  rendered/lazy/srcset <img> sources plus large CSS background heroes. */
export function collectImageCandidates(crawler: Crawler, pages: Page[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const page of pages) {
    page.$("img").each((_, el) => {
      const $el = page.$(el);
      // The crawler stamps the browser-rendered source (currentSrc) on every
      // image; lazy loaders and srcset keep the real url out of plain src.
      const rawSrc =
        $el.attr("data-crawl-src") || $el.attr("src") || $el.attr("data-src") ||
        largestSrcsetUrl($el.attr("srcset") || $el.attr("data-srcset") || "");
      if (!rawSrc || rawSrc.startsWith("data:") || /\.svg(\?|$)/i.test(rawSrc)) return;
      const url = resolveImageUrl(rawSrc, page.url);
      if (!url || seen.has(url)) return;
      const alt = $el.attr("alt") || "";
      const hint = `${rawSrc} ${$el.attr("class") || ""} ${alt}`;
      if (NOISE_RE.test(hint)) return;
      const w = Number($el.attr("width") || 0);
      const h = Number($el.attr("height") || 0);
      if ((w && w < 80) || (h && h < 80)) return; // stated-tiny: an icon
      const nw = Number($el.attr("data-crawl-w") || 0);
      const nh = Number($el.attr("data-crawl-h") || 0);
      if (nw && nh && (nw < 80 || nh < 80)) return; // rendered-tiny: an icon
      const figcaption = $el.closest("figure").find("figcaption").first().text().trim();
      seen.add(url);
      out.push({ url, caption: figcaption || alt.trim() || $el.attr("title")?.trim() || "" });
    });
    // CSS background heroes never appear as <img>; the crawler measures them.
    for (const bg of page.rendered?.bgImages ?? []) {
      if (/\.svg(\?|$)/i.test(bg.url) || NOISE_RE.test(bg.url)) continue;
      const url = resolveImageUrl(bg.url, page.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, caption: "" });
    }
  }
  return out;
}

type Downloaded = Candidate & { bytes: Buffer; mediaType: VisionMediaType };

/** The type the BYTES say they are — servers mislabel content-type, and the
 *  vision API rejects an image whose media_type doesn't match its bytes. */
function sniffImageType(bytes: Buffer): VisionMediaType | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

/** Fetch candidate bytes the model can look at; the rest are dropped. */
async function downloadCandidates(
  crawler: Crawler,
  candidates: Candidate[],
): Promise<Downloaded[]> {
  const out: Downloaded[] = [];
  for (const c of candidates) {
    if (out.length >= MAX_CANDIDATE_DOWNLOADS) break;
    const got = await crawler.loadImageBytes(c.url);
    if (!got || got.bytes.length > MAX_IMAGE_BYTES) continue;
    const mediaType = sniffImageType(got.bytes);
    if (!mediaType || !VISION_TYPES.has(mediaType)) continue;
    out.push({ ...c, bytes: got.bytes, mediaType });
  }
  return out;
}

const capStr = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * The model pass over one batch of downloaded images: keep/exclude, a
 * model-written caption for each kept image, and its subject for diversity.
 */
async function curateBatch(
  batch: Downloaded[],
  keptSubjects: string[],
  log: (msg: string) => void,
): Promise<{ item: Downloaded; caption: string; subject: string }[]> {
  const visionImages: VisionImage[] = batch.map((d, i) => ({
    bytes: d.bytes,
    mediaType: d.mediaType,
    label: `IMAGE index ${i} | site alt text: ${d.caption || "(none)"}`,
  }));
  const raw = await llmExtractVision(
    GALLERY_SYSTEM_PROMPT,
    visionImages,
    `ALREADY_KEPT: ${keptSubjects.join(", ") || "(none)"}`,
    1500,
    log,
  );
  if (process.env.DEBUG_GALLERY) console.error("curate raw:", JSON.stringify(raw));
  const out: { item: Downloaded; caption: string; subject: string }[] = [];
  if (!Array.isArray(raw.images)) return out;
  for (const entry of raw.images) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const item = typeof e.index === "number" ? batch[e.index] : undefined;
    if (!item || e.keep !== true) continue;
    out.push({ item, caption: capStr(e.caption, 300), subject: capStr(e.subject, 60) });
  }
  return out;
}

/**
 * Collect → download → model curation → upload store. Download failures and
 * unsupported formats are skipped silently; a failed model call throws, like
 * every other extraction stage.
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
  if (!candidates.length) return [];

  const downloaded = await downloadCandidates(crawler, candidates);
  log(`Looking at ${downloaded.length} of them to pick the ones customers would care about`);

  const images: GalleryImage[] = [];
  const keptSubjects: string[] = [];
  for (let i = 0; i < downloaded.length && images.length < MAX_GALLERY_IMAGES; i += VISION_BATCH) {
    const kept = await curateBatch(downloaded.slice(i, i + VISION_BATCH), keptSubjects, log);
    for (const k of kept) {
      if (images.length >= MAX_GALLERY_IMAGES) break;
      try {
        const filename = await saveBytes(k.item.bytes, k.item.mediaType);
        images.push({ src: `/api/uploads/${filename}`, caption: k.caption });
        if (k.subject) keptSubjects.push(k.subject);
        log(k.caption ? `Kept photo: ${k.caption}` : `Kept photo ${images.length}`);
      } catch {
        // upload-store rejection — skip
      }
    }
  }
  log(`Gallery: kept ${images.length} of ${downloaded.length} photos`);
  return images;
}

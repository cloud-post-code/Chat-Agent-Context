import * as cheerio from "cheerio";

/**
 * Crawler for the guided onboarding flow. Renders pages with Playwright
 * Chromium only, so JS-built sites extract like static ones; a browser that
 * can't launch is an error surfaced to the job, never a silent downgrade.
 * Everything is pinned to the entered site's origin — offsite URLs are
 * refused at the one place all fetches go through.
 */

/** Ground truth read off the rendered page: computed styles and CSS
 *  background images that never appear in the HTML or inline <style> text. */
export type Rendered = {
  /** Page background/text as hex, resolved from computed styles. */
  bg: string;
  text: string;
  fontFamily: string;
  fontSizePx: number;
  headingWeight: string;
  /** Border-radius of the most rounded prominent control, in px. */
  radiusPx: number;
  /** Saturated fills seen on controls/sections, most frequent first. */
  brandColors: { hex: string; count: number }[];
  /** Large CSS background-image urls (heroes, banners), biggest first. */
  bgImages: { url: string; w: number; h: number }[];
};

export type Page = { url: string; html: string; $: cheerio.CheerioAPI; rendered?: Rendered };

// The two in-page scripts are plain-JS STRINGS, not functions: Playwright
// serializes a function via toString(), and both tsx and Next's bundler
// inject module-scope helpers (esbuild's __name) into compiled functions,
// which don't exist inside the browser page and throw ReferenceError there.

/** Runs in the page: walk the document once so lazily-loaded media appears. */
const lazyScroll = `(async () => {
  const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
  const limit = Math.min(document.body.scrollHeight, 12000);
  for (let y = 0; y <= limit; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 100));
  }
  window.scrollTo(0, 0);
})()`;

/**
 * Runs in the page: read computed styles and rendered media the HTML alone
 * can't show — external-stylesheet colors, lazy/srcset image urls (stamped
 * onto each <img> as data-crawl-* for the cheerio pass), and CSS background
 * heroes. Pure observation; interpreting it stays with the model.
 * Evaluates to a Rendered value.
 */
const renderDigest = `(() => {
  const toHex = (c) => {
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return "";
    return "#" + [m[1], m[2], m[3]]
      .map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  };
  const chan = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const satOf = (hex) => {
    const c = chan(hex);
    const max = Math.max(...c);
    return max === 0 ? 0 : (max - Math.min(...c)) / max;
  };
  const lumOf = (hex) => chan(hex).reduce((a, b) => a + b) / 765;

  const bodyStyle = getComputedStyle(document.body);
  let bg = toHex(bodyStyle.backgroundColor) ||
    toHex(getComputedStyle(document.documentElement).backgroundColor);
  const all = [...document.querySelectorAll("*")].slice(0, 2000);
  if (!bg) {
    const big = all.find(
      (el) => el.offsetWidth >= window.innerWidth * 0.9 &&
        el.offsetHeight >= window.innerHeight * 0.5 &&
        toHex(getComputedStyle(el).backgroundColor),
    );
    bg = big ? toHex(getComputedStyle(big).backgroundColor) : "#ffffff";
  }

  const heading = document.querySelector("h1, h2, h3");
  const tally = new Map();
  let radiusPx = 0;
  const bgImgs = new Map();
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (el.offsetWidth > 0 && el.offsetHeight > 0) {
      const fill = toHex(cs.backgroundColor);
      if (fill && satOf(fill) > 0.25 && lumOf(fill) > 0.15 && lumOf(fill) < 0.85) {
        tally.set(fill, (tally.get(fill) ?? 0) + 1);
      }
      if (el.matches('a, button, input, [class*="btn" i], [class*="button" i]')) {
        radiusPx = Math.max(radiusPx, parseFloat(cs.borderTopLeftRadius) || 0);
      }
      const m = cs.backgroundImage.match(/url\\((['"]?)(.*?)\\1\\)/);
      if (m && !m[2].startsWith("data:") && el.offsetWidth >= 80 && el.offsetHeight >= 80) {
        const prev = bgImgs.get(m[2]);
        if (!prev || prev.w * prev.h < el.offsetWidth * el.offsetHeight) {
          bgImgs.set(m[2], { url: m[2], w: el.offsetWidth, h: el.offsetHeight });
        }
      }
    }
  }
  for (const img of document.querySelectorAll("img")) {
    if (img.currentSrc || img.src) img.setAttribute("data-crawl-src", img.currentSrc || img.src);
    img.setAttribute("data-crawl-w", String(img.naturalWidth));
    img.setAttribute("data-crawl-h", String(img.naturalHeight));
  }

  return {
    bg,
    text: toHex(bodyStyle.color) || "#000000",
    fontFamily: bodyStyle.fontFamily.split(",")[0].replace(/['"]/g, "").trim(),
    fontSizePx: Math.round(parseFloat(bodyStyle.fontSize) || 0),
    headingWeight: heading ? getComputedStyle(heading).fontWeight : "",
    radiusPx: Math.round(radiusPx),
    brandColors: [...tally.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([hex, count]) => ({ hex, count })),
    bgImages: [...bgImgs.values()].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 20),
  };
})()`;

export class Crawler {
  readonly origin: string;
  private cache = new Map<string, Page | null>();
  private browser: import("playwright").Browser | null = null;
  /** Real-time activity callback — the onboarding chat streams these lines. */
  onEvent?: (msg: string) => void;

  constructor(entryUrl: string, onEvent?: (msg: string) => void) {
    this.origin = new URL(entryUrl).origin;
    this.onEvent = onEvent;
  }

  /** Resolve a possibly-relative href against the site; null when offsite. */
  resolve(href: string, base?: string): string | null {
    try {
      const u = new URL(href, base || this.origin);
      if (u.origin !== this.origin) return null;
      u.hash = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  private async page(): Promise<import("playwright").Page> {
    if (!this.browser) {
      // Playwright's import self-checks the Node version and can hard-exit
      // the process on <20 — never even import it there (deploy safety).
      if (Number(process.versions.node.split(".")[0]) < 20) {
        throw new Error("Onboarding extraction needs Node 20+ to run its Playwright browser");
      }
      try {
        const { chromium } = await import("playwright");
        this.browser = await chromium.launch({ headless: true });
      } catch (err) {
        throw new Error(
          `Could not launch the Playwright browser: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    }
    return this.browser.newPage();
  }

  /** Render one on-domain page as parsed HTML. Cached; null when the page
   *  itself fails to load. A browser that can't launch throws instead. */
  async load(url: string): Promise<Page | null> {
    const abs = this.resolve(url);
    if (!abs) return null;
    if (this.cache.has(abs)) return this.cache.get(abs)!;
    this.onEvent?.(`Reading ${abs.replace(this.origin, "") || "/"}`);

    let html: string | null = null;
    let rendered: Rendered | undefined;
    const p = await this.page();
    try {
      const res = await p.goto(abs, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (res && res.ok()) {
        // JS-built sites paint after domcontentloaded; give the network a
        // beat to settle and scroll once so lazy content actually loads.
        await p.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        await p.evaluate(lazyScroll).catch(() => {});
        await p.waitForTimeout(300);
        rendered = (await p.evaluate(renderDigest).catch(() => undefined)) as
          | Rendered
          | undefined;
        html = await p.content();
      }
    } catch {
      html = null;
    } finally {
      await p.close().catch(() => {});
    }

    const page = html !== null ? { url: abs, html, $: cheerio.load(html), rendered } : null;
    this.cache.set(abs, page);
    return page;
  }

  /** Fetch an on-domain non-HTML resource (feeds, sitemaps). Null on failure. */
  async loadText(url: string): Promise<string | null> {
    const abs = this.resolve(url);
    if (!abs) return null;
    try {
      const res = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  }

  /** Fetch on-domain binary bytes (the logo). Null on failure. */
  async loadBytes(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const abs = this.resolve(url);
    if (!abs) return null;
    try {
      const res = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: (res.headers.get("content-type") || "").split(";")[0].trim(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch image bytes from a url the crawled site itself displayed. Unlike
   * loadBytes this allows other hosts — sites routinely serve their own
   * photos from a CDN (Shopify, Cloudinary, wp.com) — so callers must only
   * pass urls collected off a crawled page, never user input. Null on failure.
   */
  async loadImageBytes(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    let abs: URL;
    try {
      abs = new URL(url, this.origin);
    } catch {
      return null;
    }
    if (abs.protocol !== "https:" && abs.protocol !== "http:") return null;
    try {
      const res = await fetch(abs, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return null;
      return {
        bytes: Buffer.from(await res.arrayBuffer()),
        contentType: (res.headers.get("content-type") || "").split(";")[0].trim(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Page URLs from the site's sitemap, on-domain only. Tries the common
   * locations plus robots.txt's Sitemap line, and follows one level of
   * sitemap-index nesting (the WordPress/Yoast shape). Empty when none.
   */
  async sitemap(): Promise<string[]> {
    const candidates = ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"];
    const robots = await this.loadText("/robots.txt");
    for (const m of robots?.matchAll(/^sitemap:\s*(\S+)/gim) ?? []) {
      // News sitemaps list only the last couple of days — never the site.
      if (!/news/i.test(m[1])) candidates.unshift(m[1]);
    }

    for (const c of candidates) {
      const first = await this.loadText(c);
      if (!first || !/<(urlset|sitemapindex)[\s>]/.test(first)) continue;

      // BFS the index tree (Jetpack/Yoast nest 2+ levels), bounded so a
      // pathological index can't stall onboarding. A <loc> ending in .xml is
      // another sitemap; anything else is a page. Image/video sitemaps are
      // skipped — they never carry crawlable pages.
      const urls = new Set<string>();
      const docs = [first];
      const seenDocs = new Set([c]);
      while (docs.length && seenDocs.size <= 25 && urls.size < 2000) {
        const xml = docs.shift()!;
        for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
          const abs = this.resolve(m[1]);
          if (!abs) continue;
          if (/\.xml(\?|$)/.test(abs)) {
            if (seenDocs.has(abs) || /image|video/.test(abs)) continue;
            seenDocs.add(abs);
            const body = await this.loadText(abs);
            if (body) docs.push(body);
          } else {
            urls.add(abs);
          }
        }
      }
      if (urls.size) return [...urls];
    }
    return [];
  }

  /** Every on-domain nav/footer link on a page, with its visible text. */
  navLinks(page: Page): { text: string; url: string }[] {
    const out: { text: string; url: string }[] = [];
    page.$("nav a, header a, footer a").each((_, el) => {
      const href = page.$(el).attr("href");
      const url = href ? this.resolve(href, page.url) : null;
      if (url) out.push({ text: page.$(el).text().trim(), url });
    });
    return out;
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
}

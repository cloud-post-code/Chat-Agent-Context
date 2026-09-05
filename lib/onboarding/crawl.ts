import * as cheerio from "cheerio";

/**
 * Crawler for the guided onboarding flow. Renders pages with Playwright
 * Chromium only, so JS-built sites extract like static ones; a browser that
 * can't launch is an error surfaced to the job, never a silent downgrade.
 * Everything is pinned to the entered site's origin — offsite URLs are
 * refused at the one place all fetches go through.
 */

export type Page = { url: string; html: string; $: cheerio.CheerioAPI };

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
    const p = await this.page();
    try {
      const res = await p.goto(abs, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (res && res.ok()) html = await p.content();
    } catch {
      html = null;
    } finally {
      await p.close().catch(() => {});
    }

    const page = html !== null ? { url: abs, html, $: cheerio.load(html) } : null;
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

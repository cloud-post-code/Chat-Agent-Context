import * as cheerio from "cheerio";
import { isPublicHostname, isPublicTarget } from "./netGuard";
import { createLimiter, onboardingConcurrency, type Limiter } from "./pool";

/**
 * Crawler for the guided onboarding flow. Renders pages with Playwright
 * Chromium only, so JS-built sites extract like static ones; a browser that
 * can't launch is an error surfaced to the job, never a silent downgrade.
 * Everything is pinned to the entered site's origin — offsite URLs are
 * refused at the one place all fetches go through.
 */

/** Ground truth read off the rendered page: computed styles and CSS
 *  background images that never appear in the HTML or inline <style> text. */
type Rendered = {
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

/**
 * Runs in the page BEFORE the lazy scroll: measure the page's real ground.
 * Many sites leave <body> white and paint the real background per-section
 * (dark sections stacked down the page) or on a full-page wrapper — the
 * body's computed color is then NOT what a visitor sees. Tally full-width
 * painted elements by the page height each fill covers; when one fill covers
 * enough of the page it IS the ground. Evaluates to a hex string or "".
 * Must run pre-scroll: scroll-triggered animations (Webflow interactions)
 * transform and collapse sections, wrecking the height tally afterwards.
 */
const groundProbe = `(() => {
  const toHex = (c) => {
    const m = c.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return "";
    return "#" + [m[1], m[2], m[3]]
      .map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  };
  const pageH = Math.max(document.body.scrollHeight, window.innerHeight);
  const tally = new Map();
  for (const el of [...document.querySelectorAll("*")].slice(0, 2000)) {
    if (el === document.body || el === document.documentElement) continue;
    const fill = toHex(getComputedStyle(el).backgroundColor);
    if (!fill || el.offsetWidth < window.innerWidth * 0.85) continue;
    // A child repainting its parent's fill covers no new ground.
    if (el.parentElement &&
      toHex(getComputedStyle(el.parentElement).backgroundColor) === fill) continue;
    tally.set(fill, (tally.get(fill) ?? 0) + el.offsetHeight);
  }
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] >= pageH * 0.4 ? top[0] : "";
})()`;

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
      // Muted and dark brand fills count too (forest green, navy) — only
      // near-grays, near-black, and near-white are excluded as non-colors.
      if (fill && satOf(fill) > 0.18 && lumOf(fill) > 0.04 && lumOf(fill) < 0.85) {
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

type Browser = import("playwright").Browser;
type BrowserContext = import("playwright").BrowserContext;
type BrowserPage = import("playwright").Page;

/**
 * The browser's own user agent with the one word that marks an automated
 * launch removed: headless Chromium calls itself "HeadlessChrome", and some
 * sites refuse to render for that name alone. Version and platform
 * stay exactly what the browser reports.
 */
export function plainUserAgent(ua: string): string {
  return ua.replace(/HeadlessChrome\//g, "Chrome/");
}

/** What a page's own requests ran into, kept per page for the activity log. */
export type PageDiag = {
  /** Requests the network guard refused, counted by host. */
  blocked: Map<string, number>;
  /** Responses of 400+ and requests that died in the network, "status host/path". */
  failed: string[];
  /** Uncaught errors the page's scripts threw. */
  errors: string[];
};

const DIAG_CAP = 20;
const diags = new WeakMap<BrowserPage, PageDiag>();

const shortUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
};

/**
 * One line saying why a page may have shown nothing: how many requests the
 * network guard refused (and to where), which ones failed, what the page's
 * scripts threw. "" when nothing went wrong that the browser could see.
 */
export function summarizeDiag(d: PageDiag): string {
  const parts: string[] = [];
  const blocked = [...d.blocked.values()].reduce((a, b) => a + b, 0);
  if (blocked) {
    parts.push(`${blocked} request${blocked === 1 ? "" : "s"} refused by the network guard (${[...d.blocked.keys()].slice(0, 3).join(", ")})`);
  }
  if (d.failed.length) parts.push(`${d.failed.length} failed: ${d.failed.slice(0, 3).join("; ")}`);
  if (d.errors.length) parts.push(`script error: ${d.errors.slice(0, 2).join("; ")}`);
  return parts.join(" · ");
}

/** The diagnostic line for a page guardedContext opened; "" for any other page. */
function pageDiagnostics(page: BrowserPage): string {
  const d = diags.get(page);
  return d ? summarizeDiag(d) : "";
}

/** Whether the browser may make this request: http(s) to a public host (netGuard.ts). */
async function requestAllowed(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (!isPublicHostname(u.hostname)) return false;
  return isPublicTarget(url);
}

/**
 * A browser context held to the network policy, and one page in it. Every
 * request the page (or any frame, worker or redirect in it) makes goes through
 * `requestAllowed`: anything else is aborted, which a page sees as a failed
 * load, never as an exception here. Downloads are refused, service workers
 * blocked, popups closed as they open, and dialogs dismissed so a page can't
 * hold the read. The caller closes the context.
 */
async function guardedContext(
  browser: Browser,
  userAgent?: string,
): Promise<{ context: BrowserContext; page: BrowserPage }> {
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
    // The browser's own user agent minus its "Headless" mark (plainUserAgent);
    // the crawler reads it once per launch. Left out, the browser's default.
    ...(userAgent ? { userAgent } : {}),
  });
  const diag: PageDiag = { blocked: new Map(), failed: [], errors: [] };
  const note = (list: string[], line: string) => {
    if (list.length < DIAG_CAP) list.push(line);
  };
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    let ok = false;
    try {
      ok = await requestAllowed(url);
    } catch {
      ok = false;
    }
    if (!ok) {
      let host = "";
      try {
        host = new URL(url).hostname || url.slice(0, 40);
      } catch {
        host = url.slice(0, 40);
      }
      diag.blocked.set(host, (diag.blocked.get(host) ?? 0) + 1);
    }
    try {
      if (ok) await route.continue();
      else await route.abort("blockedbyclient");
    } catch {
      // The context closed under the request; nothing to answer.
    }
  });
  const page = await context.newPage();
  diags.set(page, diag);
  page.on("response", (res) => {
    if (res.status() >= 400) note(diag.failed, `${res.status()} ${shortUrl(res.url())}`);
  });
  page.on("requestfailed", (req) => {
    const why = req.failure()?.errorText ?? "";
    // The guard's own refusals are counted above, not here.
    if (why && !/BLOCKED_BY_CLIENT|ERR_ABORTED/.test(why)) note(diag.failed, `${why} ${shortUrl(req.url())}`);
  });
  page.on("pageerror", (err) => note(diag.errors, err.message.slice(0, 120)));
  context.on("page", (p) => {
    if (p !== page) p.close().catch(() => {});
  });
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  return { context, page };
}

/** The browser's default user agent, read off a blank page once per launch, with its "Headless" mark removed. "" when it can't be read. */
async function learnUserAgent(browser: Browser): Promise<string> {
  let context: BrowserContext | null = null;
  try {
    context = await browser.newContext();
    const page = await context.newPage();
    const ua = (await page.evaluate("navigator.userAgent")) as unknown;
    return typeof ua === "string" ? plainUserAgent(ua) : "";
  } catch {
    return "";
  } finally {
    await context?.close().catch(() => {});
  }
}

export class Crawler {
  readonly origin: string;
  private cache = new Map<string, Page | null>();
  /** Renders under way, so two agents asking for one url share one tab. */
  private inflight = new Map<string, Promise<Page | null>>();
  private launching: Promise<Browser> | null = null;
  /** The launched browser's user agent, minus its "Headless" mark; "" until known. */
  private ua = "";
  private closed = false;
  /** Caps open tabs across every agent sharing this crawler: the extractors
   *  run side by side, and each one fans its own page loads out too. */
  private limit: Limiter;
  /** Real-time activity callback — the onboarding chat streams these lines. */
  onEvent?: (msg: string) => void;

  constructor(entryUrl: string, onEvent?: (msg: string) => void, concurrency = onboardingConcurrency()) {
    this.origin = new URL(entryUrl).origin;
    this.onEvent = onEvent;
    this.limit = createLimiter(concurrency);
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

  /** Launch the browser once. Concurrent first loads share the one launch —
   *  each launching its own would leak every browser but the last. */
  private launch(): Promise<Browser> {
    this.launching ??= (async () => {
      // Playwright's import self-checks the Node version and can hard-exit
      // the process on <20 — never even import it there (deploy safety).
      if (Number(process.versions.node.split(".")[0]) < 20) {
        throw new Error("Onboarding extraction needs Node 20+ to run its Playwright browser");
      }
      try {
        const { chromium } = await import("playwright");
        // AutomationControlled is what sets navigator.webdriver on an
        // automated launch; without it the browser reports what a visitor's
        // would. Nothing else about the browser is changed.
        const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
        this.ua = await learnUserAgent(browser);
        return browser;
      } catch (err) {
        throw new Error(
          `Could not launch the Playwright browser: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`,
        );
      }
    })();
    // A failed launch is not remembered: the next load tries again, as before.
    this.launching.catch(() => (this.launching = null));
    return this.launching;
  }

  /** A fresh guarded context with one tab, or null when the crawler was
   *  closed while the browser was still launching. */
  private async tab(): Promise<{ context: BrowserContext; page: BrowserPage } | null> {
    const browser = await this.launch();
    return this.closed ? null : guardedContext(browser, this.ua || undefined);
  }

  /** Render one on-domain page as parsed HTML. Cached; null when the page
   *  itself fails to load. A browser that can't launch throws instead.
   *  Safe to call concurrently: a url is rendered once however many callers
   *  ask, and at most `concurrency` tabs are open at a time. */
  async load(url: string): Promise<Page | null> {
    const abs = this.resolve(url);
    if (!abs) return null;
    if (this.cache.has(abs)) return this.cache.get(abs)!;
    const pending = this.inflight.get(abs);
    if (pending) return pending;
    const render = this.limit(() => this.render(abs)).finally(() => this.inflight.delete(abs));
    this.inflight.set(abs, render);
    return render;
  }

  private async render(abs: string): Promise<Page | null> {
    // A closed crawler never relaunches: when one agent fails the job, the
    // others' queued loads must wind down, not reopen a browser nobody closes.
    if (this.closed) return null;
    this.onEvent?.(`Reading ${abs.replace(this.origin, "") || "/"}`);

    let html: string | null = null;
    let rendered: Rendered | undefined;
    const tab = await this.tab();
    if (!tab) return null;
    const p = tab.page;
    try {
      const res = await p.goto(abs, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (res && res.ok()) {
        // JS-built sites paint after domcontentloaded; give the network a
        // beat to settle and scroll once so lazy content actually loads.
        await p.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
        // Measure the ground BEFORE scrolling — scroll animations distort it.
        const ground = (await p.evaluate(groundProbe).catch(() => "")) as string;
        await p.evaluate(lazyScroll).catch(() => {});
        await p.waitForTimeout(300);
        rendered = (await p.evaluate(renderDigest).catch(() => undefined)) as
          | Rendered
          | undefined;
        if (rendered && ground) rendered.bg = ground;
        html = await p.content();
        // A page that answered but painted no words at all is worth a line
        // of its own — with what its requests ran into, so a blocked or
        // failing widget is named rather than guessed at.
        const words = (await p.evaluate("document.body ? document.body.innerText.trim().length : 0").catch(() => -1)) as number;
        if (words === 0) {
          const why = pageDiagnostics(p);
          this.onEvent?.(`${abs.replace(this.origin, "") || "/"} rendered blank${why ? ` — ${why}` : ""}`);
        }
      }
    } catch {
      html = null;
    } finally {
      await tab.context.close().catch(() => {});
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
    // A crawled page can point an <img> anywhere; the server's own fetch
    // must stay on the public internet just like the browser does.
    if (!(await isPublicTarget(abs.toString()))) return null;
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

  /** Close for good. Waits out a launch still under way so that browser is
   *  closed too, not orphaned; loads queued behind it come back null. */
  async close(): Promise<void> {
    this.closed = true;
    const launching = this.launching;
    this.launching = null;
    const browser = await launching?.catch(() => null);
    await browser?.close().catch(() => {});
  }
}

import { prisma } from "@/lib/db";
import { chunkText } from "@/lib/retrieval/chunking";
import { embedTexts, vecToBytes } from "@/lib/retrieval/embed";
import type { Crawler, Page } from "./crawl";
import { mapPool, onboardingConcurrency } from "./pool";
import { onboardingIngestKind } from "@/lib/ingestionSources";
import {
  BLOG_SYSTEM_PROMPT, TESTIMONIALS_SYSTEM_PROMPT, TEAM_SYSTEM_PROMPT, GENERAL_SYSTEM_PROMPT,
  llmExtract, llmPageText, llmCorpus,
  sanitizePost, sanitizeTestimonials, sanitizePeople, sanitizeFacts,
} from "./knowledgeLlm";

/**
 * Step 3 of guided onboarding: four extractions against the entered site,
 * saved through the app's existing knowledge storage — Source rows chunked
 * and embedded exactly like admin-ingested links (embedTexts picks Voyage or
 * the local hash embedder; no new provider). Each category extracts with its
 * OWN system prompt (knowledgeLlm.ts) — the general catch-all turns every
 * remaining page into discrete facts. Extraction is model-only; a failed call
 * fails the stage rather than degrading to a parser. Entity extraction is
 * skipped here: it costs a model call per origin and the graph back-fills the
 * next time each source is reindexed from the dashboard.
 *
 * Every extractor is safe to run alongside the others and fans its own
 * per-page work out through `mapPool` (pool.ts): page renders are capped by
 * the shared Crawler, model calls by the shared model gate, and results are
 * gathered in input order so dedup and the report read as the serial run did.
 *
 * Dedup rules the report asserts: a blog post is saved once no matter how
 * many index/category/feed pages list it; a testimonial repeated on the
 * homepage is one record; an identical bio block is one record.
 */

export type BlogReport = {
  existed: boolean;
  postsSaved: number;
  uniqueUrls: number;
  feedCount: number | null;
  paginationPages: string[];
};
type TestimonialItem = {
  quote: string;
  author: string;
  title: string;
  sourceUrl: string;
  imageUrl: string;
};
export type KnowledgeReport = {
  blog: BlogReport;
  testimonials: {
    count: number; items: TestimonialItem[]; pagesChecked: string[];
    /** Reviews are rendered by a third-party JS widget — not in the HTML. */
    embeddedWidget?: boolean;
  };
  team: { existed: boolean; blocks: number; embeddingDim: number; pagesChecked: string[] };
  sweep: { pages: string[] };
  /** The services-and-booking extractor (lib/onboarding/services.ts). */
  services: import("./services").ServicesReport;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// Upper bounds so onboarding a very large site finishes in one sitting.
// Pagination/archives are walked fully up to these; a capped run is visible
// in the report (uniqueUrls > postsSaved, sweep stops at the cap).
const MAX_POSTS = 100;
const MAX_LISTING_PAGES = 50;
const MAX_SWEEP_PAGES = 40;

/**
 * Per-page agents (one blog post, one swept page) in progress at a time. Each
 * is a render, then a model call, then a save — and the render and the model
 * call are each capped on their own (the Crawler's tabs, pool.ts's model
 * gate). Twice the cap keeps both busy: while some agents wait on the model,
 * the rest are already rendering the pages that go next.
 */
const PAGE_AGENTS = () => {
  const n = onboardingConcurrency();
  return n === 1 ? 1 : n * 2; // 1 means strictly one thing at a time
};

/** One Source row + one Chunk per piece, through the existing pipeline.
 *  Exported for the services extractor (lib/onboarding/services.ts). */
export async function saveKnowledgeRecord(
  userId: string,
  src: { url: string; title: string; kind: string; summary?: string; rawText: string },
  pieces: string[],
): Promise<{ chunks: number; dim: number }> {
  const texts = pieces.map(norm).filter(Boolean);
  if (!texts.length) return { chunks: 0, dim: 0 };
  const { vectors, model } = await embedTexts(texts);

  const source = await prisma.source.upsert({
    where: { userId_url: { userId, url: src.url } },
    // `kind` is in the update branch too: a site onboarded before the rows
    // carried `ingest:` marks (or re-onboarded after) re-tags in place instead
    // of keeping a stale mark that hides it from its Content tab.
    update: {
      title: src.title, kind: src.kind, rawText: src.rawText,
      summary: src.summary ?? "", status: "scanned",
    },
    create: {
      userId, type: "link", url: src.url, title: src.title, kind: src.kind,
      rawText: src.rawText, summary: src.summary ?? "", status: "scanned",
    },
  });
  await prisma.chunk.deleteMany({ where: { userId, originKind: "source", originId: source.id } });
  for (let i = 0; i < texts.length; i++) {
    const v = vectors[i];
    await prisma.chunk.create({
      data: {
        userId, originKind: "source", originId: source.id, originLabel: src.title,
        sourceId: source.id, seq: i, text: texts[i],
        embedding: v ? vecToBytes(v) : null, embedModel: v ? model : null,
      },
    });
  }
  return { chunks: texts.length, dim: vectors[0]?.length ?? 0 };
}

function linksMatching(crawler: Crawler, home: Page, words: RegExp, paths: string[]): string[] {
  const found = crawler
    .navLinks(home)
    .filter((l) => words.test(l.text))
    .map((l) => l.url);
  for (const p of paths) {
    const abs = crawler.resolve(p);
    if (abs) found.push(abs);
  }
  return [...new Set(found)];
}

// ── (a) Blog ──

async function feedPostUrls(crawler: Crawler, home: Page): Promise<string[] | null> {
  const candidates = [
    home.$('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]').attr("href"),
    "/feed", "/rss.xml", "/atom.xml", "/feed.xml",
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const xml = await crawler.loadText(c);
    if (!xml || !/<(rss|feed)[\s>]/.test(xml)) continue;
    const urls = [...xml.matchAll(/<link(?:\s[^>]*href="([^"]+)"[^>]*)?>([^<]*)/g)]
      .map((m) => m[1] || m[2])
      .map((u) => crawler.resolve(norm(u)))
      .filter((u): u is string => !!u && u !== crawler.resolve("/blog/index.html"));
    if (urls.length) return [...new Set(urls)];
  }
  return null;
}

export async function extractBlog(
  crawler: Crawler, home: Page, userId: string, log: (m: string) => void = () => {},
): Promise<{ report: BlogReport; chunks: number; covered: Set<string> }> {
  const covered = new Set<string>();
  const listPages = linksMatching(crawler, home, /blog|news|articles?|insights|resources/i,
    ["/blog", "/blog/index.html", "/news", "/articles", "/posts"]);
  const feed = await feedPostUrls(crawler, home);

  // Walk every listing page: pagination fully, category/tag pages for
  // discovery only. Post links accumulate; listing pages never get saved.
  const postUrls = new Set<string>(feed ?? []);
  const queue = [...listPages];
  const seenLists = new Set<string>();
  const paginationPages: string[] = [];
  while (queue.length && seenLists.size < MAX_LISTING_PAGES) {
    // The whole frontier loads at once (the crawler caps the open tabs), then
    // its pages are read in queue order, so discovery matches the serial walk.
    const wave: string[] = [];
    while (queue.length && seenLists.size < MAX_LISTING_PAGES) {
      const url = queue.shift()!;
      if (seenLists.has(url)) continue;
      seenLists.add(url);
      wave.push(url);
    }
    for (const page of await Promise.all(wave.map((u) => crawler.load(u)))) {
      if (!page) continue;
      covered.add(page.url);
      page.$("a").each((_, el) => {
        const href = page.$(el).attr("href");
        const abs = href ? crawler.resolve(href, page.url) : null;
        if (!abs || seenLists.has(abs)) return;
        const label = page.$(el).text() + " " + (page.$(el).attr("class") || "") + " " + abs;
        if (/category|tag/i.test(abs)) queue.push(abs);
        else if (/page[/=-]?\d|pagination|older|newer|archive/i.test(label)) {
          queue.push(abs);
          if (!/index\.html$|\/blog\/?$/.test(abs)) paginationPages.push(abs);
        } else if (/\/(blog|news|articles?|posts)\/[^/?#]+/.test(abs)) {
          // Any link into the listing's own path is a post candidate. Builders
          // differ on listing markup (Webflow uses div[role=listitem], not
          // li/article), so the URL shape is the reliable signal; a non-post
          // that slips through yields no title/body and is skipped below.
          postUrls.add(abs);
        }
      });
    }
  }

  const existed = seenLists.size > 0 && (postUrls.size > 0 || !!feed);
  // One agent per post, a few at a time: load, clean with the blog prompt,
  // save. Posts are distinct urls, so their records never touch each other.
  const savedPerPost = await mapPool([...postUrls].slice(0, MAX_POSTS), PAGE_AGENTS(),
    async (url): Promise<number> => {
      const page = await crawler.load(url);
      if (!page) return 0;
      covered.add(page.url);
      // The blog prompt cleans the post from the raw page text.
      const raw = await llmExtract(BLOG_SYSTEM_PROMPT, llmPageText(page).slice(0, 30_000), 6000, log);
      if (raw.post === null) return 0; // model: not actually an article
      const cleaned = sanitizePost(raw);
      if (!cleaned) return 0; // no usable title/body — not a savable post
      const { title, author, date, body } = cleaned;
      const header = [title, author && `By ${author}`, date && `Published ${date}`]
        .filter(Boolean).join(". ");
      const saved = await saveKnowledgeRecord(userId,
        { url: page.url, title, kind: onboardingIngestKind("blog"), summary: header, rawText: body },
        chunkText(`${header}\n\n${body}`));
      return saved.chunks;
    });
  const chunks = savedPerPost.reduce((a, b) => a + b, 0);
  const postsSaved = savedPerPost.filter(Boolean).length;

  return {
    report: {
      existed, postsSaved, uniqueUrls: postUrls.size,
      feedCount: feed ? feed.length : null,
      paginationPages: [...new Set(paginationPages)],
    },
    chunks, covered,
  };
}

/**
 * The photo a page itself attaches to a person: an <img> whose alt names them
 * (or whose filename carries their first name). Enrichment of a name the
 * model already extracted — never a source of quotes or people.
 */
function findPersonImage(crawler: Crawler, pages: Page[], name: string): string {
  const needle = name.trim().toLowerCase();
  const first = needle.split(/\s+/)[0] ?? "";
  if (!needle) return "";
  for (const page of pages) {
    let found = "";
    page.$("img").each((_, el) => {
      if (found) return;
      const $el = page.$(el);
      const src = $el.attr("data-crawl-src") || $el.attr("src") || "";
      if (!src || src.startsWith("data:")) return;
      const alt = ($el.attr("alt") || "").toLowerCase();
      if (alt.includes(needle) || (first.length >= 4 && src.toLowerCase().includes(first))) {
        found = crawler.resolve(src, page.url) || "";
      }
    });
    if (found) return found;
  }
  return "";
}

// ── (b) Testimonials ──

export async function extractTestimonials(
  crawler: Crawler, home: Page, userId: string, log: (m: string) => void = () => {},
): Promise<{ report: KnowledgeReport["testimonials"]; chunks: number; covered: Set<string> }> {
  const pages = [home.url, ...linksMatching(crawler, home,
    /testimonials?|reviews?|customers?|case stud|wall of love/i,
    ["/testimonials", "/reviews", "/customers"])];

  const items: TestimonialItem[] = [];
  const seen = new Set<string>();
  const pagesChecked: string[] = [];
  const covered = new Set<string>();
  let embeddedWidget = false;
  const add = (quote: string, cite: string, imageUrl: string, sourceUrl: string) => {
    if (!quote || !cite) return;
    const [author, ...rest] = cite.split(",").map(norm);
    const key = quote.toLowerCase();
    const existing = seen.has(key) ? items.find((t) => t.quote.toLowerCase() === key) : null;
    if (existing) {
      // Same testimonial on two pages is ONE record; keep the richer copy's
      // details (the homepage teaser often drops the photo or title).
      if (!existing.imageUrl && imageUrl) existing.imageUrl = imageUrl;
      if (!existing.title && rest.length) existing.title = rest.join(", ");
      return;
    }
    seen.add(key);
    items.push({ quote, author, title: rest.join(", "), sourceUrl, imageUrl });
  };
  const loaded: Page[] = [];
  for (const page of await Promise.all([...new Set(pages)].map((u) => crawler.load(u)))) {
    if (!page) continue;
    loaded.push(page);
    pagesChecked.push(page.url);
    if (page.url !== home.url) covered.add(page.url);
    // Reviews rendered by an embed (Elfsight, Trustpilot, Yotpo, …) are not
    // in the HTML at all — report that honestly instead of a silent zero.
    if (page.$('[class*="elfsight"], [class*="trustpilot"], [class*="yotpo"], iframe[src*="review"]').length) {
      embeddedWidget = true;
    }
  }

  // The testimonials prompt reads the whole candidate corpus; quotes on two
  // pages dedupe by their text.
  const modelItems = sanitizeTestimonials(loaded.length
    ? await llmExtract(TESTIMONIALS_SYSTEM_PROMPT, llmCorpus(loaded), 4000, log)
    : null);
  const modelSrc = pagesChecked.find((p) => /testimonial|review|customer/i.test(p)) ||
    pagesChecked[0] || home.url;
  for (const t of modelItems ?? []) {
    add(t.quote, [t.author, t.title].filter(Boolean).join(", "),
      findPersonImage(crawler, loaded, t.author), modelSrc);
  }

  let chunks = 0;
  if (items.length) {
    // "#testimonials" for the reason "#team" exists below: a site with no
    // reviews page falls back to the homepage here, and so does the services
    // extractor — which now runs at the same time. Two agents upserting one
    // Source row race on the unique key, and whichever wrote second would reset
    // the other's chunks.
    const url = `${pagesChecked.find((p) => /testimonial|review|customer/i.test(p)) || pagesChecked[0]}#testimonials`;
    const pieces = items.map((t) =>
      `Customer testimonial from ${t.author}${t.title ? ` (${t.title})` : ""}: "${t.quote}"`);
    const saved = await saveKnowledgeRecord(userId, {
      url, title: "Customer testimonials", kind: onboardingIngestKind("testimonials"),
      summary: `${items.length} customer testimonials extracted during onboarding.`,
      rawText: pieces.join("\n\n"),
    }, pieces);
    chunks = saved.chunks;
  }
  return { report: { count: items.length, items, pagesChecked, embeddedWidget }, chunks, covered };
}

// ── (c) Team / about ──

export async function extractTeam(
  crawler: Crawler, home: Page, userId: string, log: (m: string) => void = () => {},
): Promise<{
  report: KnowledgeReport["team"]; chunks: number; covered: Set<string>;
  /** The people the prompt found — name and bio — for the booking seeder
   *  (lib/onboarding/bookingSeed.ts seedStaff) to write as StaffMember rows. */
  people: { name: string; bio: string }[];
  /** The team/about pages actually loaded, so the seeder can match a photo
   *  against the same pages the bios came from. */
  loaded: Page[];
}> {
  const candidates = linksMatching(crawler, home,
    /team|about( us)?|our people|leadership/i,
    ["/team", "/about", "/about-us", "/people", "/leadership"]);

  const pagesChecked: string[] = [];
  // Team pages stay un-"covered" on purpose: an about page holds more than
  // bios, and the sweep's catch-all prompt distills the rest into facts.
  const covered = new Set<string>();
  const loaded: Page[] = [];
  for (const page of await Promise.all(candidates.map((u) => crawler.load(u)))) {
    if (!page) continue;
    loaded.push(page);
    pagesChecked.push(page.url);
  }

  // The team prompt reads the candidate pages; the same person described
  // twice is one entry (the prompt keeps the fuller bio).
  const people = sanitizePeople(loaded.length
    ? await llmExtract(TEAM_SYSTEM_PROMPT, llmCorpus(loaded), 4000, log)
    : null);
  const blocks: { name: string; bio: string }[] = people ?? [];

  let chunks = 0;
  let embeddingDim = 0;
  if (blocks.length) {
    const pieces = blocks.map((b) => `${b.name} — ${b.bio}`);
    // "#team" keeps this record distinct from the sweep's record for the same
    // page — team pages stay un-covered, so the sweep re-saves the bare url
    // and saveKnowledgeRecord's per-source chunk reset would silently drop the bios.
    const saved = await saveKnowledgeRecord(userId, {
      url: `${pagesChecked[pagesChecked.length - 1]}#team`, title: "Team",
      kind: onboardingIngestKind("team"),
      summary: `Team bios for ${blocks.map((b) => b.name).join(", ")}.`,
      rawText: pieces.join("\n\n"),
    }, pieces);
    chunks = saved.chunks;
    embeddingDim = saved.dim;
  }
  return {
    report: { existed: pagesChecked.length > 0 && blocks.length > 0, blocks: blocks.length, embeddingDim, pagesChecked },
    chunks, covered, people: blocks, loaded,
  };
}

// ── (d) Sitemap sweep ──

/** Links a sweep shouldn't follow: files, anchors, and non-page assets. */
const NON_PAGE_RE = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js|xml)(\?|#|$)/i;

export async function sweepSitemap(
  crawler: Crawler, userId: string, covered: Set<string>, home?: Page,
  log: (m: string) => void = () => {},
): Promise<{ report: KnowledgeReport["sweep"]; chunks: number; crawled: boolean }> {
  let urls = (await crawler.sitemap())
    .filter((u) => !covered.has(u))
    .slice(0, MAX_SWEEP_PAGES);

  // Many small-business sites have no sitemap at all. Fall back to crawling
  // the site's own links from the homepage (breadth-first, on-domain only)
  // so the sweep still reaches services/locations/press/etc. pages.
  const crawled = urls.length === 0 && !!home;
  const pages: string[] = [];
  let chunks = 0;

  /** Distill and save one page; resolves to the chunks it contributed. */
  const savePage = async (page: Page): Promise<number> => {
    // The catch-all prompt distills the page into discrete facts — each fact
    // its own chunk. A page the model reports empty is skipped, not chunked.
    const raw = await llmExtract(GENERAL_SYSTEM_PROMPT, llmPageText(page).slice(0, 15_000), 3000, log);
    const distilled = sanitizeFacts(raw);
    if (!distilled?.facts.length) return 0; // model: nothing substantive
    const saved = await saveKnowledgeRecord(userId, {
      url: page.url, title: distilled.title || page.url, kind: onboardingIngestKind("sweep"),
      rawText: llmPageText(page).slice(0, 60_000),
    }, distilled.facts);
    return saved.chunks;
  };

  /** One agent per url, a few at a time: load, distill, save. Null when the
   *  page would not load. Results come back in url order. */
  const sweepUrls = (list: string[]) => mapPool(list, PAGE_AGENTS(), async (url) => {
    const page = await crawler.load(url);
    return page ? { page, chunks: await savePage(page) } : null;
  });

  if (crawled) {
    const seen = new Set<string>([home!.url, ...covered]);
    const queue: string[] = [];
    const enqueue = (page: Page) => {
      page.$("a[href]").each((_, el) => {
        const abs = crawler.resolve(page.$(el).attr("href") || "", page.url);
        if (abs && !seen.has(abs) && !NON_PAGE_RE.test(abs)) {
          seen.add(abs);
          queue.push(abs);
        }
      });
    };
    enqueue(home!);
    let loaded = 0;
    while (queue.length && loaded < MAX_SWEEP_PAGES) {
      // Breadth-first by level: everything the cap still has room for goes out
      // together, and the frontier grows from the results in queue order — the
      // same pages the one-at-a-time walk reached. Only a page that loaded
      // counts against the cap, as before.
      for (const hit of await sweepUrls(queue.splice(0, MAX_SWEEP_PAGES - loaded))) {
        if (!hit) continue;
        loaded++;
        enqueue(hit.page); // one growing frontier; the load cap bounds the walk
        if (hit.chunks) {
          chunks += hit.chunks;
          pages.push(hit.page.url);
        }
      }
    }
  } else {
    for (const hit of await sweepUrls(urls)) {
      if (!hit?.chunks) continue;
      chunks += hit.chunks;
      pages.push(hit.page.url);
    }
  }
  return { report: { pages }, chunks, crawled };
}

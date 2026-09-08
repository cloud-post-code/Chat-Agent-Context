import { randomUUID } from "node:crypto";
import { Crawler, type Page } from "./crawl";
import {
  extractCoreInfo, extractTheme, type CoreInfo, type Location, type ThemeExtract,
} from "./extract";
import { discoverLocationPages, extractLocations } from "./locations";
import { discoverOwnerPages, extractOwners, ownersToOwnerName } from "./owners";
import { extractImages, type GalleryImage } from "./images";
import { extractBrandIdentity, type BrandIdentity } from "./brand";
import {
  extractBlog, extractTestimonials, extractTeam, sweepSitemap, type KnowledgeReport,
} from "./knowledge";
import { discoverServicePages, extractServicesAndBooking } from "./services";
import { indexOnboardingGraph, finishOnboardingIndex, type GraphIndexReport } from "./graphIndex";
import { deriveGoals, type GoalsReport } from "./goals";
import { personalizeStarterQuestions } from "@/lib/starterQuestions";
import { extractSocialLinks } from "./social";
import type { SocialLink } from "@/lib/socialLinks";

/**
 * Staged onboarding extraction, driven by the chat flow: each stage runs only
 * when the user reaches it, so the contact form appears seconds after the URL
 * is entered instead of after the whole site has been crawled (a slow origin
 * at ~5s/page × dozens of pages made the all-at-once run feel frozen).
 *
 *   start(url)                 -> core stage   -> phase "core-done", step1 set
 *   advance("social")          -> social stage -> phase "social-done", stepSocial set
 *   advance("theme")           -> theme stage  -> phase "theme-done", step2 set
 *   advance("knowledge", [..]) -> selected extractions -> phase "done"
 *
 * One job per run, held in process memory and keyed on globalThis so dev HMR
 * doesn't orphan it. The job keeps its Crawler (and page cache) across stages,
 * so pages loaded for the contact form aren't re-fetched for the theme.
 */

export type Extractor = "blog" | "testimonials" | "team" | "services" | "sweep";
export const EXTRACTORS: Extractor[] = ["blog", "testimonials", "team", "services", "sweep"];

export type Job = {
  id: string;
  userId: string;
  url: string;
  phase:
    | "core" | "core-done"
    | "locations" | "locations-done"
    | "social" | "social-done"
    | "images" | "images-done"
    | "theme" | "theme-done"
    | "blog" | "testimonials" | "team" | "services" | "sweep"
    | "done" | "failed";
  progress: number; // 0–100 within the currently running stage
  step1?: CoreInfo;
  /** The dedicated locations-and-hours stage's result. */
  stepLoc?: { locations: Location[] };
  /** The social-media stage's result: the site's own profile links. */
  stepSocial?: { links: SocialLink[] };
  /** The gallery-images stage's result: stored photos with site captions. */
  stepImages?: { images: GalleryImage[] };
  step2?: ThemeExtract;
  /** Brand voice extracted alongside the theme: tagline (flagged extracted
   *  vs suggested), brand values, tone of voice. */
  stepBrand?: BrandIdentity;
  chunkCount?: number;
  report?: Partial<KnowledgeReport>;
  /** Entities/relations built from the saved chunks (lib/onboarding/graphIndex.ts). */
  graph?: GraphIndexReport;
  /** The agent goals derived from this run (lib/onboarding/goals.ts). */
  goals?: GoalsReport;
  /** How many business-specific starter questions replaced the generic seeds. */
  starterQuestions?: number;
  /** Real activity lines, appended as work happens — the chat streams these. */
  log: string[];
  error?: string;
  /** @internal crawl state carried between stages; never serialized. */
  crawler?: Crawler;
  home?: Page;
  extras?: Page[];
  busy?: boolean;
};

const jobs: Map<string, Job> =
  ((globalThis as Record<string, unknown>).__onboardingJobs as Map<string, Job>) ??
  new Map<string, Job>();
(globalThis as Record<string, unknown>).__onboardingJobs = jobs;

export function getJob(id: string, userId: string): Job | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

/** The polling wire shape — everything except the internal crawl state. */
export function jobPayload(job: Job) {
  const { userId: _u, crawler: _c, home: _h, extras: _e, busy: _b, ...rest } = job;
  return rest;
}

function fail(job: Job, err: unknown) {
  job.phase = "failed";
  job.error = err instanceof Error ? err.message : String(err);
}

function log(job: Job, msg: string) {
  job.log.push(msg);
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}

export function startJob(userId: string, url: string): Job {
  const job: Job = { id: randomUUID(), userId, url, phase: "core", progress: 0, busy: true, log: [] };
  jobs.set(job.id, job);
  void runCore(job)
    .catch((err) => fail(job, err))
    .finally(() => (job.busy = false));
  return job;
}

/** Run the next stage. Returns false when the job isn't ready for it. */
export function advanceJob(
  job: Job,
  stage: "locations" | "social" | "images" | "theme" | "knowledge",
  extractors?: Extractor[],
): boolean {
  if (job.busy || job.phase === "failed") return false;
  if (stage === "locations" && job.phase === "core-done") {
    job.phase = "locations";
    job.busy = true;
    void runLocations(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (stage === "social" && (job.phase === "locations-done" || job.phase === "core-done")) {
    job.phase = "social";
    job.busy = true;
    void runSocial(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (
    stage === "images" &&
    (job.phase === "social-done" || job.phase === "locations-done" || job.phase === "core-done")
  ) {
    job.phase = "images";
    job.busy = true;
    void runImages(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (
    stage === "theme" &&
    (job.phase === "images-done" || job.phase === "social-done" ||
      job.phase === "locations-done" || job.phase === "core-done")
  ) {
    job.phase = "theme";
    job.busy = true;
    void runTheme(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (
    stage === "knowledge" &&
    (job.phase === "theme-done" || job.phase === "images-done" ||
      job.phase === "social-done" || job.phase === "locations-done" ||
      job.phase === "core-done")
  ) {
    const picked = (extractors ?? EXTRACTORS).filter((e) => EXTRACTORS.includes(e));
    job.busy = true;
    void runKnowledge(job, picked)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  return false;
}

async function runCore(job: Job): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "Onboarding extraction requires a model key — set ANTHROPIC_API_KEY and restart onboarding.",
    );
  }
  const onEvent = (m: string) => log(job, m);
  let crawler = new Crawler(job.url, onEvent);
  job.crawler = crawler;
  let home = await crawler.load(job.url);
  // Some small-business sites answer only on plain http (no TLS at all);
  // a bare pasted domain gets normalized to https, so fall back once.
  if (!home && job.url.startsWith("https://")) {
    log(job, "No answer over https — trying plain http");
    await crawler.close();
    job.url = job.url.replace(/^https:/, "http:");
    crawler = new Crawler(job.url, onEvent);
    job.crawler = crawler;
    home = await crawler.load(job.url);
  }
  if (!home) throw new Error("Could not load that site. Check the URL and try again.");
  job.home = home;
  job.progress = 40;

  // Contact info usually lives on the homepage or one hop away.
  const extraUrls = crawler
    .navLinks(home)
    .filter((l) => /about|contact|team/i.test(l.text))
    .map((l) => l.url)
    .slice(0, 4);
  log(job, extraUrls.length
    ? `Found ${extraUrls.length} contact/about page${extraUrls.length > 1 ? "s" : ""} to check`
    : "No separate contact page — reading the homepage");
  job.extras = (await Promise.all(extraUrls.map((u) => crawler.load(u))))
    .filter((p): p is Page => !!p);
  job.progress = 80;
  job.step1 = await extractCoreInfo(crawler, [home, ...job.extras], onEvent);
  const s1 = job.step1;

  // Owner names live in prose on about/team pages, not under labels — the
  // dedicated module reads more pages and understands bios (lib/onboarding/owners.ts).
  log(job, "Looking for the owner's name on about and team pages");
  const ownerPages = await discoverOwnerPages(crawler, home, job.extras);
  job.progress = 90;
  const owners = await extractOwners(ownerPages, onEvent);
  if (owners.length) s1.owner_name = ownersToOwnerName(owners);
  log(job, s1.owner_name
    ? `Owner${owners.length > 1 ? "s" : ""}: ${s1.owner_name}`
    : "No owner name found");

  log(job, s1.company_name ? `Company name: ${s1.company_name}` : "No company name found");
  log(job, s1.company_phone_number ? `Phone: ${s1.company_phone_number}` : "No phone number listed");
  log(job, s1.company_email ? `Email: ${s1.company_email}` : "No email address listed");
  job.phase = "core-done";
  job.progress = 100;
}

/**
 * The dedicated locations stage: its own page discovery (hours often live on
 * /locations or per-shop pages, not the contact page) and its own extraction
 * prompt (lib/onboarding/locations.ts).
 */
async function runLocations(job: Job): Promise<void> {
  job.progress = 10;
  log(job, "Looking for location and hours pages");
  const pages = await discoverLocationPages(job.crawler!, job.home!, job.extras ?? []);
  job.progress = 60;
  const locations = await extractLocations(pages, (m) => log(job, m));
  if (locations.length === 0) {
    log(job, "No street address found — this may be an online-only business");
  } else {
    for (const [i, loc] of locations.entries()) {
      const hasHours = Object.values(loc.hours).some(Boolean);
      log(job, `Location ${i + 1}: ${loc.address}${hasHours ? " — hours found" : " — no hours listed"}`);
    }
  }
  job.stepLoc = { locations };
  job.phase = "locations-done";
  job.progress = 100;
}

/**
 * The social-media stage: the site's own profile links, read from the
 * already-loaded pages' offsite anchors (lib/onboarding/social.ts) — social
 * icons live in the header/footer of every page, so home + extras suffice.
 */
async function runSocial(job: Job): Promise<void> {
  job.progress = 20;
  log(job, "Looking for your social media profiles");
  const links = await extractSocialLinks([job.home!, ...(job.extras ?? [])], (m) => log(job, m));
  if (links.length === 0) {
    log(job, "No social media profiles linked on your site");
  } else {
    for (const l of links) log(job, `Found ${l.platform || "a profile"}: ${l.url}`);
  }
  job.stepSocial = { links };
  job.phase = "social-done";
  job.progress = 100;
}

/** The gallery-images stage: photos with the captions the site gives them. */
async function runImages(job: Job): Promise<void> {
  job.progress = 10;
  log(job, "Looking for photos to build your gallery");
  const images = await extractImages(job.crawler!, job.home!, job.extras ?? [], (m) => {
    log(job, m);
    // Creep the bar as photos land; the cap keeps room for the final jump.
    job.progress = Math.min(95, job.progress + 3);
  });
  job.stepImages = { images };
  job.phase = "images-done";
  job.progress = 100;
}

async function runTheme(job: Job): Promise<void> {
  job.progress = 20;
  log(job, "Reading your site's CSS for colors, fonts, and corners");
  job.step2 = await extractTheme(job.crawler!, [job.home!, ...(job.extras ?? [])], (m) => log(job, m));
  const s2 = job.step2;
  if (s2.themeColors.primary) log(job, `Brand color: ${s2.themeColors.primary}`);
  log(job, `Body font matched: ${s2.themeBodyFont}; corners: ${s2.themeRadius}`);
  log(job, s2.themeLogo ? "Logo imported from your site" : "No importable logo found");

  // Brand voice rides along with the theme stage — same pages, same review
  // card. Fail-soft: a failed brand call must not take down the theme review,
  // so the fields just come back empty for the user to fill in.
  job.progress = 80;
  log(job, "Reading your brand voice — tagline, values, and tone");
  try {
    job.stepBrand = await extractBrandIdentity(
      [job.home!, ...(job.extras ?? [])], (m) => log(job, m));
    const b = job.stepBrand;
    log(job, b.tagline
      ? b.taglineSource === "extracted"
        ? `Tagline found on your site: “${b.tagline}”`
        : `No stated tagline — suggested one from your copy: “${b.tagline}”`
      : "No tagline found");
    log(job, b.values.length
      ? `Brand values: ${b.values.join(", ")}`
      : "No brand values stated on the site");
    log(job, b.tone ? "Tone of voice captured" : "Not enough copy to judge your tone of voice");
  } catch {
    log(job, "Couldn't read your brand voice — you can fill it in by hand");
    job.stepBrand = { tagline: "", taglineSource: "", values: [], tone: "" };
  }
  job.phase = "theme-done";
  job.progress = 100;
}

async function runKnowledge(job: Job, picked: Extractor[]): Promise<void> {
  const crawler = job.crawler!;
  const home = job.home!;
  const covered = new Set<string>([home.url]);
  const report: Partial<KnowledgeReport> = {};
  // The pages the goals stage reads at the end. Starts as what every run has
  // loaded; the services stage widens it, since services/booking pages are the
  // ones that say what this business actually wants out of a conversation.
  let goalPages: Page[] = [home, ...(job.extras ?? [])];
  let chunks = 0;
  const stepShare = 100 / Math.max(picked.length, 1);
  let stepsDone = 0;
  const onEvent = (m: string) => log(job, m);
  log(job, "Model extraction is on — each category reads your pages with its own prompt");

  try {
    if (picked.includes("blog")) {
      job.phase = "blog";
      job.progress = Math.round(stepShare * stepsDone++);
      log(job, "Looking for a blog — nav links, common paths, and RSS feeds");
      const blog = await extractBlog(crawler, home, job.userId, onEvent);
      blog.covered.forEach((u) => covered.add(u));
      report.blog = blog.report;
      chunks += blog.chunks;
      log(job, blog.report.existed
        ? `Blog: saved ${blog.report.postsSaved} post${blog.report.postsSaved === 1 ? "" : "s"}${blog.report.feedCount != null ? ` (feed listed ${blog.report.feedCount})` : ""}`
        : "No blog found on this site");
    }
    if (picked.includes("testimonials")) {
      job.phase = "testimonials";
      job.progress = Math.round(stepShare * stepsDone++);
      log(job, "Checking for customer testimonials and reviews");
      const t = await extractTestimonials(crawler, home, job.userId, onEvent);
      t.covered.forEach((u) => covered.add(u));
      report.testimonials = t.report;
      chunks += t.chunks;
      log(job, t.report.count
        ? `Testimonials: found ${t.report.count}`
        : t.report.embeddedWidget
          ? "Your reviews load through a third-party widget — those quotes aren't in the page itself"
          : "No customer testimonials found");
    }
    if (picked.includes("team")) {
      job.phase = "team";
      job.progress = Math.round(stepShare * stepsDone++);
      log(job, "Reading your team and about pages");
      const team = await extractTeam(crawler, home, job.userId, onEvent);
      team.covered.forEach((u) => covered.add(u));
      report.team = team.report;
      chunks += team.chunks;
      log(job, team.report.blocks
        ? `Team: saved ${team.report.blocks} bio${team.report.blocks === 1 ? "" : "s"}`
        : "No team bios found");
    }
    if (picked.includes("services")) {
      job.phase = "services";
      job.progress = Math.round(stepShare * stepsDone++);
      log(job, "Reading your services and how you take bookings");
      const svcPages = await discoverServicePages(crawler, home, job.extras ?? []);
      svcPages.forEach((p) => covered.add(p.url));
      goalPages = svcPages;
      const svc = await extractServicesAndBooking(svcPages, job.userId, onEvent);
      report.services = svc.report;
      chunks += svc.chunks;
      log(job, svc.report.services
        ? `Services: saved ${svc.report.services} service${svc.report.services === 1 ? "" : "s"} to knowledge`
        : "No services described on this site");
      log(job, svc.report.seededFields
        ? `Booking is on — built your form with ${svc.report.seededFields} question${svc.report.seededFields === 1 ? "" : "s"}, editable on the Calendar`
        : "Booking is on — your existing booking questions were left as they are");
    }
    if (picked.includes("sweep")) {
      job.phase = "sweep";
      job.progress = Math.round(stepShare * stepsDone++);
      log(job, "Sweeping the sitemap for remaining pages");
      const sweep = await sweepSitemap(crawler, job.userId, covered, home, onEvent);
      report.sweep = sweep.report;
      chunks += sweep.chunks;
      if (sweep.crawled) log(job, "No sitemap on this site — crawled its own links instead");
      log(job, `Sitemap sweep: kept ${sweep.report.pages.length} page${sweep.report.pages.length === 1 ? "" : "s"}`);
    }
    job.report = report;
    job.chunkCount = chunks;
    log(job, `Saved ${chunks} knowledge chunk${chunks === 1 ? "" : "s"}`);

    // The graph half of indexing. Onboarding writes its own chunks (curated
    // boundaries the generic indexer would re-chunk away), so entities and
    // relations are attached to those chunks here rather than by indexSource.
    // Best-effort: the chunks are already saved and searchable, so a failure
    // costs relation-hop retrieval, never the knowledge itself.
    if (chunks > 0) {
      log(job, "Reading how everything connects — people, services and places");
      try {
        job.graph = await indexOnboardingGraph(job.userId, { onEvent });
        log(job, job.graph.entities
          ? `Connected ${job.graph.entities} thing${job.graph.entities === 1 ? "" : "s"} across ${job.graph.relations} relationship${job.graph.relations === 1 ? "" : "s"}`
          : "Nothing linkable found — your pages are still fully searchable");
      } catch {
        log(job, "Couldn't map the connections — your knowledge is saved and searchable");
      }
    }

    // What the agent is FOR. The knowledge above tells it what to say; this
    // reads the same run back and writes the outcomes the owner wants out of a
    // visitor chat, live on the Agent Behavior tab. Best-effort like the graph
    // pass: onboarding is already successful by this point, and a goal draft
    // must never cost it. Seeds only into an empty catalog.
    log(job, "Working out what your agent should be steering visitors toward");
    try {
      job.goals = await deriveGoals(
        goalPages,
        job.userId,
        {
          takesAppointments: report.services?.takesAppointments ?? false,
          categories: picked,
        },
        onEvent,
      );
      const g = job.goals;
      log(job,
        g.keptExisting
          ? "You already have goals set — left them exactly as they are"
          : g.written
            ? `Set ${g.written} goal${g.written === 1 ? "" : "s"} for your agent, editable under Agent Behavior: ${g.goals.join("; ")}`
            : g.failed
              ? "Couldn't draft your agent's goals — you can write them under Agent Behavior"
              : "Nothing on your site pointed to a clear goal — you can add them under Agent Behavior");
    } catch {
      log(job, "Couldn't draft your agent's goals — you can write them under Agent Behavior");
    }

    // Index the profile/persona/photo origins the save route wrote straight to
    // their tables, then rewrite the generic seeded starter questions into
    // business-specific ones. BOTH used to run in /complete, which the flow
    // calls the instant this stage is kicked off — so they read a database
    // with no sources, no graph and no goals yet, and the questions fell back
    // to the generic seeds. They belong here, at the real end of extraction.
    // Best-effort, in order: the knowledge is already saved either way.
    log(job, "Filing everything into your agent's memory");
    try {
      await finishOnboardingIndex(job.userId, { onEvent });
    } catch {
      log(job, "Couldn't file some details — they're saved and still shown on your page");
    }

    log(job, "Writing the questions visitors will see first");
    try {
      const written = await personalizeStarterQuestions(job.userId);
      job.starterQuestions = written;
      log(job, written
        ? `Wrote ${written} starter question${written === 1 ? "" : "s"} for your page, editable under Presets`
        : "Kept the standard starter questions — you can edit them under Presets");
    } catch {
      log(job, "Kept the standard starter questions — you can edit them under Presets");
    }

    log(job, "All done");
    job.phase = "done";
    job.progress = 100;
  } finally {
    await crawler.close();
    job.crawler = undefined;
    job.home = undefined;
    job.extras = undefined;
  }
}

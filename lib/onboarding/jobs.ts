import { randomUUID } from "node:crypto";
import { getProfile } from "@/lib/db";
import { Crawler, type Page } from "./crawl";
import {
  extractCoreInfo, extractTheme, emptyHours, type CoreInfo, type Location, type ThemeExtract,
} from "./extract";
import { discoverLocationPages, extractLocations } from "./locations";
import { discoverOwnerPages, extractOwners, ownersToOwnerName } from "./owners";
import { extractImages, type GalleryImage } from "./images";
import { extractBrandIdentity, type BrandIdentity } from "./brand";
import {
  extractBlog, extractTestimonials, extractTeam, sweepSitemap, type KnowledgeReport,
} from "./knowledge";
import { discoverServicePages, extractServicesAndBooking, type ServicesReport } from "./services";
import { seedLocations, seedSettings, seedStaff } from "./bookingSeed";
import {
  finishOnboardingIndex, estimateFilingWork, filingSeconds,
  type GraphIndexReport,
} from "./graphIndex";
import { deriveGoals, type GoalsReport } from "./goals";
import { personalizeStarterQuestions } from "@/lib/starterQuestions";
import { extractSocialLinks } from "./social";
import type { SocialLink } from "@/lib/socialLinks";
import { mapPool, onboardingConcurrency } from "./pool";

/**
 * Staged onboarding extraction, driven by the chat flow: each stage runs only
 * when the user reaches it, so the contact form appears seconds after the URL
 * is entered instead of after the whole site has been crawled (a slow origin
 * at ~5s/page × dozens of pages made the all-at-once run feel frozen).
 *
 *   start(url)                 -> core stage   -> phase "core-done", step1 set
 *   advance("social")          -> social stage -> phase "social-done", stepSocial set
 *   advance("theme")           -> theme stage  -> phase "theme-done", step2 set
 *   advance("booking")         -> booking stage -> phase "booking-done", stepBooking set
 *   advance("knowledge", [..]) -> selected extractions -> phase "done"
 *
 * The booking stage is the services extractor run on its own, ahead of the
 * knowledge stage, so the chat can show the booking form it built — and let
 * the owner try it and change it — before extraction runs in the background.
 * The knowledge stage then skips services (the unattended runner, which has
 * no review, still runs it there).
 *
 * Within a stage the work fans out (pool.ts): the knowledge stage runs its
 * category extractors as agents side by side, each of which reads its own pages
 * a few at a time, and the indexing that follows reads several sources at once.
 * The log is the one thing they all share, so its lines interleave — each line
 * names what it is about, and that is what the feed shows: agents at work.
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
    | "booking" | "booking-done"
    /** The category extractors, running together. */
    | "knowledge"
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
  /** The booking stage's result: what the services read built. `report` is
   *  null when the read failed — the form on file is shown as it is. */
  stepBooking?: { report: ServicesReport | null; chunks: number };
  chunkCount?: number;
  report?: Partial<KnowledgeReport>;
  /** Entities/relations built from the saved chunks (lib/onboarding/graphIndex.ts). */
  graph?: GraphIndexReport;
  /** The agent goals derived from this run (lib/onboarding/goals.ts). */
  goals?: GoalsReport;
  /** How many business-specific starter questions were written for the page. */
  starterQuestions?: number;
  /** When the filing pass started and how long the rest of the run was
   *  estimated to take, so the chat can count down to done. */
  filing?: { startedAt: number; seconds: number };
  /** Real activity lines, appended as work happens — the chat streams these. */
  log: string[];
  error?: string;
  /** @internal crawl state carried between stages; never serialized. */
  crawler?: Crawler;
  home?: Page;
  extras?: Page[];
  /** @internal the pages the booking stage read, for the knowledge stage's goals. */
  servicePages?: Page[];
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
  const { userId: _u, crawler: _c, home: _h, extras: _e, servicePages: _s, busy: _b, filing, ...rest } = job;
  return { ...rest, eta: etaFor(filing, job.phase) };
}

/** The wire form of the estimate: seconds left as of THIS poll, so the client
 *  counts down from its own clock and server/browser clock skew never shows. */
export function etaFor(
  filing: Job["filing"], phase: Job["phase"], now = Date.now(),
): { totalSeconds: number; remainingSeconds: number } | undefined {
  if (!filing || phase === "done" || phase === "failed") return undefined;
  const elapsed = Math.floor((now - filing.startedAt) / 1000);
  return { totalSeconds: filing.seconds, remainingSeconds: Math.max(0, filing.seconds - elapsed) };
}

function fail(job: Job, err: unknown) {
  job.phase = "failed";
  job.error = err instanceof Error ? err.message : String(err);
}

function log(job: Job, msg: string) {
  job.log.push(msg);
  if (job.log.length > 400) job.log.splice(0, job.log.length - 400);
}

/** "2 minutes" / "1 minute 30 seconds" / "40 seconds" — for the estimate line. */
export function describeDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m === 0) return part(s, "second");
  return s ? `${part(m, "minute")} ${part(s, "second")}` : part(m, "minute");
}

type UnattendedStage =
  | "core" | "locations" | "social" | "images" | "theme" | "knowledge";

export type UnattendedHooks = {
  onStage: (stage: UnattendedStage, job: Job) => Promise<void>;
  onStageError: (stage: UnattendedStage, err: unknown) => void;
  onEvent?: (line: string) => void;
};

/** Runs one stage, resolving true on success and false if it threw (the
 *  error already reported through hooks.onStageError). */
async function runStage(
  job: Job, stage: UnattendedStage, run: (job: Job) => Promise<void>, hooks: UnattendedHooks,
): Promise<boolean> {
  try {
    await run(job);
    await hooks.onStage(stage, job);
    return true;
  } catch (err) {
    hooks.onStageError(stage, err);
    return false;
  }
}

/**
 * The unattended runner the bulk site builder drives: every stage in order,
 * with no human review between them. Unlike the guided flow's advanceJob,
 * this awaits each stage directly rather than going through the job's busy
 * flag, since nothing else can be polling the same job concurrently.
 *
 * runCore failing means the site itself couldn't be read — that fails the
 * whole job (rethrown) so the caller can drop the half-made account. A later
 * stage failing is isolated: it's logged, its hook still doesn't fire, and
 * the run continues so the stages that DID succeed still get saved.
 */
export async function runUnattendedJob(
  userId: string, url: string, hooks: UnattendedHooks,
): Promise<Job> {
  const job: Job = { id: randomUUID(), userId, url, phase: "core", progress: 0, log: [] };
  jobs.set(job.id, job);
  if (hooks.onEvent) {
    const onEvent = hooks.onEvent;
    const origPush = job.log.push.bind(job.log);
    job.log.push = (...items: string[]) => {
      for (const line of items) onEvent(line);
      return origPush(...items);
    };
  }

  try {
    await runCore(job);
  } catch (err) {
    fail(job, err);
    throw err;
  }

  await runStage(job, "locations", runLocations, hooks);
  await runStage(job, "social", runSocial, hooks);
  await runStage(job, "images", runImages, hooks);
  await runStage(job, "theme", runTheme, hooks);

  try {
    await runKnowledge(job, EXTRACTORS);
    await hooks.onStage("knowledge", job);
  } catch (err) {
    hooks.onStageError("knowledge", err);
  } finally {
    if (job.crawler) {
      await job.crawler.close().catch(() => {});
      job.crawler = undefined;
      job.home = undefined;
      job.extras = undefined;
    }
  }

  return job;
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
  stage: "locations" | "social" | "images" | "theme" | "booking" | "knowledge",
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
    stage === "booking" &&
    (job.phase === "theme-done" || job.phase === "images-done" ||
      job.phase === "social-done" || job.phase === "locations-done" ||
      job.phase === "core-done")
  ) {
    job.phase = "booking";
    job.busy = true;
    void runBooking(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (
    stage === "knowledge" &&
    (job.phase === "booking-done" || job.phase === "theme-done" || job.phase === "images-done" ||
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

  // Owner names live in prose on about/team pages, not under labels — the
  // dedicated module reads more pages and understands bios (lib/onboarding/owners.ts).
  // It shares nothing with the contact-details read, so the two run together.
  const extras = job.extras;
  log(job, "Looking for the owner's name on about and team pages");
  const [s1, owners] = await Promise.all([
    extractCoreInfo(crawler, [home, ...extras], onEvent),
    discoverOwnerPages(crawler, home, extras).then((pages) => extractOwners(pages, onEvent)),
  ]);
  job.step1 = s1;
  job.progress = 90;
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

  // Booking seeding: BookingLocation rows and (from the first one) the
  // tenant's timezone and hours. Best-effort — a failure here never costs
  // the locations review the chat shows next.
  try {
    let seedLocs = locations;
    if (seedLocs.length === 0) {
      // A re-onboard of a tenant who already has an address on file (but no
      // location the crawl could find this time, e.g. an online-only page
      // now) still gets one bookable location instead of none.
      const profile = await getProfile(job.userId).catch(() => null);
      if (profile?.company_address) {
        seedLocs = [{ address: profile.company_address, phone: job.step1?.company_phone_number ?? "", hours: emptyHours() }];
      }
    }
    if (seedLocs.length) {
      const businessName = job.step1?.company_name || "Business";
      const locResult = await seedLocations(job.userId, seedLocs, businessName, (m) => log(job, m));
      if (locResult.seeded) {
        log(job, `Booking: added ${locResult.seeded} location${locResult.seeded === 1 ? "" : "s"} with hours`);
      }
    }
    const primary = seedLocs[0];
    await seedSettings(job.userId, { address: primary?.address ?? "", hours: primary?.hours }, (m) => log(job, m));
  } catch {
    // Left as-is; Locations and Hours & rules stay open under Booking.
  }
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
  const pages = [job.home!, ...(job.extras ?? [])];
  job.progress = 20;

  const theme = async () => {
    log(job, "Reading your site's CSS for colors, fonts, and corners");
    job.step2 = await extractTheme(job.crawler!, pages, (m) => log(job, m));
    const s2 = job.step2;
    if (s2.themeColors.primary) log(job, `Brand color: ${s2.themeColors.primary}`);
    log(job, `Body font matched: ${s2.themeBodyFont}; corners: ${s2.themeRadius}`);
    log(job, s2.themeLogo ? "Logo imported from your site" : "No importable logo found");
  };

  // Brand voice rides along with the theme stage — same pages, same review
  // card. Fail-soft: a failed brand call must not take down the theme review,
  // so the fields just come back empty for the user to fill in.
  const brand = async () => {
    log(job, "Reading your brand voice — tagline, values, and tone");
    try {
      job.stepBrand = await extractBrandIdentity(pages, (m) => log(job, m));
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
  };

  // Two readings of the same pages that share nothing — so they run together.
  await Promise.all([theme(), brand().then(() => (job.progress = Math.max(job.progress, 80)))]);
  job.phase = "theme-done";
  job.progress = 100;
}

/**
 * The services-and-booking read (lib/onboarding/services.ts) as its own stage:
 * the services pages and the business's real booking page, the services saved
 * to knowledge and the booking catalog, and the site's own booking form copied
 * into the tenant's. Fail-soft, unlike the other stages: the chat's next step
 * shows whatever form is on file and lets the owner shape it, so a read that
 * fails costs a pre-filled form, not the onboarding.
 */
/** What the booking-form read did, in one line for the log. */
function formCopiedLine(r: ServicesReport): string {
  if (!r.formFound) return "No booking form found on your site — you'll build one in the next step";
  if (!r.seededFields) return "Found your booking form — your existing booking questions were left as they are";
  const k = r.seededFields;
  const m = Math.max(1, r.formScreens);
  return `Copied your booking form: ${k} question${k === 1 ? "" : "s"} on ${m} screen${m === 1 ? "" : "s"}`;
}

async function runBooking(job: Job): Promise<void> {
  const onEvent = (m: string) => log(job, m);
  job.progress = 10;
  log(job, "Reading your services and how you take bookings");
  try {
    const svcPages = await discoverServicePages(job.crawler!, job.home!, job.extras ?? []);
    job.servicePages = svcPages;
    job.progress = 50;
    const svc = await extractServicesAndBooking(svcPages, job.userId, onEvent, { crawler: job.crawler });
    job.stepBooking = { report: svc.report, chunks: svc.chunks };
    log(job, svc.report.services
      ? `Services: saved ${svc.report.services} service${svc.report.services === 1 ? "" : "s"} to knowledge`
      : "No services described on this site");
    log(job, formCopiedLine(svc.report));
    if (svc.report.seededServices) {
      log(job, `Booking: added ${svc.report.seededServices} service${svc.report.seededServices === 1 ? "" : "s"}${svc.report.imagedServices ? `, ${svc.report.imagedServices} with photos` : ""}`);
    }
  } catch (err) {
    job.stepBooking = { report: null, chunks: 0 };
    log(job, `Couldn't read your services — ${err instanceof Error ? err.message.slice(0, 120) : String(err)}. You can build the form in the next step.`);
  }
  job.phase = "booking-done";
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
  const onEvent = (m: string) => log(job, m);

  // The guided flow already ran services as the booking stage: its pages,
  // report and chunks carry over, and the services agent is not run again.
  const booked = job.stepBooking;
  if (booked) {
    if (booked.report) {
      report.services = booked.report;
      chunks += booked.chunks;
    }
    if (job.servicePages?.length) {
      goalPages = job.servicePages;
      job.servicePages.forEach((p) => covered.add(p.url));
    }
    picked = picked.filter((e) => e !== "services");
  }
  // What the goals pass is told produced content this run.
  const producing: string[] = booked?.report?.services ? [...new Set([...picked, "services"])] : picked;

  // The bar moves as agents FINISH, whatever order that happens in. The extra
  // step is everything after the extractors — indexing, goals and questions —
  // so the bar still has somewhere to go while that runs.
  const steps = picked.length + 1;
  let stepsDone = 0;
  const stepDone = () => (job.progress = Math.round((100 * ++stepsDone) / steps));

  // One agent per category. Each reads its own pages with its own prompt and
  // writes its own records, so nothing here waits on anything else; what they
  // share — the crawler's tabs, the model — is capped where it is shared.
  const agents: Record<Exclude<Extractor, "sweep">, () => Promise<void>> = {
    blog: async () => {
      log(job, "Looking for a blog — nav links, common paths, and RSS feeds");
      const blog = await extractBlog(crawler, home, job.userId, onEvent);
      blog.covered.forEach((u) => covered.add(u));
      report.blog = blog.report;
      chunks += blog.chunks;
      log(job, blog.report.existed
        ? `Blog: saved ${blog.report.postsSaved} post${blog.report.postsSaved === 1 ? "" : "s"}${blog.report.feedCount != null ? ` (feed listed ${blog.report.feedCount})` : ""}`
        : "No blog found on this site");
    },
    testimonials: async () => {
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
    },
    team: async () => {
      log(job, "Reading your team and about pages");
      const team = await extractTeam(crawler, home, job.userId, onEvent);
      team.covered.forEach((u) => covered.add(u));
      report.team = team.report;
      chunks += team.chunks;
      log(job, team.report.blocks
        ? `Team: saved ${team.report.blocks} bio${team.report.blocks === 1 ? "" : "s"}`
        : "No team bios found");

      // StaffMember rows from the same bios, best-effort — a failure here
      // never costs the team knowledge saved above.
      try {
        const staff = await seedStaff(job.userId, team.people, team.loaded, onEvent);
        if (staff.seeded) {
          log(job, `Booking: added ${staff.seeded} staff member${staff.seeded === 1 ? "" : "s"}${staff.imaged ? `, ${staff.imaged} with photos` : ""}`);
        }
      } catch {
        // Left as-is; Providers stays open under Booking.
      }
    },
    services: async () => {
      log(job, "Reading your services and how you take bookings");
      const svcPages = await discoverServicePages(crawler, home, job.extras ?? []);
      svcPages.forEach((p) => covered.add(p.url));
      goalPages = svcPages;
      const svc = await extractServicesAndBooking(svcPages, job.userId, onEvent, { crawler });
      report.services = svc.report;
      chunks += svc.chunks;
      log(job, svc.report.services
        ? `Services: saved ${svc.report.services} service${svc.report.services === 1 ? "" : "s"} to knowledge`
        : "No services described on this site");
      log(job, formCopiedLine(svc.report));
      if (svc.report.seededServices) {
        log(job, `Booking: added ${svc.report.seededServices} service${svc.report.seededServices === 1 ? "" : "s"}${svc.report.imagedServices ? `, ${svc.report.imagedServices} with photos` : ""}`);
      }
    },
  };

  try {
    const categories = EXTRACTORS.filter(
      (e): e is Exclude<Extractor, "sweep"> => e !== "sweep" && picked.includes(e),
    );
    log(job, "Model extraction is on — each category reads your pages with its own prompt");
    const atOnce = Math.min(categories.length, onboardingConcurrency());
    if (atOnce > 1) {
      log(job, `Running ${atOnce} extraction agents at once: ${categories.join(", ")}`);
    }
    job.phase = "knowledge";
    job.progress = 0;
    // A failed extraction still fails the run, as it did one at a time: the
    // first rejection ends the stage, and closing the crawler (the finally
    // below) is what winds the other agents down.
    await mapPool(categories, atOnce, (c) => agents[c]().then(stepDone));

    // The sweep goes after the categories, not beside them: it takes every
    // page they did NOT claim, so it needs their `covered` sets complete.
    if (picked.includes("sweep")) {
      job.phase = "sweep";
      log(job, "Sweeping the sitemap for remaining pages");
      const sweep = await sweepSitemap(crawler, job.userId, covered, home, onEvent);
      report.sweep = sweep.report;
      chunks += sweep.chunks;
      if (sweep.crawled) log(job, "No sitemap on this site — crawled its own links instead");
      log(job, `Sitemap sweep: kept ${sweep.report.pages.length} page${sweep.report.pages.length === 1 ? "" : "s"}`);
      stepDone();
    }
    job.report = report;
    job.chunkCount = chunks;
    log(job, `Saved ${chunks} knowledge chunk${chunks === 1 ? "" : "s"}`);

    // Everything below used to run in /complete, which the flow calls the
    // instant this stage is kicked off — so it read a database with no sources,
    // no graph and no goals yet, and the questions fell back to generic seeds.
    // It belongs here, at the real end of extraction. Best-effort throughout:
    // the knowledge is already saved either way.
    //
    // Estimated up front so the chat can say how long the quiet stretch will
    // be and count it down; the pass itself emits few lines. Best-effort: a
    // failed count just means no countdown.
    const seconds = await estimateFilingWork(job.userId).then((w) => filingSeconds(w)).catch(() => 0);
    if (seconds > 0) job.filing = { startedAt: Date.now(), seconds };
    log(job, seconds > 0
      ? `Filing everything into your agent's memory — about ${describeDuration(seconds)} to go`
      : "Filing everything into your agent's memory");

    // The memory. One pass: the profile/persona/photo origins the save route
    // wrote straight to their tables, and the graph half of indexing for the
    // sources above. Onboarding writes its own chunks (curated boundaries the
    // generic indexer would re-chunk away), so entities and relations are
    // attached to those chunks here rather than by indexSource. A failure
    // costs relation-hop retrieval, never the knowledge itself.
    const filing = async () => {
      log(job, "Reading how everything connects — people, services and places");
      try {
        job.graph = await finishOnboardingIndex(job.userId, { onEvent });
        log(job, job.graph.entities
          ? `Connected ${job.graph.entities} thing${job.graph.entities === 1 ? "" : "s"} across ${job.graph.relations} relationship${job.graph.relations === 1 ? "" : "s"}`
          : "Nothing linkable found — your pages are still fully searchable");
      } catch {
        log(job, "Couldn't file some details — they're saved and still shown on your page");
      }
    };

    // What the agent is FOR. The knowledge above tells it what to say; this
    // reads the same run back and writes the outcomes the owner wants out of a
    // visitor chat, live on the Agent Behavior tab. Best-effort like the
    // filing pass: onboarding is already successful by this point, and a goal
    // draft must never cost it. Seeds only into an empty catalog.
    const goals = async () => {
      log(job, "Working out what your agent should be steering visitors toward");
      try {
        job.goals = await deriveGoals(
          goalPages,
          job.userId,
          {
            takesAppointments: report.services?.takesAppointments ?? false,
            categories: producing,
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
    };

    // Goals read the pages, filing reads the database, and neither reads the
    // other — so they run together. The questions after them read both, so
    // they wait.
    await Promise.all([filing(), goals()]);

    log(job, "Writing the questions visitors will see first");
    try {
      const written = await personalizeStarterQuestions(job.userId);
      job.starterQuestions = written;
      log(job, written
        ? `Wrote ${written} starter question${written === 1 ? "" : "s"} for your page, editable under Presets`
        : "Couldn't write starter questions — add your own or hit Regenerate under Presets");
    } catch {
      log(job, "Couldn't write starter questions — add your own or hit Regenerate under Presets");
    }

    log(job, "All done");
    job.phase = "done";
    job.progress = 100;
  } finally {
    await crawler.close();
    job.crawler = undefined;
    job.home = undefined;
    job.extras = undefined;
    job.servicePages = undefined;
  }
}

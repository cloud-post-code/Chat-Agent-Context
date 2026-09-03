import { randomUUID } from "node:crypto";
import { Crawler, type Page } from "./crawl";
import { extractCoreInfo, extractTheme, type CoreInfo, type ThemeExtract } from "./extract";
import {
  extractBlog, extractTestimonials, extractTeam, sweepSitemap, type KnowledgeReport,
} from "./knowledge";

/**
 * Staged onboarding extraction, driven by the chat flow: each stage runs only
 * when the user reaches it, so the contact form appears seconds after the URL
 * is entered instead of after the whole site has been crawled (a slow origin
 * at ~5s/page × dozens of pages made the all-at-once run feel frozen).
 *
 *   start(url)                 -> core stage   -> phase "core-done", step1 set
 *   advance("theme")           -> theme stage  -> phase "theme-done", step2 set
 *   advance("knowledge", [..]) -> selected extractions -> phase "done"
 *
 * One job per run, held in process memory and keyed on globalThis so dev HMR
 * doesn't orphan it. The job keeps its Crawler (and page cache) across stages,
 * so pages loaded for the contact form aren't re-fetched for the theme.
 */

export type Extractor = "blog" | "testimonials" | "team" | "sweep";
export const EXTRACTORS: Extractor[] = ["blog", "testimonials", "team", "sweep"];

export type Job = {
  id: string;
  userId: string;
  url: string;
  phase:
    | "core" | "core-done"
    | "theme" | "theme-done"
    | "blog" | "testimonials" | "team" | "sweep"
    | "done" | "failed";
  progress: number; // 0–100 within the currently running stage
  step1?: CoreInfo;
  step2?: ThemeExtract;
  chunkCount?: number;
  report?: Partial<KnowledgeReport>;
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

export function startJob(userId: string, url: string): Job {
  const job: Job = { id: randomUUID(), userId, url, phase: "core", progress: 0, busy: true };
  jobs.set(job.id, job);
  void runCore(job)
    .catch((err) => fail(job, err))
    .finally(() => (job.busy = false));
  return job;
}

/** Run the next stage. Returns false when the job isn't ready for it. */
export function advanceJob(job: Job, stage: "theme" | "knowledge", extractors?: Extractor[]): boolean {
  if (job.busy || job.phase === "failed") return false;
  if (stage === "theme" && job.phase === "core-done") {
    job.phase = "theme";
    job.busy = true;
    void runTheme(job)
      .catch((err) => fail(job, err))
      .finally(() => (job.busy = false));
    return true;
  }
  if (stage === "knowledge" && (job.phase === "theme-done" || job.phase === "core-done")) {
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
  let crawler = new Crawler(job.url);
  job.crawler = crawler;
  let home = await crawler.load(job.url);
  // Some small-business sites answer only on plain http (no TLS at all);
  // a bare pasted domain gets normalized to https, so fall back once.
  if (!home && job.url.startsWith("https://")) {
    await crawler.close();
    job.url = job.url.replace(/^https:/, "http:");
    crawler = new Crawler(job.url);
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
  job.extras = (await Promise.all(extraUrls.map((u) => crawler.load(u))))
    .filter((p): p is Page => !!p);
  job.progress = 80;
  job.step1 = await extractCoreInfo(crawler, [home, ...job.extras]);
  job.phase = "core-done";
  job.progress = 100;
}

async function runTheme(job: Job): Promise<void> {
  job.progress = 20;
  job.step2 = await extractTheme(job.crawler!, [job.home!, ...(job.extras ?? [])]);
  job.phase = "theme-done";
  job.progress = 100;
}

async function runKnowledge(job: Job, picked: Extractor[]): Promise<void> {
  const crawler = job.crawler!;
  const home = job.home!;
  const covered = new Set<string>([home.url]);
  const report: Partial<KnowledgeReport> = {};
  let chunks = 0;
  const stepShare = 100 / Math.max(picked.length, 1);
  let stepsDone = 0;

  try {
    if (picked.includes("blog")) {
      job.phase = "blog";
      job.progress = Math.round(stepShare * stepsDone++);
      const blog = await extractBlog(crawler, home, job.userId);
      blog.covered.forEach((u) => covered.add(u));
      report.blog = blog.report;
      chunks += blog.chunks;
    }
    if (picked.includes("testimonials")) {
      job.phase = "testimonials";
      job.progress = Math.round(stepShare * stepsDone++);
      const t = await extractTestimonials(crawler, home, job.userId);
      t.covered.forEach((u) => covered.add(u));
      report.testimonials = t.report;
      chunks += t.chunks;
    }
    if (picked.includes("team")) {
      job.phase = "team";
      job.progress = Math.round(stepShare * stepsDone++);
      const team = await extractTeam(crawler, home, job.userId);
      team.covered.forEach((u) => covered.add(u));
      report.team = team.report;
      chunks += team.chunks;
    }
    if (picked.includes("sweep")) {
      job.phase = "sweep";
      job.progress = Math.round(stepShare * stepsDone++);
      const sweep = await sweepSitemap(crawler, job.userId, covered);
      report.sweep = sweep.report;
      chunks += sweep.chunks;
    }
    job.report = report;
    job.chunkCount = chunks;
    job.phase = "done";
    job.progress = 100;
  } finally {
    await crawler.close();
    job.crawler = undefined;
    job.home = undefined;
    job.extras = undefined;
  }
}

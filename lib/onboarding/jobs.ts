import { randomUUID } from "node:crypto";
import { Crawler } from "./crawl";
import { extractCoreInfo, extractTheme, type CoreInfo, type ThemeExtract } from "./extract";
import {
  extractBlog, extractTestimonials, extractTeam, sweepSitemap, type KnowledgeReport,
} from "./knowledge";

/**
 * One onboarding extraction run per job id, held in process memory: the flow
 * is a single admin sitting on the page polling for progress, and an
 * interrupted job just gets re-run from the entry screen. Keyed on
 * globalThis so dev-server HMR doesn't orphan running jobs.
 */

export type Job = {
  id: string;
  userId: string;
  url: string;
  phase: "step1" | "step2" | "blog" | "testimonials" | "team" | "sweep" | "done" | "failed";
  progress: number; // 0–100 for the step-3 progress bar
  step1?: CoreInfo;
  step2?: ThemeExtract;
  chunkCount?: number;
  report?: KnowledgeReport;
  error?: string;
};

const jobs: Map<string, Job> =
  ((globalThis as Record<string, unknown>).__onboardingJobs as Map<string, Job>) ??
  new Map<string, Job>();
(globalThis as Record<string, unknown>).__onboardingJobs = jobs;

export function getJob(id: string, userId: string): Job | null {
  const job = jobs.get(id);
  return job && job.userId === userId ? job : null;
}

export function startJob(userId: string, url: string): Job {
  const job: Job = { id: randomUUID(), userId, url, phase: "step1", progress: 0 };
  jobs.set(job.id, job);
  void run(job).catch((err) => {
    job.phase = "failed";
    job.error = err instanceof Error ? err.message : String(err);
  });
  return job;
}

async function run(job: Job): Promise<void> {
  const crawler = new Crawler(job.url);
  try {
    const home = await crawler.load(job.url);
    if (!home) throw new Error("Could not load that site. Check the URL and try again.");

    // Steps 1 + 2 read the homepage plus the pages most likely to carry
    // contact info and brand styling.
    const extraUrls = crawler
      .navLinks(home)
      .filter((l) => /about|contact|team/i.test(l.text))
      .map((l) => l.url)
      .slice(0, 4);
    const extras = (await Promise.all(extraUrls.map((u) => crawler.load(u))))
      .filter((p): p is NonNullable<typeof p> => !!p);
    job.step1 = await extractCoreInfo(crawler, [home, ...extras]);
    job.phase = "step2";
    job.progress = 5;
    job.step2 = await extractTheme(crawler, [home, ...extras]);

    // Step 3: the four knowledge extractions, all on-domain, deduplicated.
    const covered = new Set<string>([home.url]);
    job.phase = "blog";
    job.progress = 15;
    const blog = await extractBlog(crawler, home, job.userId);
    blog.covered.forEach((u) => covered.add(u));

    job.phase = "testimonials";
    job.progress = 55;
    const testimonials = await extractTestimonials(crawler, home, job.userId);
    testimonials.covered.forEach((u) => covered.add(u));

    job.phase = "team";
    job.progress = 70;
    const team = await extractTeam(crawler, home, job.userId);
    team.covered.forEach((u) => covered.add(u));

    job.phase = "sweep";
    job.progress = 85;
    const sweep = await sweepSitemap(crawler, job.userId, covered);

    job.report = {
      blog: blog.report,
      testimonials: testimonials.report,
      team: team.report,
      sweep: sweep.report,
    };
    job.chunkCount = blog.chunks + testimonials.chunks + team.chunks + sweep.chunks;
    job.phase = "done";
    job.progress = 100;
  } finally {
    await crawler.close();
  }
}

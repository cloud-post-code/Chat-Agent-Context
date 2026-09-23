import { prisma } from "@/lib/db";
import { mapPool } from "@/lib/pool";
import { createBulkAccount } from "@/lib/bulkAccounts";
import { saveOnboardingReview } from "@/lib/onboarding/save";
import type { Job } from "@/lib/onboarding/jobs";

/**
 * The bulk site builder's orchestrator: one username-based account per pasted
 * link, the full onboarding pipeline run unattended over each, every stage's
 * result auto-saved through saveOnboardingReview — no human review. Builds
 * are held in process memory, like onboarding jobs (lib/onboarding/jobs.ts).
 *
 * lib/onboarding/jobs.ts is NOT imported at module load: it transitively pulls
 * in next/font (via lib/onboarding/extract.ts), which breaks under a plain
 * `tsx` run (no Next.js runtime) — exactly how the feature's proof runs. The
 * default extract runner below imports it lazily instead.
 */

export type UnattendedStage =
  | "core" | "locations" | "social" | "images" | "theme" | "knowledge";

export type StageData = Pick<
  Job, "step1" | "stepLoc" | "stepSocial" | "stepImages" | "step2" | "stepBrand" | "chunkCount"
>;

export type ExtractHooks = {
  onStage: (stage: UnattendedStage, data: StageData) => Promise<void>;
  onStageError: (stage: UnattendedStage, err: unknown) => void;
  onEvent: (line: string) => void;
};

export type ExtractRunner = (userId: string, url: string, hooks: ExtractHooks) => Promise<void>;

export type SiteStatus = "queued" | "building" | "done" | "done_with_warnings" | "failed";

export type BulkSite = {
  url: string;
  status: SiteStatus;
  stage?: UnattendedStage;
  userId?: string;
  username?: string;
  password?: string;
  slug?: string;
  name?: string;
  lastLine?: string;
  warnings: string[];
  error?: string;
};

export type BulkBuild = {
  id: string;
  operatorId: string;
  createdAt: number;
  finishedAt?: number;
  sites: BulkSite[];
  dropped: string[];
};

const g = globalThis as {
  __bulkBuilds?: Map<string, BulkBuild>;
  __bulkExtractRunner?: ExtractRunner | null;
  __bulkSettled?: Map<string, Promise<void>>;
};

const builds: Map<string, BulkBuild> = g.__bulkBuilds ?? new Map<string, BulkBuild>();
g.__bulkBuilds = builds;

// Internal per-build settled promises — never serialized, kept out of BulkBuild.
const settled: Map<string, Promise<void>> = g.__bulkSettled ?? new Map<string, Promise<void>>();
g.__bulkSettled = settled;

const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 4;
const DEFAULT_CONCURRENCY = 2;

/** How many sites build at once for a run. */
export function bulkConcurrency(): number {
  const n = Math.floor(Number(process.env.BULK_BUILD_CONCURRENCY ?? DEFAULT_CONCURRENCY));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, n));
}

/** Test hook: force what startBulkBuild uses when no `opts.extract` is given.
 *  null restores the real (onboarding-pipeline) runner. */
export function setDefaultExtractRunner(runner: ExtractRunner | null): void {
  g.__bulkExtractRunner = runner;
}

/** Only the fields the onboarding save route accepts, from a Job's stage data. */
function pickStageData(job: Job): StageData {
  const { step1, stepLoc, stepSocial, stepImages, step2, stepBrand, chunkCount } = job;
  return { step1, stepLoc, stepSocial, stepImages, step2, stepBrand, chunkCount };
}

/** The real runner: the guided onboarding stages, run unattended end to end. */
async function realExtractRunner(userId: string, url: string, hooks: ExtractHooks): Promise<void> {
  const { runUnattendedJob } = await import("@/lib/onboarding/jobs");
  await runUnattendedJob(userId, url, {
    onStage: (stage, job) => hooks.onStage(stage, pickStageData(job)),
    onStageError: hooks.onStageError,
    onEvent: hooks.onEvent,
  }).then(() => undefined);
}

function extractRunnerFor(opts?: { extract?: ExtractRunner }): ExtractRunner {
  return opts?.extract ?? g.__bulkExtractRunner ?? realExtractRunner;
}

const SPLIT_RE = /[\n,\s]+/;

function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  let str = u.toString();
  if (u.pathname === "/" && !u.search) str = str.replace(/\/$/, "");
  return str;
}

/** Split pasted links on newlines/commas/whitespace, normalize, dedupe. */
export function parseLinks(input: string): { urls: string[]; dropped: string[] } {
  const tokens = input.split(SPLIT_RE).map((t) => t.trim()).filter(Boolean);
  const urls: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const normalized = normalizeUrl(token);
    if (!normalized) {
      dropped.push(token);
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return { urls, dropped };
}

/** Theme mapping mirrors the guided flow's client (OnboardingFlow.tsx). */
const THEME_COLOR_KEYS = ["bg", "text", "surface", "surfaceText", "accent", "accentText", "border"];

type ThemeSave = { theme: Record<string, unknown>; brand?: Record<string, unknown> };

function themeSavePayload(data: StageData): ThemeSave {
  const t2 = (data.step2 ?? {}) as Record<string, unknown>;
  const colorsIn = (t2.themeColors ?? {}) as Record<string, string>;
  const themeColors: Record<string, string> = {};
  for (const k of THEME_COLOR_KEYS) if (colorsIn[k]) themeColors[k] = colorsIn[k];
  const theme = {
    themeFont: "space-grotesk",
    themeBodyFont: String(t2.themeBodyFont ?? "inter"),
    themeRadius: String(t2.themeRadius ?? "rounded"),
    themeFontSize: String(t2.themeFontSize ?? "") || "16",
    themeHeadingWeight: String(t2.themeHeadingWeight ?? "") || "700",
    themeColors,
    themeLogo: String(t2.themeLogo ?? ""),
  };
  const brand = data.stepBrand as unknown as Record<string, unknown> | undefined;
  return brand ? { theme, brand } : { theme };
}

/** Persist one stage's result through the auto-approve save path. */
async function persistStage(
  site: BulkSite, userId: string, stage: UnattendedStage, data: StageData,
): Promise<void> {
  if (stage === "core") {
    const profile = data.step1 as unknown as Record<string, unknown>;
    await saveOnboardingReview(userId, { profile });
    const companyName = (data.step1 as { company_name?: string } | undefined)?.company_name?.trim();
    if (companyName) {
      await prisma.user.update({ where: { id: userId }, data: { name: companyName } });
      site.name = companyName;
    }
  } else if (stage === "locations") {
    await saveOnboardingReview(userId, { locations: { locations: data.stepLoc?.locations ?? [] } });
  } else if (stage === "social") {
    await saveOnboardingReview(userId, { social: { links: data.stepSocial?.links ?? [] } });
  } else if (stage === "images") {
    const images = (data.stepImages?.images ?? []).map((i) => ({ src: i.src, caption: i.caption }));
    await saveOnboardingReview(userId, { gallery: { images } });
  } else if (stage === "theme") {
    await saveOnboardingReview(userId, themeSavePayload(data));
  }
  // "knowledge": runKnowledge writes directly — nothing to save here.
}

/** What runs after each stage, for the row's "stage" column. */
const NEXT_STAGE: Record<UnattendedStage, UnattendedStage | undefined> = {
  core: "locations", locations: "social", social: "images", images: "theme",
  theme: "knowledge", knowledge: undefined,
};

function buildHooks(site: BulkSite, userId: string): ExtractHooks {
  return {
    onEvent: (line) => (site.lastLine = line),
    onStage: async (stage, data) => {
      await persistStage(site, userId, stage, data);
      // The row shows what is running now, and the next stage starts as
      // soon as this hook returns.
      site.stage = NEXT_STAGE[stage];
    },
    onStageError: (stage, err) => {
      const msg = err instanceof Error ? err.message : String(err);
      site.warnings.push(`${stage}: ${msg}`);
    },
  };
}

/** Build one site end to end: account, unattended extraction, auto-save. */
async function buildSite(site: BulkSite, runner: ExtractRunner): Promise<void> {
  site.status = "building";
  site.stage = "core";

  let account: Awaited<ReturnType<typeof createBulkAccount>>;
  try {
    account = await createBulkAccount(site.url);
  } catch (err) {
    site.status = "failed";
    site.error = err instanceof Error ? err.message : String(err);
    return;
  }
  site.userId = account.userId;
  site.username = account.username;
  site.password = account.password;
  site.slug = account.slug;
  site.name = account.name;

  try {
    await runner(account.userId, site.url, buildHooks(site, account.userId));
  } catch (err) {
    site.status = "failed";
    site.error = err instanceof Error ? err.message : String(err);
    site.stage = undefined;
    await prisma.user.delete({ where: { id: account.userId } }).catch(() => {});
    site.userId = undefined;
    site.username = undefined;
    site.password = undefined;
    site.slug = undefined;
    return;
  }

  await prisma.user.update({ where: { id: account.userId }, data: { onboardedAt: new Date() } });
  site.status = site.warnings.length ? "done_with_warnings" : "done";
  site.stage = undefined;
}

/** Registers and starts a build; returns immediately, work runs in the background. */
export function startBulkBuild(
  operatorId: string, input: string, opts?: { extract?: ExtractRunner; concurrency?: number },
): BulkBuild {
  const { urls, dropped } = parseLinks(input);
  const build: BulkBuild = {
    id: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    operatorId,
    createdAt: Date.now(),
    dropped,
    sites: urls.map((url) => ({ url, status: "queued" as SiteStatus, warnings: [] })),
  };
  builds.set(build.id, build);

  const runner = extractRunnerFor(opts);
  const concurrency = opts?.concurrency ?? bulkConcurrency();
  const done = mapPool(build.sites, concurrency, (site) => buildSite(site, runner))
    .then(() => undefined)
    .finally(() => (build.finishedAt = Date.now()));
  settled.set(build.id, done);

  return build;
}

/** Resolves once the build has settled (immediately if unknown or already done). */
export async function whenSettled(buildId: string): Promise<void> {
  await (settled.get(buildId) ?? Promise.resolve());
}

export function getBulkBuild(id: string, operatorId: string): BulkBuild | null {
  const b = builds.get(id);
  return b && b.operatorId === operatorId ? b : null;
}

/** Newest first. */
export function listBulkBuilds(operatorId: string): BulkBuild[] {
  return [...builds.values()]
    .filter((b) => b.operatorId === operatorId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** A plain JSON-safe copy — passwords included, the operator's own view. */
export function bulkBuildPayload(build: BulkBuild): BulkBuild {
  return JSON.parse(JSON.stringify(build));
}


export { createLimiter, createPacer, mapPool, type Limiter } from "@/lib/pool";
// The shared model gate with 429/529 backoff lives with the client: lib/claude/retry.ts (modelCall).

/**
 * Concurrency for the onboarding run: how many agents work at once, and the
 * two shared gates that keep "at once" from meaning "all at once".
 *
 * Onboarding used to be strictly serial — one page load, one model call, one
 * category at a time, with a fixed sleep between indexing calls. Almost all of
 * that wall-clock was waiting on the network, so the run now fans out: the
 * category extractors run side by side, and inside each one the per-page work
 * goes through `mapPool`. Two things are deliberately NOT per-agent:
 *
 *  - page renders share the Crawler's own limiter (lib/onboarding/crawl.ts), so
 *    four agents never open sixteen Chromium tabs against one small origin;
 *  - model calls share `modelCall` (lib/claude/retry.ts), process-wide, because every tenant
 *    onboarding at the same moment spends the same API key's per-minute limits.
 *
 * ONBOARDING_CONCURRENCY=1 restores the old one-at-a-time behavior.
 */

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 12;

/** How many agents / page renders / model calls run at once. */
export function onboardingConcurrency(): number {
  const n = Math.floor(Number(process.env.ONBOARDING_CONCURRENCY ?? DEFAULT_CONCURRENCY));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
  return Math.min(n, MAX_CONCURRENCY);
}

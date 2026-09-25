import { sleep } from "@/lib/util/async";
import { createLimiter, type Limiter } from "@/lib/pool";

export { createLimiter, createPacer, mapPool, type Limiter } from "@/lib/pool";

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
 *  - model calls share `modelCall` below, process-wide, because every tenant
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


/** Rate-limited (429) or overloaded (529): worth waiting out, not a real failure. */
function isRateLimit(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  return status === 429 || status === 529;
}

/** The provider's own `retry-after`, when the error carries one. */
function retryAfterMs(err: unknown): number | null {
  const headers = (err as { headers?: unknown } | null)?.headers;
  let raw: unknown;
  if (headers && typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("retry-after");
  } else if (headers && typeof headers === "object") {
    raw = (headers as Record<string, unknown>)["retry-after"];
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

/** Waits a rate limit gets before it counts as a failure like any other. */
const RATE_LIMIT_RETRIES = 6;
const MAX_COOLDOWN_MS = 60_000;

type ModelGate = { limit: Limiter; cap: number; cooldownUntil: number };

// On globalThis for the same reason the job map is: dev HMR re-evaluates this
// module, and a second gate would double the real concurrency.
function gate(): ModelGate {
  const g = globalThis as { __onboardingModelGate?: ModelGate };
  const cap = onboardingConcurrency();
  if (!g.__onboardingModelGate || g.__onboardingModelGate.cap !== cap) {
    g.__onboardingModelGate = { limit: createLimiter(cap), cap, cooldownUntil: 0 };
  }
  return g.__onboardingModelGate;
}

/**
 * Run one model call through the shared gate.
 *
 * Concurrency replaces the fixed sleep the indexing passes used to take
 * between calls, so the per-minute limit is now handled where it actually
 * shows up: a 429 sets a cooldown that EVERY waiting agent honors (four agents
 * each retrying on their own just re-trip the same limit), then the call is
 * retried. Rate limits get their own, longer retry budget — they say "slow
 * down", not "this call is broken" — and any other error passes straight
 * through to the caller's own failure policy.
 */
export async function modelCall<T>(
  fn: () => Promise<T>,
  opts: { sleepFn?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const g = gate();
  const wait = opts.sleepFn ?? sleep;
  return g.limit(async () => {
    for (let attempt = 0; ; attempt++) {
      const cooling = g.cooldownUntil - Date.now();
      if (cooling > 0) await wait(cooling);
      try {
        return await fn();
      } catch (err) {
        if (!isRateLimit(err) || attempt >= RATE_LIMIT_RETRIES) throw err;
        const ms = Math.min(MAX_COOLDOWN_MS, retryAfterMs(err) ?? 2000 * 2 ** attempt);
        g.cooldownUntil = Math.max(g.cooldownUntil, Date.now() + ms);
      }
    }
  });
}

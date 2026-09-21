/**
 * Small concurrency primitives: a semaphore, an ordered bounded map, and a
 * start-spacing pacer. No imports and no policy — how many run at once, and
 * what they gate, is the caller's decision (lib/onboarding/pool.ts holds the
 * onboarding run's).
 */

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/** A counting semaphore: at most `max` of the wrapped calls run at a time, FIFO. */
export function createLimiter(max: number): Limiter {
  const cap = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= cap) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      // A finished call hands its slot straight to the next waiter rather than
      // freeing it: between a free and the waiter resuming, a new caller could
      // otherwise take the slot too and run one over the cap.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

/**
 * `items.map(fn)` with at most `max` running at once. Results keep the input
 * order, so callers that dedupe or report in order behave as the serial loop
 * did. The first rejection rejects the whole call and no NEW item starts after
 * it; items already in flight finish on their own (nothing here can cancel a
 * network call) and their results are dropped.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  max: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(max)), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Optional spacing between the STARTS of paced calls, shared by whatever runs
 * through it. The first caller goes at once and each later one is held until
 * `paceMs` after the one before — the fixed sleep the serial indexing passes
 * took, kept as an operator's brake (EMBED_PACE_MS) for entry-tier keys. With
 * `paceMs` 0 it never waits.
 */
export function createPacer(paceMs: number): () => Promise<void> {
  let nextAt = 0;
  return async () => {
    if (!(paceMs > 0)) return;
    const now = Date.now();
    const at = Math.max(now, nextAt);
    nextAt = at + paceMs;
    if (at > now) await sleep(at - now);
  };
}

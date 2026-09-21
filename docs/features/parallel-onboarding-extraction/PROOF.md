# Proof Plan

## Definition Of Done
- The knowledge stage runs its category extractors together, fans out the
  per-page work inside them, and reads several sources at once in the graph
  pass — and is materially faster for it on the same site.
- The run's RESULT is the same as one-at-a-time: same knowledge report, same
  Source rows, same chunk texts, same graph size.
- What is shared stays bounded: open tabs per crawler and model calls in
  flight never exceed `ONBOARDING_CONCURRENCY`; with it set to `1` exactly one
  of each runs at a time and the categories go one after another.
- No page is rendered twice, however many agents ask for it.
- Each source is read for the graph once per run (it was twice), and
  concurrent graph writers converge on one entity row with no failed write.
- A rate-limit response is waited out by every agent and retried; any other
  error still reaches the caller's failure policy untouched.

## Primary Proof
Type: integration — the real job, a fake model

Command:
```bash
npx tsx docs/features/parallel-onboarding-extraction/proof.ts
```

Needs `DATABASE_URL` (read from `.env`) and the Playwright Chromium the app
already uses. No app server and no model key: `@anthropic-ai/sdk` is swapped
for a deterministic stand-in with a fixed 250ms latency that counts its calls
in flight, so the proof spends nothing and never depends on model wording.
Everything else is the production path — `startJob` / `advanceJob` in
`lib/onboarding/jobs.ts`, the real Crawler rendering the guided-onboarding
fixture site (served with a 300ms delay per page and eight extra sitemap pages
so the sweep has a real fan-out), the real extractors, saves, graph pass and
database, under throwaway users that are deleted afterwards.

It prints `PROOF PASS` or exits 1, in three parts:
- **Pool primitives** — the limiter's cap and arrival order, `mapPool`'s
  ordering, cap and fail-fast, the pacer, the model gate's cap, a 429 cooling
  the gate down for `retry-after` and retrying, other errors passing through,
  the concurrency setting's clamping, and the filing estimate shrinking with
  concurrency while honoring a pace.
- **Crawler** — one url asked for three times renders once; six concurrent
  loads on a cap of two never open a third tab; a closed crawler returns null
  and never relaunches.
- **The real job, twice** — `ONBOARDING_CONCURRENCY=1` then `4`, measuring the
  knowledge stage. Asserts the peaks (1 vs >1 and ≤4, for both tabs and model
  calls), that all four category agents start before any finishes (and do NOT
  when set to 1), that the sweep waits for them, that the parallel run takes
  under 70% of the serial one, and that report, Source rows, chunk texts,
  chunk count and graph size are identical between the two.

Recorded run (2026-09-20, local): knowledge stage 31.0s one at a time, 10.0s
with four agents. That serial figure is the NEW code at concurrency 1 — it
already excludes the fixed 21s sleeps and the second graph pass the old code
had. The old code itself, timed on a clean checkout of the starting commit
with this same fixture and fake model: 644.3s for the same 15 sources and 28
chunks, with 30 graph-extraction calls — every source read twice.

## Secondary guards
- `npx tsc --noEmit` and `npm run lint` clean.
- Contracts this feature changed, updated and green:
  - `npx tsx docs/features/onboarding-graph-indexing/proof.ts` — assertion 12
    was "the default pace is 21s"; it is now "the defaults are bounded": a
    default run reads several sources at once, never more than the configured
    agents, each exactly once, converging on one entity row.
  - `npx tsx docs/features/onboarding-filing-eta/proof/filing-eta.ts` — the
    estimate math follows the wave formula, and the pacing floor when paced.
- Still green, unchanged: `guided-onboarding/proof/rendered-extraction.ts`,
  `chat-transcript.ts`, `activity-stream-retention.ts`,
  `onboarding-goal-extraction/proof.ts`,
  `onboarding-tags-starter-sources/proof.ts`.
- `onboarding-booking-extraction/proof.ts` (6 failures) and
  `graph-cluster-summaries/proof.ts` (stale pre-multi-tenant fixture) are red
  on a clean checkout of the commit this work started from, with the same
  failures — not touched here.

## Anti-Gaming Constraints
- Speed must come from overlap, not from doing less: the identical-results
  assertions compare every Source row and every chunk text between the runs.
- The serial run must really be serial, or "faster than serial" proves
  nothing: the proof asserts a peak of exactly one tab and one model call and
  non-overlapping categories at concurrency 1.
- The caps are measured from outside the code under test — by the fixture
  server and the fake model — not read back from the pool's own counters.
- The fake model returns ONE shared entity for every source, so the
  concurrent graph writers collide on the same row; a lock that didn't hold
  would surface as a failed write or a duplicate row.

## Not proven here
- Behavior against the live model's real per-minute limits at concurrency 4.
  The gate's 429 handling is proven with a synthetic rate-limit error; an
  entry-tier key that trips often should lower `ONBOARDING_CONCURRENCY` or set
  `EMBED_PACE_MS`.
- An embeddings provider on a very low per-minute tier: saves embed one
  request per record, now several at once. A failed embed still fails soft
  (the chunk is saved, lexically searchable, and repairable from the Graph
  tab), exactly as before.

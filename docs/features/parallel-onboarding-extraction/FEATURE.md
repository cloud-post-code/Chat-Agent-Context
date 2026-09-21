# Onboarding extraction runs multiple agents at a time

## Summary
The user's request (2026-09-20): "make the extraction run multiple agents at a
time so that it happens faster."

The knowledge stage of onboarding was strictly serial. One category at a time
(blog, then testimonials, then team, then services, then the sitemap sweep);
inside each category one page render at a time and one model call at a time;
then the graph pass read every saved source with a fixed 21-second sleep
between model calls — and ran twice, once on its own and once again inside the
filing pass. Nearly all of that wall-clock is waiting on the network: a
Chromium render, a model response, a sleep. A forty-page site spent well over
ten minutes in sleeps alone.

## Desired Behavior
- The category extractors run as agents side by side: blog, testimonials, team
  and services start together. The sweep starts when they finish, because it
  takes exactly the pages they did not claim.
- Inside an agent the per-page work fans out: blog posts and swept pages are
  each "render, distill, save" pipelines that run several at a time; listing
  pages, candidate pages and image downloads load together.
- The shared resources are capped where they are shared, not per agent:
  - open browser tabs, per Crawler — four agents never become sixteen tabs
    against one small origin;
  - model calls in flight, process-wide — every tenant onboarding at once
    spends the same key's per-minute limits.
- The fixed 21s sleep between indexing calls is gone from onboarding. What it
  guarded is handled where it shows up: a rate-limit response (429/529) cools
  EVERY agent down for the provider's `retry-after`, then retries, on a longer
  budget than ordinary failures get. `EMBED_PACE_MS`, when an operator sets
  it, still spaces the indexing calls; `scripts/reindex.ts` keeps its 21s
  default.
- The graph pass runs once, not twice, alongside the profile/persona/photo
  origins pass and the goals draft. Starter questions and cards still come
  last, in order, because they read all of it.
- Results are the same as the serial run: same records, same chunk counts,
  same dedup, same report, results gathered in input order. A failed
  extraction still fails the run.
- `ONBOARDING_CONCURRENCY` (default 4, max 12) sets how many run at once; `1`
  restores one-at-a-time.
- The filing estimate (onboarding-filing-eta) describes the concurrent pass:
  it shrinks with concurrency and still honors a pace when one is set.

## What had to become safe
- `Crawler.load`: two agents asking for one url share one render; concurrent
  first loads share one browser launch; a closed crawler never relaunches, so
  a failed run's other agents wind down instead of orphaning a browser.
- Graph writes (`persistGraph`, `dropOrigin`) are serialized per user: each
  ends by pruning unmentioned entities, which would delete a concurrent
  writer's just-upserted entity out from under its mention insert.
- The testimonials record gets its own `#testimonials` key (the `#team`
  precedent): with no reviews page it falls back to the homepage url, and so
  does the services record — two agents upserting one Source row race on the
  unique key, and serially the second silently reset the first's chunks.

## Out Of Scope
- Splitting one job across processes or machines; the job, its gates and the
  graph lock are in-process, like the job map itself.
- Streaming per-agent progress bars (`docs/features/live-ingestion-feed`).
- Changing what any extractor extracts, or any prompt.

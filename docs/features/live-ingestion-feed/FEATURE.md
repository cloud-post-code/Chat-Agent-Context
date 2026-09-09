# Live ingestion feed for onboarding knowledge extraction

## Summary
During the onboarding knowledge stage the chat can sit on a single activity
line with a static progress bar for minutes at a time. Users read that as a
hang and abandon the run — even though extraction is detached from the browser
and always finishes. This feature makes the running job continuously legible:
every page fetch and every batch of saved chunks appears as it happens, an
elapsed-time heartbeat keeps the feed moving between real events, and a job
still running after the user leaves onboarding stays visible from
`/admin/chat` instead of disappearing.

This is observability only. It does not change what is extracted, what is
saved, or the staged extraction contract owned by `docs/features/guided-onboarding`.

## Desired Behavior

### Per-URL lines
- While a knowledge extractor runs, each page it fetches appends its own
  activity line naming the path being read.
- The `Crawler` already emits `Reading <path>` through its `onEvent` callback,
  and `runKnowledge` already builds an `onEvent` that appends to the job log.
  The knowledge extractors accept that callback as their `log` parameter but
  never call it, so those per-page events never reach the feed. Wiring the
  existing callback through is the mechanism; no new event channel is needed.
- Page lines are attributed to the category being extracted, so a user can
  tell a blog fetch from a sitemap sweep fetch.
- Pages served from the crawler's existing cache do not emit a fetch line;
  the feed reflects real work, never replayed work.

### Per-chunk counts
- When an extractor saves chunks, the feed reports the count as it is saved,
  rather than only in the end-of-category summary.
- A running total of chunks saved so far is visible while the stage runs, not
  only in the final "Saved N knowledge chunks" line.
- Counts in the feed always agree with the `chunkCount` the job reports on
  completion.

### Elapsed-time heartbeat
- The feed never appears stalled: while a stage is running and no new activity
  line has arrived, the UI still shows movement derived from elapsed time.
- The heartbeat conveys that the job is alive and how long it has been working.
  It never fabricates progress through a stage that has not advanced — a
  quiet stage reads as "still working, N minutes in", never as a rising
  completion percentage.
- The heartbeat is driven by elapsed wall-clock time, matching the existing
  `Typewriter`, so a backgrounded tab catches up on return instead of stalling.

### Resumable view from /admin/chat
- A user who clicks "Continue to chat" while extraction is running sees the
  live feed continue on `/admin/chat`, rather than losing all visibility.
- The resumed view shows the same activity lines, running chunk total, and
  heartbeat as the onboarding page, and reports completion when the job ends.
- The resumed view is dismissible, and does not obstruct normal chat use.
- Resuming requires finding a running job without a client-held job id:
  `getJob` today is keyed on job id, and `/admin/chat` never receives one, so
  the user's active job must be discoverable from the session alone.
- A user with no running job sees nothing added to `/admin/chat`.
- When the job completes while the resumed view is open, it reports the same
  completion summary the onboarding page would have shown, then stops polling.

## Scope
- `lib/onboarding/knowledge.ts`: call the already-accepted `log` callback for
  page fetches and chunk saves across `extractBlog`, `extractTestimonials`,
  `extractTeam`, and `sweepSitemap`.
- `lib/onboarding/jobs.ts`: expose a running job for the current user, and
  carry whatever timing/running-total state the feed needs.
- `app/api/admin/onboarding/status`: allow a status read for the session's
  active job without a caller-supplied job id.
- `app/admin/onboarding/ActivityStream.tsx`: heartbeat and running totals.
- `app/admin/chat`: the resumed live view.

## Non-Goals
- No change to which pages are crawled, what is extracted, how chunks are
  chunked, or what is written to `Source`/`Chunk`, the graph, goals, or
  starter questions.
- No change to the staged `/start` → `/advance` → `/status` contract, or to
  the phases the flow transitions on.
- No cancellation or pausing of a running extraction.
- No change to the fact that extraction continues when the user leaves
  onboarding — that behavior is already correct and is preserved.
- No switch from polling to a streaming transport; the existing poller stays.
- No persistence of jobs across a server restart; jobs remain in process
  memory as they are today.

## Scenarios
- **Happy path**: a user selects blog + sweep, extraction starts, and the feed
  names each page as it is read and reports chunks as they are saved. The
  progress bar and heartbeat move continuously. The final summary's chunk
  count matches what the feed reported along the way.
- **Slow origin**: a site answering at several seconds per page produces long
  gaps between fetches. The heartbeat keeps the feed visibly alive across each
  gap, and no gap presents as a completed or stalled run.
- **User leaves mid-run**: the user clicks "Continue to chat" while the sweep
  is still running. `/admin/chat` shows the live feed continuing, and reports
  completion when the job finishes.
- **Nothing running**: a user who onboarded long ago opens `/admin/chat` and
  sees no feed and no extra polling.
- **Category finds nothing**: an extractor that finds no blog still emits its
  page-check activity and its "no blog found" outcome; an empty category never
  looks like a hang.
- **Extraction fails mid-run**: the feed stops at the failure and the existing
  failure surface reports it; the heartbeat does not keep implying progress.
- **Another user's job**: a status read for the session's active job never
  returns a job belonging to a different user.

## Constraints
- Tenant-scoped: every job read is scoped to the logged-in user, matching
  `getJob`'s existing `userId` check.
- `jobPayload` must keep stripping internal crawl state (live browser and
  cheerio pages); the feed must not cause HTML to be serialized on a poll.
- The job log is capped at 400 lines in `lib/onboarding/jobs.ts`. Per-URL
  lines make a large sweep far chattier, so the cap must not silently discard
  the category outcomes and final summary a user needs to read.
- Poll payload size must stay bounded as the log grows.
- Activity lines are user-facing prose in the established voice of the
  existing lines — plain language about what is being read and found, not
  developer log output or raw URLs.
- Extraction must remain detached from the browser: nothing in this feature
  may make job progress depend on a client polling it.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

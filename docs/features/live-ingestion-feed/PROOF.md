# Proof Plan

## Definition Of Done
- While the knowledge stage runs, the feed names pages as they are fetched:
  distinct per-page activity lines, in user-facing prose rather than raw URLs
  or developer log output, attributable to the category doing the work.
- A running chunk total is visible DURING the run, never decreases, and agrees
  with the `chunkCount` the job reports on completion.
- The feed never presents as frozen: across a full run against a slow origin
  there is no 60-second stretch in which the polled payload does not change,
  and the client renders an elapsed-time heartbeat that keeps moving between
  real events.
- The heartbeat conveys liveness without fabricating progress: elapsed time
  alone never advances the progress bar, and a finished job stops rendering a
  live heartbeat.
- A user who leaves onboarding while extraction runs can still see the feed
  from `/admin/chat`: the session's active job is discoverable with no
  client-held job id, and it carries the same activity lines.
- Extraction still completes for that user after they leave — the detached
  behavior that is already correct today is preserved, not regressed.
- The active-job lookup is tenant-scoped: one user's session can never read
  another user's job, by id or by active-job lookup. A user with no running
  job gets no job.
- The 400-line log cap never evicts the category outcomes or the final
  summary, even once per-URL chatter makes a sweep exceed the cap.
- `jobPayload` still strips internal crawl state (`crawler`, `home`,
  `extras`), and the poll payload stays bounded as the log grows.

## Primary Proof
Type: api

Command:
```bash
PROOF_BASE_URL=http://localhost:3100 npx tsx docs/features/live-ingestion-feed/proof/live-feed.ts
```

Requires the app running on `PROOF_BASE_URL` with `DATABASE_URL` and
`ANTHROPIC_API_KEY` set (the knowledge stage refuses to run without a model
key). The script serves the guided-onboarding fixture site itself.

Expected evidence:
- `PROOF PASS: feed streams pages and chunk counts live, never goes 60s
  unchanged, and resumes from /admin/chat`, exit 0.
- Per-URL: at least 5 `Reading …` lines naming at least 5 distinct pages, none
  of them a bare URL.
- Per-chunk: `chunksSoFar` present on polls during the run, monotonically
  non-decreasing, greater than zero before `phase === "done"`, and equal to
  the final `chunkCount`.
- Liveness: worst observed gap with a completely unchanged payload is under
  60s; `startedAt` or `elapsedMs` is present so the client can render elapsed
  time.
- Resume: `POST /api/admin/onboarding/status` with an empty body returns the
  session's still-running job (matching the job id the flow started) with a
  non-empty `log`; the same call from a different user's session does not
  return that job; a user with no running job gets 404.
- Hygiene: `crawler`/`home`/`extras` absent from every sampled payload; the
  largest sampled payload is under 512KB; `log` is at most 400 lines and still
  contains the `Saved N knowledge chunks` summary.

Secondary guards:
- Client-side feed behavior (heartbeat, running total, outcome retention under
  the log cap), rendered from the real component:
  ```bash
  npx tsx docs/features/live-ingestion-feed/proof/feed-liveness.ts
  ```
  Expects `PROOF PASS: heartbeat moves without faking progress, stops when
  done; running total shown (including 0); all 5 outcomes survive a 505-line
  run`, exit 0. Needs no server or database.
- The guided-onboarding proof must still pass unchanged — this feature is
  observability only and must not alter the extraction contract:
  ```bash
  PROOF_BASE_URL=http://localhost:3100 npx tsx docs/features/guided-onboarding/proof.ts
  ```
- The existing feed-retention regression proof must still pass:
  ```bash
  npx tsx docs/features/guided-onboarding/proof/activity-stream-retention.ts
  ```

## Environment And Data
- App server running on `PROOF_BASE_URL` (default `http://localhost:3100`).
- `DATABASE_URL` reachable; the proof signs up three fresh users per run and
  reads `User` back through Prisma.
- `ANTHROPIC_API_KEY` set on the server — the knowledge stage requires it.
- Fixture site: `docs/features/guided-onboarding/proof/fixtures/site`, reused
  rather than duplicated (12 HTML pages, 9-entry sitemap, blog with feed and
  pagination, testimonials, team bios).
- The fixture server injects a per-request delay (`PROOF_PAGE_DELAY_MS`,
  default 700ms). This is load-bearing: a fast localhost origin never
  reproduces the silent gaps that made the real feed look frozen, so the
  no-silent-gaps assertion would be vacuous without it.
- Fixture port overridable via `PROOF_FIXTURE_PORT` (default 4174, chosen not
  to collide with the guided-onboarding proof's 4173).

## Anti-Gaming Constraints
- No mocks, no monkeypatching, no importing application internals in the
  primary proof: it drives the real HTTP surface with a real session cookie
  jar, exactly as the browser does.
- Liveness must be proven from INTERMEDIATE samples taken while the stage
  runs. Asserting only the terminal state cannot detect a frozen-looking feed
  and does not satisfy this proof.
- The no-silent-gaps check must run against the delayed fixture origin. Do not
  satisfy it by removing the delay or by shortening the run.
- The heartbeat must not be implemented by advancing the progress bar on
  elapsed time: `feed-liveness.ts` asserts the bar width is identical at 30s
  and 5m for an unchanged log, and fails if it moved.
- The log cap assertion must not be satisfied by raising the 400-line cap
  without preserving outcomes, nor by dropping per-URL lines to stay under it.
- Tenant scoping must be proven by an actual cross-user read, not by
  inspecting the code path.
- The guided-onboarding proof passing unchanged is required: extraction
  results, phases, and the `/start` → `/advance` → `/status` contract must not
  move.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The resumed `/admin/chat` view is proven at the API and data layer (the
  session-scoped active job resolves without a job id and carries the live
  log) plus a 200 on the chat page. That the feed is visually rendered and
  dismissable in that page is not asserted by an automated browser check, so
  it remains a one-time manual confirmation: start a run, click
  "Continue to chat", confirm the feed appears, keeps moving, reports
  completion, and can be dismissed without disrupting chat.

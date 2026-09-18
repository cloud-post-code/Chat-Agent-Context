# Onboarding: estimate and count down the memory-filing step

## Summary
The last stretch of the knowledge extraction run ("Filing everything into
your agent's memory") is the slowest and quietest part: it re-reads every
saved source and every profile origin with paced model calls, then writes
cluster overviews, starter questions and cards. Today it shows one static
line for minutes. The user's request (2026-09-10): when that step starts, say
up front how long it will take, and show a number that keeps updating so
they know how long until the run is done.

## Desired Behavior
- Before the filing pass starts, the job counts the work it is about to do
  (origins the indexer steps through, scanned sources the graph pass
  re-reads, clusters that will be summarized) and turns it into a seconds
  estimate using the same pacing the pass itself uses (`EMBED_PACE_MS`).
- The estimate covers the rest of the run, not just the filing pass: the
  starter-question and card stages that follow are included, so the number
  means "until done".
- The activity line announces the estimate in words ("Filing everything into
  your agent's memory — about 4 minutes to go").
- Beneath the feed, a countdown ("About 3:42 left") ticks every second from
  elapsed wall-clock time, is re-anchored by every status poll, and never
  goes negative: past the estimate it reads "Taking a little longer than
  estimated — still working".
- The countdown is gone once the job reports done or failed, and never shows
  before the filing pass begins.
- The wire shape is remaining seconds as of the poll, so server/browser
  clock skew cannot skew the number.
- A failed count is best-effort: the plain line shows and no countdown.

## Out Of Scope
- The elapsed-time heartbeat and the resumable feed on /admin/chat
  (`docs/features/live-ingestion-feed`).
- Learning the estimate from past runs.

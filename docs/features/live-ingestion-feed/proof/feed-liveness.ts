/**
 * Proof: the running feed is never silent, and never loses its outcomes.
 *
 * Renders the real ActivityStream to static markup and asserts the three
 * client-side halves of the feature:
 *   1. an elapsed-time heartbeat, so a stage with no new activity line still
 *      reads as alive rather than frozen;
 *   2. a running chunk total visible DURING the run, not only at the end;
 *   3. the 400-line log cap in lib/onboarding/jobs.ts never evicts the
 *      category outcomes and final summary — a chatty per-URL sweep must not
 *      push the user-meaningful lines out of the feed.
 *
 * Uses createElement directly so it runs under plain tsx without a JSX
 * runtime, matching docs/features/guided-onboarding/proof/activity-stream-retention.ts.
 *
 *   npx tsx docs/features/live-ingestion-feed/proof/feed-liveness.ts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityStream } from "../../../../app/admin/onboarding/ActivityStream";

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exit(1);
}

/** React escapes text nodes; compare against what actually lands in the DOM. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/**
 * The component's props are the contract this proof pins. `lines` and
 * `progress` exist today; the feature adds the liveness inputs. Typed loosely
 * so this file compiles before the props land — the assertions below are what
 * must pass, and they fail (not error) until the implementation exists.
 */
type FeedProps = {
  lines: string[];
  progress: number;
  /** ms the current stage has been running — drives the heartbeat. */
  elapsedMs?: number;
  /** chunks saved so far in this run. */
  chunksSoFar?: number;
  /** false once the job reaches done/failed, so the heartbeat stops. */
  running?: boolean;
};
const render = (p: FeedProps) =>
  renderToStaticMarkup(createElement(ActivityStream as never, p as never));

// ---------------------------------------------------------------- heartbeat
console.log("== elapsed-time heartbeat");

const QUIET = ["Sweeping the sitemap for remaining pages"];

// A stage that has been running four minutes with no new line must still say
// so. Digits alone are not enough (progress renders digits), so require the
// elapsed reading to name a unit.
const quiet = render({ lines: QUIET, progress: 40, elapsedMs: 4 * 60_000, running: true });
if (!/\b(4|four)\b/i.test(quiet) || !/(min|minute|m\b|sec|second)/i.test(quiet)) {
  fail("a 4-minute quiet stage shows no elapsed-time heartbeat — the feed reads as frozen");
}

// The heartbeat must MOVE between two renders that differ only in elapsed
// time. This is the actual anti-frozen assertion: same log, same progress.
const t1 = render({ lines: QUIET, progress: 40, elapsedMs: 30_000, running: true });
const t2 = render({ lines: QUIET, progress: 40, elapsedMs: 5 * 60_000, running: true });
if (t1 === t2) {
  fail("feed markup is identical at 30s and 5m with the same log — nothing conveys liveness");
}

// ...but it must not fabricate progress through a stage that has not advanced.
const barWidth = (html: string) => html.match(/width:\s*([\d.]+)%/)?.[1];
if (barWidth(t1) !== barWidth(t2)) {
  fail(`progress bar moved on elapsed time alone (${barWidth(t1)}% -> ${barWidth(t2)}%) — heartbeat must not fake completion`);
}

// A finished job must stop implying work is happening.
const doneHtml = render({ lines: [...QUIET, "All done"], progress: 100, elapsedMs: 5 * 60_000, running: false });
if (/(still|working|elapsed)/i.test(doneHtml)) {
  fail("a completed job still renders a live heartbeat");
}

// ------------------------------------------------------------ running total
console.log("== running chunk total");

const midRun = render({ lines: QUIET, progress: 40, elapsedMs: 60_000, chunksSoFar: 37, running: true });
if (!midRun.includes("37")) {
  fail("chunks saved so far (37) is not visible during the run");
}
// Zero is a real, meaningful state early in a run; it must not read as blank.
const zero = render({ lines: QUIET, progress: 5, elapsedMs: 5_000, chunksSoFar: 0, running: true });
if (zero === render({ lines: QUIET, progress: 5, elapsedMs: 5_000, running: true })) {
  fail("chunksSoFar=0 renders identically to an absent count — early runs look uninstrumented");
}

// --------------------------------------------------------------- log cap
console.log("== per-URL chatter must not evict outcomes");

// jobs.ts keeps the LAST 400 lines. A sweep emitting a line per page can
// exceed that on its own, so the outcomes a user actually needs must survive
// a log that has already been trimmed to the cap.
const OUTCOMES = [
  "Blog: saved 3 posts",
  "Testimonials: found 3",
  "Team: saved 3 bios",
  "Sitemap sweep: kept 9 pages",
  "Saved 214 knowledge chunks",
];
const chatter = Array.from({ length: 500 }, (_, i) => `Reading /page-${i + 1}`);
// Interleave the way a real run does: outcomes arrive between bursts of pages.
const interleaved: string[] = [];
OUTCOMES.forEach((o, i) => {
  interleaved.push(...chatter.slice(i * 100, (i + 1) * 100));
  interleaved.push(o);
});
// Apply the same trim jobs.ts applies, then render what the user would see.
const CAP = 400;
const trimmed = interleaved.slice(Math.max(0, interleaved.length - CAP));
const capped = render({ lines: trimmed, progress: 99, elapsedMs: 120_000, running: true });

const lost = OUTCOMES.filter((o) => !capped.includes(esc(o)));
if (lost.length) {
  fail(
    `${lost.length} of ${OUTCOMES.length} category outcomes were evicted by per-URL chatter ` +
    `(e.g. ${JSON.stringify(lost[0])}). The 400-line cap must preserve outcome lines.`,
  );
}

console.log(
  `PROOF PASS: heartbeat moves without faking progress, stops when done; ` +
  `running total shown (including 0); all ${OUTCOMES.length} outcomes survive a ${interleaved.length}-line run`,
);

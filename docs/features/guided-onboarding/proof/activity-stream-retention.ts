/**
 * Regression proof: every extraction step stays visible in the chat.
 *
 * The onboarding activity feed used to render only a trailing window of the
 * job's log, so earlier steps ("Reading how everything connects", "Connected
 * 10 things across 6 relationships", ...) silently fell out of the bubble as
 * later ones arrived. Each step must REMAIN above the newest one.
 *
 * Renders the real component to static markup and asserts the whole log is
 * present, in order — no windowing, nothing dropped. Uses createElement
 * directly so the proof runs under plain tsx without a JSX runtime.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityStream } from "../../../../app/admin/onboarding/ActivityStream";

const LOG = [
  "Reading how everything connects — people, services and places",
  "Connected 10 things across 6 relationships",
  "Working out what your agent should be steering visitors toward",
  "Set 3 goals for your agent, editable under Agent Behavior",
  "Filing everything into your agent's memory",
  "Indexing the last of the pages",
  "Almost there",
];

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exit(1);
}

const render = (lines: string[], progress: number) =>
  renderToStaticMarkup(createElement(ActivityStream, { lines, progress }));

/** React escapes text nodes; compare against what actually lands in the DOM. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
   .replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const html = render(LOG, 80);

// The newest line types in character by character, so on a static render it
// is an empty row; every step BEFORE it is finished and must be shown in full.
const settled = LOG.slice(0, -1);

// Every finished step must survive to the output, not just the recent ones.
for (const line of settled) {
  if (!html.includes(esc(line))) fail(`step dropped from the feed: ${JSON.stringify(line)}`);
}

// ...and in the order the job emitted them.
let cursor = -1;
for (const line of settled) {
  const at = html.indexOf(esc(line));
  if (at <= cursor) fail(`steps out of order at ${JSON.stringify(line)}`);
  cursor = at;
}

// The newest line still gets its own row (it fills in as it types).
const rows = (html.match(/<div style="opacity:/g) ?? []).length;
if (rows !== LOG.length) {
  fail(`expected ${LOG.length} step rows, rendered ${rows}`);
}

// A long run must not start windowing either.
const long = Array.from({ length: 40 }, (_, i) => `step number ${i + 1}`);
const longHtml = render(long, 99);
const missing = long.slice(0, -1).filter((l) => !longHtml.includes(`>${esc(l)}<`));
if (missing.length) {
  fail(`${missing.length} of ${long.length} steps dropped on a long run (e.g. ${missing[0]})`);
}

console.log(`PROOF PASS: all ${LOG.length} steps retained in order; 40-step run kept every line`);

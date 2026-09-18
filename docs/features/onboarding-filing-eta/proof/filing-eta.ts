/**
 * Proof: the memory-filing step announces an estimate and counts it down.
 *
 *   npx tsx docs/features/onboarding-filing-eta/proof/filing-eta.ts
 *
 * No server needed: estimate math and the wire ETA are pure, the log wording
 * is a pure helper, and the countdown is mounted in jsdom with a fake clock.
 */
import Module from "node:module";

// next/font/google only works under Next's compiler; lib/fonts.ts (reached
// through jobs.ts) calls it at load, so stub it the way chat-transcript.ts does.
const fontStub = new Proxy({}, {
  get: (_t, name) => () => ({ className: `font-${String(name)}`, style: { fontFamily: String(name) }, variable: `--f-${String(name)}` }),
});
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = (Module as unknown as Loader)._load;
(Module as unknown as Loader)._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/font/google") return fontStub;
  return realLoad.call(this, request, ...rest);
};

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // Loaded after the stub is installed: static imports would hoist above it.
  const { filingSeconds, CALL_MS, TAIL_CALLS } = await import("../../../../lib/onboarding/graphIndex");
  const { etaFor, describeDuration } = await import("../../../../lib/onboarding/jobs");
  const { ActivityStream, formatRemaining, remainingNow } =
    await import("../../../../app/admin/onboarding/ActivityStream");

// ── Estimate math ──
const pace = 21_000;
const base = filingSeconds({ origins: 2, sources: 5, clusters: 2 }, pace);
const expected = Math.ceil(((1 + 4) * pace + (2 + 5 + 2 + TAIL_CALLS) * CALL_MS) / 10_000) * 10;
check("estimate follows the pacing formula", base === expected, `${base} vs ${expected}`);
check("one more source adds a pause and a call",
  filingSeconds({ origins: 2, sources: 6, clusters: 2 }, pace) > base);
check("one more origin adds a pause and a call",
  filingSeconds({ origins: 3, sources: 5, clusters: 2 }, pace) > base);
check("a cluster adds an unpaced call only",
  filingSeconds({ origins: 2, sources: 5, clusters: 3 }, pace) - base < pace / 1000);
check("nothing to file still costs the tail stages",
  filingSeconds({ origins: 0, sources: 0, clusters: 0 }, pace) >= TAIL_CALLS * CALL_MS / 1000);
check("estimate is a whole ten seconds", base % 10 === 0);

// ── Wire ETA ──
const filing = { startedAt: 1_000_000, seconds: 240 };
check("remaining counts down from the start time",
  etaFor(filing, "sweep", 1_000_000 + 65_000)?.remainingSeconds === 175);
check("remaining floors at zero",
  etaFor(filing, "sweep", 1_000_000 + 999_000)?.remainingSeconds === 0);
check("no ETA before filing begins", etaFor(undefined, "sweep") === undefined);
check("no ETA once done", etaFor(filing, "done", 1_000_000) === undefined);
check("no ETA once failed", etaFor(filing, "failed", 1_000_000) === undefined);

// ── Log wording ──
check("minutes and seconds in words", describeDuration(250) === "4 minutes 10 seconds");
check("singular minute", describeDuration(60) === "1 minute");
check("seconds only", describeDuration(40) === "40 seconds");
check("countdown format", formatRemaining(185) === "About 3:05 left");
check("past the estimate says so", formatRemaining(0).startsWith("Taking a little longer"));

// ── Static render ──
const lines = ["Filing everything into your agent's memory — about 4 minutes to go"];
const withEta = renderToStaticMarkup(createElement(ActivityStream, {
  lines, progress: 90, eta: { remainingSeconds: 185, receivedAt: Date.now() },
}));
check("countdown rendered with an ETA", withEta.includes("About 3:05 left"), withEta);
const without = renderToStaticMarkup(createElement(ActivityStream, { lines, progress: 90 }));
check("no countdown without an ETA", !without.includes("data-countdown"));

// ── Live countdown under a fake clock ──
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window; g.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  g.HTMLElement = dom.window.HTMLElement; g.Element = dom.window.Element; g.Node = dom.window.Node;
  g.IS_REACT_ACT_ENVIRONMENT = true; // act() outside a test runner warns otherwise

  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
    realSetInterval(fn, Math.min(ms ?? 0, 20), ...args)) as typeof setInterval;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const eta = { remainingSeconds: 125, receivedAt: clock };
  await act(async () => { root.render(createElement(ActivityStream, { lines, progress: 90, eta })); });
  const shown = () => container.querySelector("[data-countdown]")?.textContent ?? "";
  check("mounted countdown shows the polled figure", shown() === "About 2:05 left", shown());

  clock += 30_000;
  await act(async () => { await sleep(60); });
  check("countdown falls with the clock", shown() === "About 1:35 left", shown());
  check("remainingNow agrees", remainingNow(eta, clock) === 95);

  clock += 200_000;
  await act(async () => { await sleep(60); });
  check("past zero it says it is taking longer, never negative",
    shown().startsWith("Taking a little longer"), shown());

  await act(async () => { root.unmount(); });
  Date.now = realNow;
  globalThis.setInterval = realSetInterval;
}

main().then(() => {
  if (failures) { console.error(`PROOF FAIL: ${failures} check(s) failed`); process.exit(1); }
  console.log("PROOF PASS: filing step estimates its duration and counts it down");
}).catch((e) => { console.error("PROOF FAIL:", e); process.exit(1); });

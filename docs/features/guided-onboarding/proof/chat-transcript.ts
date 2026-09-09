/**
 * Regression proof: the onboarding chat is a transcript, not a slideshow.
 *
 * Every assistant message and every answer the user gave must stay on the
 * page as the flow advances — the next step appends below, it never replaces
 * what came before. Each review form collapses into a short user-side message
 * once it is saved, and each running stage's bubble shows only the activity
 * lines that arrived during that stage.
 *
 *   npx tsx docs/features/guided-onboarding/proof/chat-transcript.ts
 *
 * Mounts the REAL OnboardingFlow in a jsdom document and drives it the way a
 * user would: types a URL, clicks Done through every review, and waits on the
 * real poller. The onboarding API is a scripted fetch double (the only doubled
 * boundary), next/font/google is stubbed because it only loads inside Next's
 * compiler, and the app-router context is provided so useRouter mounts.
 */
import Module from "node:module";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── next/font/google only works under Next's compiler; lib/fonts.ts calls it at load ──
const fontStub = new Proxy({}, {
  get: (_t, name) => () => ({
    className: `font-${String(name)}`, style: { fontFamily: String(name) }, variable: `--f-${String(name)}`,
  }),
});
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = (Module as unknown as Loader)._load;
(Module as unknown as Loader)._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/font/google") return fontStub;
  return realLoad.call(this, request, ...rest);
};

// ── Time: typewriters finish on their first tick, the poller ticks fast ──
const realNow = Date.now;
let clock = realNow();
Date.now = () => (clock += 10_000);
const realSetInterval = globalThis.setInterval;
globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  realSetInterval(fn, Math.min(ms ?? 0, 25), ...args)) as typeof setInterval;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── The scripted onboarding API ──
const CORE_LINES = ["Found 2 contact/about pages to check", "Company name: Moonlight Nails Spa"];
const LOC_LINES = ["Looking for location and hours pages", "Location 1: 12 Sea Road, Brighton — hours found"];
const SOCIAL_LINES = ["Looking for your social media profiles", "No social media profiles linked on your site"];
const IMAGE_LINES = ["Looking for photos to build your gallery"];
const THEME_LINES = ["Reading your site's CSS for colors, fonts, and corners", "Body font matched: work-sans; corners: sharp"];
const KNOWLEDGE_LINES = ["Model extraction is on — each category reads your pages with its own prompt", "Saved 12 knowledge chunks"];

type Job = Record<string, unknown> & { phase: string; progress: number; log: string[] };
let job: Job = { phase: "core", progress: 0, log: [] };
const calls: string[] = [];

function advanceTo(stage: string) {
  if (stage === "locations") {
    job.log.push(...LOC_LINES);
    job.stepLoc = { locations: [{ address: "12 Sea Road, Brighton", phone: "", hours: { monday: "9 AM – 5 PM" } }] };
    job.phase = "locations-done";
  } else if (stage === "social") {
    job.log.push(...SOCIAL_LINES);
    job.stepSocial = { links: [] };
    job.phase = "social-done";
  } else if (stage === "images") {
    job.log.push(...IMAGE_LINES);
    job.stepImages = { images: [] }; // nothing to review → straight on to the theme
    job.phase = "images-done";
  } else if (stage === "theme") {
    job.log.push(...THEME_LINES);
    job.step2 = { themeBodyFont: "work-sans", themeRadius: "sharp", themeFontSize: "16", themeHeadingWeight: "700", themeColors: {}, themeLogo: "" };
    job.stepBrand = { tagline: "Nails that glow", taglineSource: "extracted", values: ["Local first"], tone: "" };
    job.phase = "theme-done";
  } else if (stage === "knowledge") {
    job.log.push(...KNOWLEDGE_LINES);
    job.phase = "sweep";
    job.progress = 40;
  }
}

globalThis.fetch = (async (input: string | URL, init?: { body?: string }) => {
  const url = String(input);
  const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push(url.replace(/\?.*$/, ""));
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/onboarding/start")) {
    job = { phase: "core-done", progress: 100, log: [...CORE_LINES],
      step1: { company_name: "Moonlight Nails Spa", owner_name: "Blake", company_phone_number: "01273 000000", company_email: "hi@moonlight.example" } };
    if (String(body.url).includes("fail.example")) job = { phase: "failed", progress: 0, log: [], error: "Could not load that site. Check the URL and try again." };
    return json({ jobId: "job-1" });
  }
  if (url.includes("/onboarding/status")) return json(job);
  if (url.includes("/onboarding/advance")) { advanceTo(String(body.stage)); return json({ ok: true }); }
  return json({ ok: true });
}) as typeof fetch;

async function main() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true, url: "http://localhost/admin/onboarding",
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window; g.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  g.HTMLElement = dom.window.HTMLElement; g.HTMLInputElement = dom.window.HTMLInputElement;
  g.Element = dom.window.Element; g.Node = dom.window.Node; g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent; g.getComputedStyle = dom.window.getComputedStyle;
  g.FormData = dom.window.FormData; // the theme form is read back with new FormData(form)
  // jsdom has no layout; the flow scrolls the newest message into view.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};

  const React = (await import("react")).default;
  (g as { React?: unknown }).React = React; // tsx compiles the app's JSX with the classic runtime
  const { createRoot } = await import("react-dom/client");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const { OnboardingFlow } = await import("../../../../app/admin/onboarding/OnboardingFlow");

  const pushed: string[] = [];
  const router = { push: (h: string) => pushed.push(h), replace: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => Promise.resolve() };

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const text = () => container.textContent ?? "";
  const bubbles = (who: string) =>
    Array.from(container.querySelectorAll(`[data-who="${who}"]`)).map((b) => b.textContent ?? "");
  const bubbleWith = (phrase: string) =>
    Array.from(container.querySelectorAll('[data-who="assistant"]')).find((b) => (b.textContent ?? "").includes(phrase));
  async function waitFor(label: string, pred: () => boolean, ms = 8000) {
    const until = realNow() + ms;
    while (realNow() < until) { if (pred()) return true; await sleep(20); }
    check(`waited for: ${label}`, false, text().slice(-300));
    return false;
  }
  const button = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(label));
  async function click(label: string) {
    const b = button(label);
    check(`button present: ${label}`, !!b, Array.from(container.querySelectorAll("button")).map((x) => x.textContent).join(" | "));
    b?.click();
    await sleep(30);
  }
  const setInput = (el: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  };
  const inOrder = (phrases: string[]) => {
    const t = text();
    let cursor = -1;
    for (const p of phrases) {
      const at = t.indexOf(p);
      if (at <= cursor) return `"${p}" ${at === -1 ? "missing" : "out of order"}`;
      cursor = at;
    }
    return "";
  };

  try {
    root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(OnboardingFlow)));

    // ── 1. Greeting, then the URL card ──
    await waitFor("URL card after the greeting", () => text().includes("Add your website"));
    const urlInput = container.querySelector("input[placeholder*='your-current-site']") as HTMLInputElement;
    check("url input present", !!urlInput);
    setInput(urlInput, "https://moonlightnails.example");
    await sleep(30);
    await click("Extract my site");

    // ── 2. Core extraction ran, then the contact review appears ──
    await waitFor("contact review", () => text().includes("Here's what I found"));
    check("the URL is echoed as the user's message", bubbles("user").some((b) => b.includes("moonlightnails.example")), bubbles("user").join(" | "));
    check("core-running bubble is on the page", text().includes("On it — extracting your contact info now."));
    check("core activity lines are on the page", CORE_LINES.every((l) => text().includes(l)));
    await waitFor("contact form", () => Array.from(container.querySelectorAll("input")).some((i) => (i as HTMLInputElement).value === "Moonlight Nails Spa"));

    // ── 3. Saving the contact form must APPEND the next step, not replace this one ──
    await click("Done — looks right");
    await waitFor("locations review", () => text().includes("Here are the locations and hours I found"));
    check("previous assistant message still on the page after advancing", text().includes("Here's what I found"), text().slice(0, 400));
    check("earlier running bubble still on the page", text().includes("On it — extracting your contact info now."));
    check("locations-running bubble appended", text().includes("Now — where can customers find you?"));
    check("saved contact details collapsed into a user message",
      bubbles("user").some((b) => b.includes("Moonlight Nails Spa")), bubbles("user").join(" | "));
    check("contact form is no longer editable",
      !Array.from(container.querySelectorAll("input")).some((i) => (i as HTMLInputElement).value === "Moonlight Nails Spa"));
    const coreBubble = bubbleWith("On it — extracting");
    const locBubble = bubbleWith("Now — where can customers find you?");
    check("core bubble shows only the core stage's lines",
      !!coreBubble && CORE_LINES.every((l) => coreBubble.textContent!.includes(l)) && !LOC_LINES.some((l) => coreBubble.textContent!.includes(l)),
      coreBubble?.textContent ?? "(no core bubble)");
    check("locations bubble shows only the locations stage's lines",
      !!locBubble && LOC_LINES.every((l) => locBubble.textContent!.includes(l)) && !CORE_LINES.some((l) => locBubble.textContent!.includes(l)),
      locBubble?.textContent ?? "(no locations bubble)");

    // ── 4. Locations → social ──
    await waitFor("locations form", () => !!button("Done — locations are right"));
    await click("Done — locations are right");
    await waitFor("social review", () => text().includes("I found no social media links"));
    check("locations review still on the page", text().includes("Here are the locations and hours I found"));
    check("saved locations collapsed into a user message", bubbles("user").some((b) => b.includes("12 Sea Road")), bubbles("user").join(" | "));

    // ── 5. Social → images (none, skipped) → theme ──
    await waitFor("social form", () => !!button("No social media — continue"));
    await click("No social media — continue");
    await waitFor("theme review", () => text().includes("Here's the look and brand voice"));
    check("images-running bubble kept", text().includes("Saved. Now let me gather photos"));
    check("theme-running bubble kept", text().includes("Saved. I'll now extract your theme"));
    check("no social media collapsed into a user message", bubbles("user").some((b) => /no social/i.test(b)), bubbles("user").join(" | "));

    // ── 6. Theme → knowledge selection ──
    await waitFor("theme form", () => !!button("Done — use this theme"));
    await click("Done — use this theme");
    await waitFor("knowledge selection", () => text().includes("Last step: which of these"));
    check("theme review still on the page", text().includes("Here's the look and brand voice"));
    check("saved theme collapsed into a user message naming the choices",
      bubbles("user").some((b) => b.includes("sharp") && b.includes("Nails that glow")), bubbles("user").join(" | "));

    // ── 7. Knowledge extraction runs, then finishes ──
    await waitFor("extract button", () => !!button("Start extraction"));
    await click("Start extraction");
    await waitFor("knowledge running", () => text().includes("Extracting now."));
    check("picked categories collapsed into a user message", bubbles("user").some((b) => b.includes("Blog / news posts")), bubbles("user").join(" | "));
    job.phase = "done"; job.progress = 100; job.chunkCount = 12; job.log.push("All done");
    await waitFor("all done", () => text().includes("All done — I saved"));
    const order = inOrder([
      "Hi! I'll set up your agent page",
      "moonlightnails.example",
      "On it — extracting your contact info now.",
      "Here's what I found",
      "Now — where can customers find you?",
      "Here are the locations and hours I found",
      "Saved. Now I'm checking your site for your social media profiles.",
      "I found no social media links",
      "Saved. Now let me gather photos",
      "Saved. I'll now extract your theme",
      "Here's the look and brand voice",
      "Last step: which of these",
      "All done — I saved",
    ]);
    check("the whole conversation is on the page, in order", order === "", order);
    const allLines = [...CORE_LINES, ...LOC_LINES, ...SOCIAL_LINES, ...IMAGE_LINES, ...THEME_LINES, ...KNOWLEDGE_LINES];
    check("every stage's activity lines survive, including the finished run's",
      allLines.every((l) => text().includes(l)), `missing: ${allLines.filter((l) => !text().includes(l)).join(" | ")}`);
    check("one user message per answer", bubbles("user").length >= 6, `${bubbles("user").length}`);
    check("complete was posted for the site path", calls.some((c) => c.endsWith("/onboarding/complete")));
    root.unmount();

    // ── 8. A failed extraction offers a retry that brings the URL card back ──
    const root2 = createRoot(container);
    root2.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(OnboardingFlow)));
    await waitFor("URL card (retry run)", () => text().includes("Add your website"));
    setInput(container.querySelector("input[placeholder*='your-current-site']") as HTMLInputElement, "https://fail.example");
    await sleep(30);
    await click("Extract my site");
    await waitFor("failure message", () => text().includes("Could not load that site"));
    await click("Try another URL or set up manually");
    await waitFor("URL card back after retry", () => text().includes("Add your website"));
    check("failure message cleared on retry", !text().includes("Could not load that site"));
    root2.unmount();
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realSetInterval;
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll green");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("Proof run errored:", e); process.exit(1); });

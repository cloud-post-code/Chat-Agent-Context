/**
 * Regression proof: the onboarding chat is a transcript, not a slideshow.
 *
 * Every assistant message and every answer the user gave must stay on the
 * page as the flow advances — the next step appends below, it never replaces
 * what came before. Each review form collapses into a short user-side message
 * once it is saved, and each running stage's bubble shows only the activity
 * lines that arrived during that stage. The booking-form step (second to
 * last) is driven too: its steps, the preview card, and one chat change.
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
const BOOKING_LINES = ["Reading your services and how you take bookings", "Booking is on — built your form with 2 questions"];
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
  } else if (stage === "booking") {
    job.log.push(...BOOKING_LINES);
    job.stepBooking = { report: { services: 3, seededFields: 2, takesAppointments: true }, chunks: 3 };
    job.phase = "booking-done";
  } else if (stage === "knowledge") {
    job.log.push(...KNOWLEDGE_LINES);
    job.phase = "sweep";
    job.progress = 40;
  }
}

// ── The booking form the step reads and re-reads: one service, the contact
// details on one screen (the migrated form of an existing tenant), then the
// question the scripted "model" adds when asked. Built with the real step
// describer so the step list is what the app would show. ──
type FormShape = { slug: string; enabled: boolean; flow: unknown; fields: unknown[]; empty: boolean; steps: unknown[] };
let formNow: FormShape | null = null;
let formAfterChange: FormShape | null = null;
async function buildForms() {
  const T = await import("../../../../lib/booking/types");
  const S = await import("../../../../lib/booking/steps");
  const settings = T.sanitizeBookingSettings({}) as unknown as Record<string, unknown>;
  delete settings.promoCodes;
  const rules = { ...settings, hasPromoCodes: false };
  const flow = {
    business: { name: "Moonlight Nails Spa", timezone: "Europe/London", currency: "GBP", phone: "01273 000000" },
    services: [{
      id: "svc-gel", name: "Gel Manicure", category: "Manicures", description: "", imageUrl: null, images: [],
      pricing: { kind: "fixed", amount: 35 }, durationMinutes: 45, addons: [], variants: [], deposit: { kind: "none" },
      modes: [], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
      bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true,
    }],
    categories: ["Manicures"], staff: [], locations: [], rules, preselect: { serviceId: null },
  } as unknown as import("../../../../lib/booking/types").BookingFlow;
  type Row = import("../../../../lib/appointmentTypes").AppointmentFieldRow;
  const row = (key: string, label: string, type: Row["type"], required: boolean, role: Row["role"], screen: number, config: Row["config"] = {}): Row =>
    ({ key, label, type, required, order: 0, config, role, screen });
  const contact: Row[] = [
    row("first_name", "First name", "short_text", true, "first_name", 1),
    row("last_name", "Last name", "short_text", true, "last_name", 1),
    row("email", "Email", "email", true, "email", 1),
    row("phone", "Phone", "phone", true, "phone", 1),
  ];
  const guests = row("how_many_guests", "How many guests?", "number", true, "none", 2, { min: 1, max: 8 });
  formNow = { slug: "moonlight", enabled: true, flow, fields: contact, empty: false, steps: S.describeBookingSteps(flow, contact) };
  formAfterChange = { slug: "moonlight", enabled: true, flow, fields: [...contact, guests], empty: false, steps: S.describeBookingSteps(flow, [...contact, guests]) };
}

globalThis.fetch = (async (input: string | URL, init?: { method?: string; body?: string }) => {
  const url = String(input);
  const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  calls.push(url.replace(/\?.*$/, ""));
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/onboarding/booking-form")) {
    if (init?.method === "POST" && body.message) {
      calls.push(`form-chat:${String(body.message)}:${Array.isArray(body.history) ? body.history.length : -1}`);
      formNow = formAfterChange;
      return json({ ok: true, reply: "Added a guest count, required, 1 to 8.", changes: ["Added the question “How many guests?”"], form: formNow });
    }
    return json({ ok: true, form: formNow });
  }
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
  await buildForms();

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
  const setTextarea = (el: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
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

    // ── 6. Theme → the booking form (second to last) ──
    await waitFor("theme form", () => !!button("Done — use this theme"));
    await click("Done — use this theme");
    await waitFor("booking form review", () => text().includes("I built your booking form from your site — 3 services and 2 questions"));
    check("booking-running bubble appended", text().includes("Saved. Now your booking form"));
    check("theme review still on the page", text().includes("Here's the look and brand voice"));
    check("saved theme collapsed into a user message naming the choices",
      bubbles("user").some((b) => b.includes("sharp") && b.includes("Nails that glow")), bubbles("user").join(" | "));
    await waitFor("the form's steps", () => text().includes("Pick a service") && text().includes("Review and confirm"));
    const stepOrder = inOrder(["Pick a service", "Date and time", "First name*, Last name*, Email*, Phone*", "Review and confirm"]);
    check("the steps are listed in the order a customer meets them, the contact screen titled by its labels", stepOrder === "", stepOrder);
    check("the contact screen's fields are listed under it, one line each",
      text().includes("First name* · short answer · required") && text().includes("Phone* · phone number · required"), text().slice(-600));
    check("no question step yet", !text().includes("How many guests?"));

    // Try it: the real card, in preview.
    await click("Try the form");
    // The preview is the same conversation of cards a visitor gets (booking-in-chat):
    // the first step's intro, typed in, with its card under it — no step counter.
    await waitFor("the preview card", () => text().includes("Preview — nothing gets booked.") && text().includes("Which service would you like?"));
    check("the preview opens on the first ask with the service on file", text().includes("Gel Manicure"));
    check("the preview is a conversation, not a wizard — no step counter", !text().includes("Step 1 of"));

    // Say what's missing: the change is applied and the form shown again.
    const ask = container.querySelector("textarea[placeholder*='how many guests']") as HTMLTextAreaElement;
    check("form chat input present", !!ask);
    setTextarea(ask, "Ask how many guests are coming.");
    await sleep(30);
    await click("Change the form");
    await waitFor("the reply", () => text().includes("Added a guest count, required, 1 to 8."));
    check("the request is echoed in the step's chat", text().includes("Ask how many guests are coming."));
    check("the change is listed", text().includes("Added the question “How many guests?”"));
    check("the form is shown again with the new step, marked new",
      text().includes("How many guests?") && text().includes("a number from 1 to 8 · required") && /How many guests\?\s*new/.test(text()), text().slice(-600));
    check("the chat round carried no earlier history", calls.some((c) => c === "form-chat:Ask how many guests are coming.:0"), calls.filter((c) => c.startsWith("form-chat")).join(" | "));
    check("the preview card was remounted on the new form", text().includes("Preview — nothing gets booked."));

    // ── 6b. Booking form → knowledge selection (the last step) ──
    await click("Done — the form is right");
    await waitFor("knowledge selection", () => text().includes("Last step: which of these"));
    check("booking review still on the page", text().includes("I built your booking form from your site"));
    check("the booking form collapsed into a user message with its step count and changes",
      bubbles("user").some((b) => /Booking form: 5 steps, 1 change made\./.test(b)), bubbles("user").join(" | "));
    check("services are not offered again on the knowledge pick", !text().includes("Services & how you take bookings"));

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
      "Saved. Now your booking form",
      "I built your booking form from your site",
      "Last step: which of these",
      "All done — I saved",
    ]);
    check("the whole conversation is on the page, in order", order === "", order);
    const allLines = [...CORE_LINES, ...LOC_LINES, ...SOCIAL_LINES, ...IMAGE_LINES, ...THEME_LINES, ...BOOKING_LINES, ...KNOWLEDGE_LINES];
    check("every stage's activity lines survive, including the finished run's",
      allLines.every((l) => text().includes(l)), `missing: ${allLines.filter((l) => !text().includes(l)).join(" | ")}`);
    check("one user message per answer", bubbles("user").length >= 7, `${bubbles("user").length}`);
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

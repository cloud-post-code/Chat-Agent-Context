/**
 * Proof: booking as a conversation of cards — the visitor chat lays a booking
 * out one card at a time, down the thread, and every finished card stays.
 *
 *   npx tsx --tsconfig docs/features/booking-in-chat/tsconfig.proof.json docs/features/booking-in-chat/proof/chat-thread.ts
 *
 * Mounts the REAL visitor Chat (app/Chat.tsx) in a jsdom document and books
 * the way a visitor would: asks to book, taps a service, a provider, a day
 * and a slot, fills the business's own "How do we say hello?" screen,
 * changes their mind about the service on the card that is still on the
 * page, asks a question mid-booking, confirms, then reloads. The network is
 * one scripted fetch double keyed by URL (the model's NDJSON reply, the flow,
 * availability, the quote, the booking) — every request body is recorded so
 * the proof can read what the app sent. Nothing touches the database.
 * next/font/google is stubbed because it only loads under Next's compiler.
 *
 * Assertions are docs/features/booking-in-chat/PROOF.md section B, numbered
 * the same way. Prints PASS/FAIL lines and exits 1 on any failure.
 */
import Module from "node:module";
import * as T from "../../../../lib/booking/types";
import { priceBreakdown } from "../../../../lib/booking/pricing";
import type { BookingFlow, ServiceRow, StaffRow } from "../../../../lib/booking/types";
import type { BookingField } from "../../../../app/cards/BookingQuestion";

process.env.TZ = "UTC";

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? ` — ${detail.slice(0, 400)}` : ""}`);
}

// ── next/font/google only works under Next's compiler ──
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

// ── Time: the intros' typewriters finish on their first tick; timers tick fast.
// `new Date()` is untouched, so the calendar's "today" stays the real day. ──
const realNow = Date.now;
let clock = realNow();
const fastNow = () => (clock += 10_000);
Date.now = fastNow;
const realSetInterval = globalThis.setInterval;
const realSetTimeout = globalThis.setTimeout;
globalThis.setInterval = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  realSetInterval(fn, Math.min(ms ?? 0, 25), ...args)) as typeof setInterval;
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  realSetTimeout(fn, Math.min(ms ?? 0, 25), ...args)) as typeof setTimeout;
const sleep = (ms: number) => new Promise((r) => realSetTimeout(r, ms));

// ── The fixture: Moonlight Nails Spa. Two services (one with variants), one
// provider, no locations, the business's own step order with a titled
// contact screen. Built with the real sanitizers, the proof.sections idiom. ──
const SLUG = "moonlight";
const BUSINESS = "Moonlight Nails Spa";
const GEL = "svc-gel";
const CUT = "svc-long-cut";
const KATHERINE = "katherine";
const HOURS = { start: "09:00", end: "17:00" };

const settings = T.sanitizeBookingSettings({
  timezone: "UTC",
  currency: "USD",
  hours: { mon: [HOURS], tue: [HOURS], wed: [HOURS], thu: [HOURS], fri: [HOURS], sat: [HOURS], sun: [] },
  staffSelection: "optional",
  flow: [
    { kind: "service" },
    { kind: "provider" },
    { kind: "time" },
    { kind: "questions", screen: 1, title: "How do we say hello?" },
    { kind: "review" },
  ],
});

const svc = (over: Partial<ServiceRow> & { id: string; name: string }): ServiceRow => ({
  category: "", description: "", imageUrl: null, images: [],
  pricing: { kind: "fixed", amount: 35 }, durationMinutes: 45, addons: [], variants: [], deposit: { kind: "none" },
  modes: [], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true,
  ...over,
});
const services: ServiceRow[] = [
  svc({ id: GEL, name: "Gel Manicure", pricing: { kind: "fixed", amount: 35 }, durationMinutes: 45 }),
  svc({
    id: CUT, name: "Long Hair Cut", pricing: { kind: "fixed", amount: 45 }, durationMinutes: 60, order: 1,
    variants: [
      { id: "shoulder", name: "Shoulder length", pricing: { kind: "fixed", amount: 45 } },
      { id: "waist", name: "Past the shoulders", pricing: { kind: "fixed", amount: 60 } },
    ],
  }),
];
const katherine: StaffRow = {
  id: KATHERINE, name: "Katherine", role: "Nail artist", bio: "", photoUrl: null, specialties: [], languages: [], credentials: [],
  genderLabel: "", hours: null, timeOff: [], priceOverrides: {}, durationOverrides: {}, order: 0, enabled: true,
};
const flow: BookingFlow = {
  business: { name: BUSINESS, timezone: settings.timezone, currency: "USD", phone: "" },
  services,
  categories: [],
  staff: [katherine],
  locations: [],
  rules: T.publicRules(settings),
  preselect: { serviceId: null },
};
const fields: BookingField[] = [
  { key: "first_name", label: "First name", type: "short_text", required: true, config: {}, role: "first_name", screen: 1 },
  { key: "phone", label: "Phone", type: "phone", required: true, config: {}, role: "phone", screen: 1 },
  { key: "email", label: "Email", type: "email", required: false, config: {}, role: "email", screen: 1 },
];

/** The intros the contract fixes (lib/booking/session.ts `intro`). */
const ASK = {
  service: "Which service would you like?",
  options: "Any options or add-ons?",
  provider: "Who would you like to see?",
  time: "When works for you?",
  screen: "How do we say hello?",
  review: "Here's your booking — check it over.",
  confirmed: "You're booked — the details are below.",
  inProgress: "Your booking is in progress above",
};
const MODEL_OPENER = "Sure — let's book you in.";
const MODEL_GEL = "Yes — gel is our specialty.";
const MODEL_SERVICES = "Here's what we offer.";
const MODEL_AGAIN = "Let's start a booking.";
const QUESTION_1 = "Can I book something?";
const QUESTION_2 = "do you do gel?";
const QUESTION_3 = "What do you offer?";
const QUESTION_4 = "book again please";

const bookingBlock = () => ({ type: "booking", fields, flow });
const servicesBlock = () => ({
  type: "services",
  items: services.map((s) => ({
    id: s.id, name: s.name, description: "", imageUrl: null,
    priceLabel: T.pricingLabel(s.pricing, "USD"), duration: T.formatDuration(s.durationMinutes),
  })),
  booking: { fields, serviceKey: null, flow },
});

// ── The scripted network ──
type Recorded = { url: string; query: URLSearchParams; method: string; body: Record<string, unknown> | null };
const requests: Recorded[] = [];
type ChatReply = { text: string; cards?: unknown[] };
const chatScript: ChatReply[] = [];

function ndjson(reply: ChatReply): Response {
  const lines = [JSON.stringify({ t: "text", v: reply.text }), ...(reply.cards ?? []).map((c) => JSON.stringify({ t: "card", v: c }))];
  return new Response(`${lines.join("\n")}\n`, { status: 200, headers: { "content-type": "application/x-ndjson" } });
}
function breakdownFor(body: Record<string, unknown>) {
  const service = services.find((s) => s.id === body.serviceId) ?? null;
  const variant = service?.variants.find((v) => v.id === body.variantId) ?? null;
  return priceBreakdown({
    service, variant, addons: [], quantity: 1, staff: body.staffId === KATHERINE ? katherine : null, location: null,
    mode: "in_person", settings, promo: null, membership: null, tipPercent: null, tipAmount: null,
  });
}
const slotsFor = (date: string) => [
  { startsAt: `${date}T10:00:00.000Z`, endsAt: `${date}T10:45:00.000Z`, staffIds: [KATHERINE] },
  { startsAt: `${date}T11:00:00.000Z`, endsAt: `${date}T11:45:00.000Z`, staffIds: [KATHERINE] },
];

globalThis.fetch = (async (input: string | URL | Request, init?: { method?: string; body?: unknown }) => {
  const url = String(input instanceof Request ? input.url : input);
  const [pathname, qs = ""] = url.split("?");
  const method = init?.method ?? "GET";
  let body: Record<string, unknown> | null = null;
  try {
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const query = new URLSearchParams(qs);
  requests.push({ url: pathname, query, method, body });
  const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { "content-type": "application/json" } });

  if (pathname === "/api/chat") return ndjson(chatScript.shift() ?? { text: "Happy to help." });
  if (pathname === "/api/booking/availability") {
    const date = query.get("date");
    if (date) return json({ ok: true, timezone: "UTC", slots: slotsFor(date), full: false, earliest: null });
    const month = query.get("month") ?? new Date().toISOString().slice(0, 7);
    const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const days = Array.from({ length: n }, (_, i) => ({ date: `${month}-${String(i + 1).padStart(2, "0")}`, open: true, slots: 2 }));
    return json({ ok: true, timezone: "UTC", days, earliest: null });
  }
  if (pathname === "/api/booking/quote") return json({ ok: true, breakdown: breakdownFor(body ?? {}) });
  if (pathname === "/api/booking" && method === "POST") {
    const startsAt = String(body?.startsAt ?? new Date().toISOString());
    const service = services.find((s) => s.id === body?.serviceId) ?? null;
    return json({
      ok: true, id: "b1", status: "confirmed", startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + (service?.durationMinutes ?? 45) * 60000).toISOString(),
      breakdown: breakdownFor(body ?? {}), staffName: "Katherine", locationName: "", serviceName: service?.name ?? "", ids: ["b1"],
    });
  }
  if (pathname === "/api/booking") return json({ ok: true, enabled: true, fields, flow });
  return json({ ok: true });
}) as typeof fetch;

async function main() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true, url: `http://localhost/a/${SLUG}`,
  });
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window; g.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
  g.HTMLElement = dom.window.HTMLElement; g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement; g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.Element = dom.window.Element; g.Node = dom.window.Node; g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent; g.KeyboardEvent = dom.window.KeyboardEvent; g.getComputedStyle = dom.window.getComputedStyle;
  g.FormData = dom.window.FormData;
  // jsdom has no layout: the thread scrolls to its newest message on every change.
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLElement.prototype.scrollTo = () => {};
  dom.window.scrollTo = () => {};
  g.requestAnimationFrame = (cb: (t: number) => void) => realSetTimeout(() => cb(realNow()), 0);
  g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
  // The visitor's localStorage: jsdom's in-memory Storage on window.
  const ls = dom.window.localStorage;
  const lsKeys = () => Array.from({ length: ls.length }, (_, i) => ls.key(i) ?? "");

  const React = (await import("react")).default;
  (g as { React?: unknown }).React = React;
  const { createRoot } = await import("react-dom/client");
  const Chat = (await import("../../../../app/Chat")).default;

  const container = dom.window.document.getElementById("root")!;
  const text = () => container.textContent ?? "";
  const count = (phrase: string) => text().split(phrase).length - 1;
  const bubbles = (who: string) =>
    Array.from(container.querySelectorAll(`[data-who="${who}"]`)).map((b) => (b.textContent ?? "").trim());
  const userLine = (re: RegExp) => bubbles("user").find((b) => re.test(b));
  const buttons = () => Array.from(container.querySelectorAll("button"));
  const button = (label: string) => buttons().find((b) => (b.textContent ?? "").includes(label));
  const lastButton = (label: string) => buttons().filter((b) => (b.textContent ?? "").includes(label)).pop();
  const byAria = (label: string) => container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
  const tile = (name: string) => container.querySelector(`[role="button"][aria-label="${name}"]`) as HTMLButtonElement | null;
  const isDisabled = (el: Element | null | undefined) =>
    !!el && ((el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true");
  const composer = () => container.querySelector('input[placeholder*="question"]') as HTMLInputElement | null;
  const firstName = () => container.querySelector("#bf-first_name") as HTMLInputElement | null;
  const dayButtons = () => buttons().filter((b) => /^\d{1,2}$/.test((b.textContent ?? "").trim()) && !b.disabled);
  const slotChip = () => buttons().find((b) => b.hasAttribute("aria-pressed") && /10:00/.test(b.textContent ?? ""));

  async function waitFor(label: string, pred: () => boolean, ms = 8000) {
    // Once something has failed, the rest of the run is a cascade: wait less.
    const until = realNow() + (failures ? Math.min(ms, 1500) : ms);
    while (realNow() < until) {
      if (pred()) return true;
      await sleep(20);
    }
    check(`waited for: ${label}`, false, text().slice(-300));
    return false;
  }
  async function click(label: string) {
    const b = button(label);
    check(`button present: ${label}`, !!b, buttons().map((x) => x.textContent).join(" | "));
    b?.click();
    await sleep(30);
  }
  async function clickLast(label: string) {
    const b = lastButton(label);
    check(`button present (last): ${label}`, !!b, buttons().map((x) => x.textContent).join(" | "));
    b?.click();
    await sleep(30);
  }
  const setInput = (el: HTMLInputElement | null, value: string) => {
    if (!el) return;
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
  const position = (phrase: string) => text().indexOf(phrase);
  const mount = () => {
    const root = createRoot(container);
    root.render(React.createElement(Chat, { name: BUSINESS, tagline: "", starters: [], slug: SLUG }));
    return root;
  };
  async function send(q: string, reply: ChatReply) {
    chatScript.push(reply);
    await waitFor(`composer for: ${q}`, () => !!composer());
    setInput(composer(), q);
    await sleep(30);
    await click("Send");
  }
  /** Open the saved chat after a remount: what Chat restores by itself, else the sidebar. */
  async function openSavedChat(title: string) {
    await sleep(60);
    if (text().includes(MODEL_OPENER)) return;
    await waitFor("the chats toggle", () => !!button("Chats"));
    await click("Chats");
    const item = buttons().find((b) => b.getAttribute("title") === title);
    check(`the sidebar lists the saved chat "${title}"`, !!item, buttons().map((b) => b.getAttribute("title")).filter(Boolean).join(" | "));
    item?.click();
  }

  // The transcript as it should read, top to bottom, checked after every step.
  const transcript: string[] = [];
  const orderHolds = (label: string) => {
    const order = inOrder(transcript);
    check(label, order === "", order);
  };

  let root = mount();
  try {
    // ── 1. Asking to book: the model's text, then the first ask with its card ──
    console.log("B1. show_booking starts a session: the service ask appends below the model's text");
    await waitFor("the home screen's composer", () => !!composer());
    await send(QUESTION_1, { text: MODEL_OPENER, cards: [bookingBlock()] });
    await waitFor("the service ask and its card", () => text().includes(ASK.service) && !!tile("Gel Manicure") && !!tile("Long Hair Cut"));
    transcript.push(QUESTION_1, MODEL_OPENER, ASK.service);
    orderHolds("1. question, the model's text, then the service ask — in that order");
    check("1. the service card (tiles for both services) sits below the model's text",
      !!tile("Gel Manicure") && !!tile("Long Hair Cut") && position("Gel Manicure") > position(MODEL_OPENER));
    check("1. the ask is an assistant line of its own", bubbles("assistant").some((b) => b.startsWith(ASK.service)), bubbles("assistant").join(" | "));
    check("1. no step counter — this is a conversation, not a wizard", !text().includes("Step 1 of"));

    // ── 2. Each finished card says what was picked, and the next ask appends ──
    console.log("B2. each step: card → one user line → the next ask");
    let users = bubbles("user").length;
    tile("Gel Manicure")?.click();
    await sleep(30);
    if (button("Choose Gel Manicure")) await click("Choose Gel Manicure");
    await waitFor("the Picked line", () => !!userLine(/^Picked: Gel Manicure · \$35/));
    check("2. picking a service adds exactly one user line", bubbles("user").length === users + 1, bubbles("user").join(" | "));
    await waitFor("the provider ask and its card", () => text().includes(ASK.provider) && !!byAria("Katherine"));
    transcript.push("Picked: Gel Manicure · $35", ASK.provider);
    orderHolds("2. Picked line, then the provider ask");
    check("2. 'Anyone available' is offered (staff selection optional)", !!byAria("Anyone available"));

    users = bubbles("user").length;
    byAria("Katherine")?.click();
    await sleep(30);
    await clickLast("Next");
    await waitFor("the Provider line", () => !!userLine(/^Provider: Katherine$/));
    check("2. choosing a provider adds exactly one user line", bubbles("user").length === users + 1, bubbles("user").join(" | "));
    await waitFor("the time ask and its calendar", () => text().includes(ASK.time) && dayButtons().length > 0);
    transcript.push("Provider: Katherine", ASK.time);
    orderHolds("2. Provider line, then the time ask");

    users = bubbles("user").length;
    dayButtons()[0]?.click();
    await sleep(30);
    await waitFor("the day's slots", () => !!slotChip());
    slotChip()?.click();
    await sleep(30);
    await clickLast("Next");
    await waitFor("the When line", () => !!userLine(/^When: /));
    const when = userLine(/^When: /) ?? "";
    check("2. the When line carries the slot's hour", /10:00|10 AM/.test(when), when);
    check("2. picking a time adds exactly one user line", bubbles("user").length === users + 1, bubbles("user").join(" | "));
    await waitFor("the business's own screen", () => text().includes(ASK.screen) && !!firstName());
    check("2. the assistant line is exactly the business's screen title",
      bubbles("assistant").some((b) => b === ASK.screen || b.startsWith(ASK.screen)), bubbles("assistant").join(" | "));
    check("2. the screen card shows its fields, required ones starred",
      text().includes("First name *") && text().includes("Phone *") && text().includes("Email") && !text().includes("Email *"));
    transcript.push("When:", ASK.screen);
    orderHolds("2. When line, then the screen ask");

    users = bubbles("user").length;
    setInput(firstName(), "Ada");
    setInput(container.querySelector("#bf-phone") as HTMLInputElement | null, "5551234567");
    setInput(container.querySelector("#bf-email") as HTMLInputElement | null, "ada@example.invalid");
    await sleep(30);
    await clickLast("Next");
    await waitFor("the Details line", () => !!userLine(/^Details: /));
    const details = userLine(/^Details: /) ?? "";
    check("2. the Details line carries name, email and phone (contact-role fields)",
      /^Details: (?=.*\bAda\b)(?=.*ada@example\.invalid)(?=.*5551234567)/.test(details), details);
    check("2. answering the screen adds exactly one user line", bubbles("user").length === users + 1, bubbles("user").join(" | "));
    await waitFor("the review", () => text().includes(ASK.review) && !!button("Confirm booking"));
    transcript.push("Details:", ASK.review);
    orderHolds("2. Details line, then the review ask");
    check("2. the review lists the price breakdown", text().includes("Price breakdown"));

    // ── 3. Nothing above changed ──
    console.log("B3. every earlier ask, card and reply is still on the page, in order");
    orderHolds("3. the whole conversation so far, top to bottom");
    check("3. every earlier card is still mounted (service tiles, provider tile, calendar, contact inputs)",
      !!tile("Gel Manicure") && !!byAria("Katherine") && buttons().some((b) => /^\d{1,2}$/.test((b.textContent ?? "").trim())) && !!firstName());
    check("3. finished cards are editable — their button reads Update", !!button("Update"), buttons().map((b) => b.textContent).join(" | "));
    check("3. one user line per answered step (question + 4 replies)", bubbles("user").length === 5, bubbles("user").join(" | "));
    check("3. the review's Confirm is enabled with every step answered", !isDisabled(button("Confirm booking")));

    // ── 4. Editing an earlier card rewrites its line in place ──
    console.log("B4. changing the service on the card still on the page");
    tile("Long Hair Cut")?.click();
    await sleep(30);
    if (button("Choose Long Hair Cut")) await click("Choose Long Hair Cut");
    await waitFor("the Picked line rewritten", () => !!userLine(/^Picked: Long Hair Cut/));
    check("4. the Picked line changed IN PLACE — still exactly one Picked line",
      bubbles("user").filter((b) => b.startsWith("Picked:")).length === 1 && !userLine(/^Picked: Gel Manicure/), bubbles("user").join(" | "));
    transcript[transcript.indexOf("Picked: Gel Manicure · $35")] = "Picked: Long Hair Cut";
    orderHolds("4. the rewritten line sits where the old one was");
    await waitFor("the options ask", () => text().includes(ASK.options));
    check("4. the newly required options ask appends BELOW the review card", inOrder([ASK.review, ASK.options]) === "", inOrder([ASK.review, ASK.options]));
    check("4. Confirm is disabled until the options are answered", isDisabled(button("Confirm booking")));
    check("4. the review says why", text().includes("One more thing to answer"), text().slice(-400));
    const radio = container.querySelector('input[type="radio"][name="variant"]') as HTMLInputElement | null;
    check("4. the options card offers the variants", !!radio && text().includes("Shoulder length") && text().includes("Past the shoulders"));
    radio?.click();
    await sleep(30);
    await clickLast("Next");
    await waitFor("the Options line", () => !!userLine(/^Options: /));
    const options = userLine(/^Options: /) ?? "";
    check("4. the Options line names the variant", /Shoulder/.test(options), options);
    await waitFor("Confirm enabled again", () => !isDisabled(button("Confirm booking")));
    check("4. the note is gone once answered", !text().includes("One more thing to answer"));
    transcript.push(ASK.options, "Options:");
    orderHolds("4. options ask and its reply come after the review");

    // ── 5. A typed question mid-booking ──
    console.log("B5. a question mid-booking: one folded line for the model, the booking continues");
    await send(QUESTION_2, { text: MODEL_GEL });
    await waitFor("the model's reply", () => text().includes(MODEL_GEL));
    const chatCalls = requests.filter((r) => r.url === "/api/chat" && r.method === "POST");
    const sent = (chatCalls[chatCalls.length - 1]?.body?.messages ?? []) as { role: string; content: string }[];
    const folds = sent.filter((m) => m.role === "user" && m.content.startsWith("Booking so far:"));
    check("5. exactly ONE user line 'Booking so far:' for the session", folds.length === 1, JSON.stringify(sent));
    check("5. it carries the service, the provider and the visitor's name",
      /Long Hair Cut/.test(folds[0]?.content ?? "") && /Katherine/.test(folds[0]?.content ?? "") && /\bAda\b/.test(folds[0]?.content ?? ""), folds[0]?.content);
    check("5. no message with empty content", sent.length > 0 && sent.every((m) => m.content.trim().length > 0), JSON.stringify(sent));
    check("5. no ask or reply line travels on its own",
      !sent.some((m) => /^(Picked|Provider|When|Details|Options):/.test(m.content) || Object.values(ASK).some((a) => m.content === a)), JSON.stringify(sent));
    const foldAt = sent.indexOf(folds[0]);
    check("5. the fold sits after the model's opener and before the new question",
      foldAt > sent.findIndex((m) => m.content === MODEL_OPENER) && foldAt < sent.findIndex((m) => m.content === QUESTION_2), JSON.stringify(sent.map((m) => m.content)));
    check("5. the visitor's own lines still travel", sent.some((m) => m.content === QUESTION_1) && sent[sent.length - 1]?.content === QUESTION_2);
    transcript.push(QUESTION_2, MODEL_GEL);
    orderHolds("5. the question and reply append below the review and options");
    check("5. the booking is still live: Confirm still there and enabled", !isDisabled(button("Confirm booking")));

    // ── 6. Confirm ──
    console.log("B6. Confirm books, says so, and locks the cards");
    await click("Confirm booking");
    await waitFor("the Booked line", () => !!userLine(/^Booked:/));
    const post = requests.find((r) => r.url === "/api/booking" && r.method === "POST");
    const pb = post?.body ?? {};
    check("6. POST /api/booking carries the edited service, its variant, the provider, the slot and the answers",
      pb.serviceId === CUT && pb.variantId === "shoulder" && pb.staffId === KATHERINE && /T10:00:00/.test(String(pb.startsAt ?? "")) &&
        (pb.answers as Record<string, unknown> | undefined)?.first_name === "Ada",
      JSON.stringify(pb));
    check("6. the body has a customer object (the server reads the contact from the answers)", !!pb.customer && typeof pb.customer === "object");
    await waitFor("the confirmation", () => text().includes(ASK.confirmed) && text().includes("You're booked."));
    transcript.push("Booked:", ASK.confirmed, "You're booked.");
    orderHolds("6. Booked line, the assistant's line, then the Confirmed card");
    check("6. the step cards lock — the service tiles are disabled", isDisabled(tile("Gel Manicure")) && isDisabled(tile("Long Hair Cut")));
    check("6. the confirmation names the service and the provider", text().includes("Long Hair Cut") && text().includes("Katherine"));

    // ── 7. Reload ──
    console.log("B7. reload: the same sequence, no typing, the selection restored; without the session, re-asked");
    root.unmount();
    await sleep(50);
    const chatKeys = lsKeys().filter((k) => k.startsWith(`chat:${SLUG}:`));
    const bookingKeys = lsKeys().filter((k) => k.startsWith(`booking:${SLUG}:`));
    check("7. the chat is saved under chat:<slug>:<id> and the session under booking:<slug>:<sessionId>",
      chatKeys.length === 1 && bookingKeys.length >= 1, lsKeys().join(" | "));
    let stored: { id?: string; role: string; content: string; typed?: boolean }[] = [];
    try {
      stored = JSON.parse(ls.getItem(chatKeys[0] ?? "") ?? "[]");
    } catch {
      stored = [];
    }
    const sid = bookingKeys[0]?.slice(`booking:${SLUG}:`.length) ?? "";
    check("7. stored messages carry the session's ids (<sessionId>:<stepId>:ask / :reply / confirmed:ask)",
      !!sid && stored.some((m) => m.id === `${sid}:service:ask`) && stored.some((m) => m.id === `${sid}:service:reply`) &&
        stored.some((m) => m.id === `${sid}:review:ask`) && stored.some((m) => m.id === `${sid}:confirmed:ask`),
      stored.map((m) => m.id ?? "(no id)").join(" | "));
    check("7. the transient typed flag is never saved", stored.every((m) => !("typed" in m)));

    root = mount();
    Date.now = realNow; // real time: a typed intro would need hundreds of ms to finish
    let completeAtFirstPaint = false;
    const intros = [ASK.service, ASK.provider, ASK.time, ASK.screen, ASK.review, ASK.options, ASK.confirmed];
    await openSavedChat(QUESTION_1);
    await waitFor("the restored thread", () => {
      if (!text().includes(MODEL_OPENER)) return false;
      completeAtFirstPaint = intros.every((i) => text().includes(i));
      return true;
    });
    Date.now = fastNow;
    check("7. restored with no typing — every intro is complete the moment the thread paints", completeAtFirstPaint, text().slice(0, 400));
    orderHolds("7. the same bubbles in the same order");
    check("7. the selection is restored — Long Hair Cut picked, Katherine chosen, the name filled in",
      tile("Long Hair Cut")?.getAttribute("aria-pressed") === "true" && byAria("Katherine")?.getAttribute("aria-checked") === "true" && firstName()?.value === "Ada",
      `pressed=${tile("Long Hair Cut")?.getAttribute("aria-pressed")} katherine=${byAria("Katherine")?.getAttribute("aria-checked")} name=${firstName()?.value}`);
    check("7. still booked and locked after the reload", text().includes("You're booked.") && isDisabled(tile("Gel Manicure")));
    check("7. reopening booked nothing again — still one POST /api/booking", requests.filter((r) => r.url === "/api/booking" && r.method === "POST").length === 1);

    root.unmount();
    await sleep(50);
    for (const k of lsKeys().filter((key) => key.startsWith("booking:"))) ls.removeItem(k);
    check("7. only the booking:* keys were cleared; the chat stays", lsKeys().some((k) => k.startsWith(`chat:${SLUG}:`)) && !lsKeys().some((k) => k.startsWith("booking:")));
    root = mount();
    await openSavedChat(QUESTION_1);
    await waitFor("the first step re-asked", () => text().includes(ASK.service));
    check("7. without its session the cards are pruned: the service ask is asked once again, once", count(ASK.service) === 1, `${count(ASK.service)}`);
    check("7. the later asks are gone", !text().includes(ASK.provider) && !text().includes(ASK.time) && !text().includes(ASK.review) && !text().includes(ASK.confirmed), text().slice(-400));
    check("7. the model's own text survives the prune", text().includes(MODEL_OPENER) && text().includes(QUESTION_1));
    check("7. the pruned session's reply lines are gone too", !userLine(/^(Picked|Provider|When|Details|Options|Booked):/), bubbles("user").join(" | "));

    // ── 8. Book from the services card ──
    console.log("B8. the services card's Book starts a session with the service picked");
    const home = container.querySelector('button[aria-label="Back to home"]') as HTMLButtonElement | null;
    check("8. Home starts a new chat", !!home);
    home?.click();
    await sleep(50);
    await send(QUESTION_3, { text: MODEL_SERVICES, cards: [servicesBlock()] });
    await waitFor("the services card", () => !!byAria("Book Gel Manicure"));
    byAria("Book Gel Manicure")?.click();
    await sleep(30);
    await waitFor("the provider ask", () => text().includes(ASK.provider));
    check("8. a Picked line for the tapped service, then the provider ask, at the bottom",
      inOrder([QUESTION_3, MODEL_SERVICES, "Picked: Gel Manicure", ASK.provider]) === "", inOrder([QUESTION_3, MODEL_SERVICES, "Picked: Gel Manicure", ASK.provider]));
    check("8. exactly one Picked line", bubbles("user").filter((b) => b.startsWith("Picked:")).length === 1, bubbles("user").join(" | "));
    check("8. no service ask and no service card — the service is already picked", !text().includes(ASK.service) && !tile("Gel Manicure"));
    check("8. the new session is in storage under booking:<slug>:<sessionId>", lsKeys().some((k) => k.startsWith(`booking:${SLUG}:`)), lsKeys().join(" | "));

    // ── 9. A second booking block while a session is live ──
    console.log("B9. a second booking block while a session is live points back up");
    await send(QUESTION_4, { text: MODEL_AGAIN, cards: [bookingBlock()] });
    await waitFor("the in-progress note", () => text().includes(ASK.inProgress));
    check("9. the note reads as specified", text().includes("Your booking is in progress above — keep going there, or say 'start over'."), text().slice(-300));
    check("9. no second session started: still one provider ask, no service ask", count(ASK.provider) === 1 && !text().includes(ASK.service));
    check("9. the live session's card is still there to keep going", !!byAria("Katherine"));
    root.unmount();
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realSetInterval;
    globalThis.setTimeout = realSetTimeout;
  }

  console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nAll ${passes} checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("Proof run errored:", e);
  process.exit(1);
});

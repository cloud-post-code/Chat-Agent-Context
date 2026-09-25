/**
 * Primary proof for custom-booking-form's reader and transcriber.
 * Run: npx tsx docs/features/custom-booking-form/reader-proof.ts
 *
 * (A) drives the fake four-screen widget (reader.html) in headless Chromium
 * with the SAME snapshot/advance functions readBookingForm uses; (B) the
 * static cheerio fallback over the same HTML; (C) the serializer; (D) the
 * sanitizer's caps and its refusal to merge or rename; (E) transcribeForm
 * with a scripted model; (F) the traps the reader must never spring
 * (reader-traps.html: submit buttons, onchange-submit selects, "Pay" tiles,
 * a pre-marked decoy); (G) the in-page string caps; (H) the network guard —
 * a browser context that never loads a private address, driven against a
 * local server on 127.0.0.1; (I) the halted flag; (J) prototype-named keys;
 * (K) hasVisibleContent, the signal readBookingForm's first-screen grace
 * period waits on for a client-rendered booking app that paints late.
 * Offline: no site, no model, no database.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import {
  advanceFrame,
  fingerprint,
  hasVisibleContent,
  serializeSnapshot,
  snapshotFrame,
  snapshotStatic,
  type FormSnapshot,
  type Screen,
} from "../../../lib/onboarding/formReader";
import { EMPTY_FORM_SPEC, sanitizeFormSpec, transcribeForm } from "../../../lib/onboarding/formTranscribe";
import { Crawler, guardedContext } from "../../../lib/onboarding/crawl";
import { isPublicHostname, isPublicTarget } from "../../../lib/onboarding/netGuard";
import { isSafeExternalUrl } from "../../../lib/onboarding/bookingPage";
import { specKeys } from "../../../lib/booking/formSpec";
import { customerFromAnswers } from "../../../lib/appointmentTypes";
import { MOONLIGHT_POLICY, MOONLIGHT_SNAPSHOT, MOONLIGHT_SPEC, MOONLIGHT_STAFF } from "./fixture.moonlight";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const same = (a: unknown, b: unknown): boolean => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const html = readFileSync(path.join(__dirname, "reader.html"), "utf8");
const trapsHtml = readFileSync(path.join(__dirname, "reader-traps.html"), "utf8");
const field = (s: Screen | undefined, label: string) => s?.elements.find((e) => e.tag !== "button" && e.label === label);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A server on the loopback interface that counts what reaches it. */
async function localServer(): Promise<{ origin: string; hits: () => number; close: () => void }> {
  let n = 0;
  const server = http.createServer((_, res) => {
    n++;
    res.setHeader("content-type", "text/html");
    res.end("<html><body><h1>internal</h1><input placeholder='secret'></body></html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return { origin: `http://127.0.0.1:${port}`, hits: () => n, close: () => server.close() };
}

/**
 * Playwright's own Chromium, or — when the installed Playwright expects a
 * newer revision than the one at PLAYWRIGHT_BROWSERS_PATH — whichever
 * Chromium is there. Never `playwright install`s.
 */
async function launch() {
  try {
    return await chromium.launch({ headless: true });
  } catch (err) {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root) throw err;
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort();
    for (const d of dirs.reverse()) {
      for (const bin of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const executablePath = path.join(root, d, bin);
        if (existsSync(executablePath)) return chromium.launch({ headless: true, executablePath });
      }
    }
    throw err;
  }
}

async function driveFake(): Promise<{ screens: Screen[]; booked: boolean; clicks: string[] }> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const frame = page.mainFrame();
    const screens: Screen[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const shot = await snapshotFrame(frame);
      const fp = fingerprint(shot);
      if (!seen.has(fp)) {
        seen.add(fp);
        screens.push({ index: screens.length + 1, ...shot });
      }
      const actions = await advanceFrame(frame);
      console.log(`    screen ${screens.length} "${shot.headings[0] ?? ""}" → ${actions.join(", ") || "(nothing to do)"}`);
      if (!actions.length) break;
    }
    const booked = (await page.evaluate("window.__booked")) as boolean;
    const clicks = (await page.evaluate("window.__clicks")) as string[];
    return { screens, booked, clicks };
  } finally {
    await browser.close();
  }
}

async function main() {
  // ── A. Driving the fake widget ──────────────────────────────────────────
  console.log("A. snapshotFrame + advanceFrame over reader.html");
  const { screens, booked, clicks } = await driveFake();
  check("four screens read", screens.length === 4, `got ${screens.length}: ${screens.map((s) => s.headings[0]).join(" / ")}`);
  const [s1, s2, s3, s4] = screens;
  check("screen 1 headings", same(s1?.headings, ["Select Service", "Manicure", "PEDICURE"]), JSON.stringify(s1?.headings));
  const tiles1 = s1?.elements.filter((e) => e.tag === "tile_list") ?? [];
  check("screen 1 has two tile lists labelled by category", same(tiles1.map((t) => t.label), ["Manicure", "PEDICURE"]), JSON.stringify(tiles1));
  check("tile texts carry the price", tiles1[0]?.options?.includes("Gel Manicure $35.00") === true, JSON.stringify(tiles1[0]?.options));
  check("screen 1 Next button seen", s1?.elements.some((e) => e.tag === "button" && e.label === "Next") === true);
  check("screen 2 heading", same(s2?.headings, ["Select Staff"]), JSON.stringify(s2?.headings));
  const staff = s2?.elements.find((e) => e.tag === "tile_list");
  check("staff tile list under its heading with the three names", staff?.label === "Select Staff" && same(staff.options, MOONLIGHT_STAFF), JSON.stringify(staff));
  check("screen 3 heading", same(s3?.headings, ["Select Date/Time"]), JSON.stringify(s3?.headings));
  check("screen 3 has no fields (a calendar is not an input)", s3?.elements.every((e) => e.tag === "button") === true, JSON.stringify(s3?.elements));
  check("a day and a slot were clicked to reach screen 4", clicks.some((c) => c.startsWith("day ")) && clicks.some((c) => c.startsWith("slot ")), clicks.join(", "));
  check("screen 4 heading", same(s4?.headings, ["How do we say hello?"]), JSON.stringify(s4?.headings));
  const labels4 = s4?.elements.filter((e) => e.tag !== "button").map((e) => `${e.label}${e.required ? "*" : ""}`) ?? [];
  check(
    "screen 4 labels in order with required marks",
    same(labels4, ["Full Name*", "Phone Number*", "Email", "Appointment Notes", "I agree to the cancellation policy*"]),
    JSON.stringify(labels4),
  );
  check("Full Name is a text input (required attr + asterisk)", field(s4, "Full Name")?.inputType === "text");
  check("Phone Number is tel, required only by its asterisk, with its placeholder", (() => {
    const f = field(s4, "Phone Number");
    return f?.inputType === "tel" && f.required && f.placeholder === "(555) 555-5555";
  })(), JSON.stringify(field(s4, "Phone Number")));
  check("Email is an email input, optional", field(s4, "Email")?.inputType === "email" && field(s4, "Email")?.required === false);
  check("Appointment Notes is a textarea", field(s4, "Appointment Notes")?.tag === "textarea");
  check("the agreement is a lone checkbox", field(s4, "I agree to the cancellation policy")?.tag === "checkbox");
  check("policy paragraph is in the screen text", s4?.text.includes(MOONLIGHT_POLICY) === true);
  check("Book appointment button seen but never clicked", s4?.elements.some((e) => e.tag === "button" && e.label === "Book appointment") === true && booked === false, `booked=${booked}`);
  check("screens have distinct fingerprints", new Set(screens.map(fingerprint)).size === screens.length);

  // ── B. Static fallback ──────────────────────────────────────────────────
  console.log("B. snapshotStatic over the same HTML");
  const stat = snapshotStatic({ url: "https://example.com/book", html, $: cheerio.load(html) });
  check("one static screen", stat.how === "static" && stat.screens.length === 1);
  const st = stat.screens[0];
  const statLabels = st.elements.filter((e) => ["input", "textarea", "checkbox"].includes(e.tag)).map((e) => `${e.label}${e.required ? "*" : ""}`);
  check(
    "static inputs with labels and required marks",
    same(statLabels, ["Full Name*", "Phone Number*", "Email", "Appointment Notes", "I agree to the cancellation policy*"]),
    JSON.stringify(statLabels),
  );
  check("static sees the priced tile lists", st.elements.filter((e) => e.tag === "tile_list").length >= 2, JSON.stringify(st.elements.filter((e) => e.tag === "tile_list").map((e) => e.label)));
  check("static headings include every screen's", ["Select Service", "Select Staff", "Select Date/Time", "How do we say hello?"].every((h) => st.headings.includes(h)), JSON.stringify(st.headings));
  const withFrame = snapshotStatic({
    url: "https://example.com/book",
    html: `<html><body><h1>Book</h1><iframe src="https://booking.gocheckin.net/v2/20986"></iframe><iframe src="https://www.youtube.com/embed/x"></iframe></body></html>`,
    $: cheerio.load(`<html><body><h1>Book</h1><iframe src="https://booking.gocheckin.net/v2/20986"></iframe><iframe src="https://www.youtube.com/embed/x"></iframe></body></html>`),
  });
  check(
    "static lists a booking-host iframe (and not a video one)",
    same(withFrame.screens[0].elements.map((e) => e.label), ["iframe: https://booking.gocheckin.net/v2/20986"]),
    JSON.stringify(withFrame.screens[0].elements),
  );

  // ── C. Serializer ───────────────────────────────────────────────────────
  console.log("C. serializeSnapshot");
  const text = serializeSnapshot(MOONLIGHT_SNAPSHOT);
  check("has the screen 4 block", text.includes("=== SCREEN 4 "));
  check('has "Full Name", required', text.includes('"Full Name", required'));
  check("has the tile options", text.includes("options: Basic Manicure $22.00 | Gel Manicure $35.00"));
  check("has the placeholder", text.includes('placeholder "(555) 555-5555"'));
  const big: FormSnapshot = { ...MOONLIGHT_SNAPSHOT, screens: MOONLIGHT_SNAPSHOT.screens.map((s) => ({ ...s, text: "x".repeat(20_000) })) };
  const bigText = serializeSnapshot(big);
  check("caps each screen with a cut marker", bigText.includes("…[cut]") && bigText.length <= 40_000, `len ${bigText.length}`);

  // ── D. Sanitizer ────────────────────────────────────────────────────────
  console.log("D. sanitizeFormSpec");
  const many = {
    found: true,
    steps: [],
    fields: Array.from({ length: 70 }, (_, i) => ({
      label: `Question ${i + 1}`,
      type: i === 0 ? "customer_thing" : "short_text",
      required: "true",
      role: i === 0 ? "customer" : "none",
      screen: i === 0 ? 7 : 9,
      options: [],
    })),
  };
  const capped = sanitizeFormSpec(many);
  check("70 fields → 60", capped.fields.length === 60, String(capped.fields.length));
  check("unknown type → short_text", capped.fields[0].type === "short_text", capped.fields[0].type);
  check("unknown role → none", capped.fields[0].role === "none", capped.fields[0].role);
  check("screens 7/9/9 → 1/2/2", same(capped.fields.slice(0, 3).map((f) => f.screen), [1, 2, 2]), JSON.stringify(capped.fields.slice(0, 3).map((f) => f.screen)));
  check("required coerced from a string", capped.fields[0].required === true);
  const near = sanitizeFormSpec({
    found: true,
    steps: [{ kind: "questions", title: "Details", screen: 1 }, { kind: "bogus", title: "x" }],
    fields: [
      { label: "Name", type: "short_text", required: true, role: "name", screen: 1 },
      { label: "Full Name", type: "short_text", required: false, role: "none", screen: 1 },
      { label: "Date", type: "date", required: false, role: "none", screen: 1 },
    ],
  });
  check("Name, Full Name and Date all kept, in order", same(near.fields.map((f) => f.label), ["Name", "Full Name", "Date"]), JSON.stringify(near.fields.map((f) => f.label)));
  check("unknown step kind dropped, known kept", same(near.steps, [{ kind: "questions", title: "Details", screen: 1 }]), JSON.stringify(near.steps));
  const typed = sanitizeFormSpec({
    found: true,
    steps: [],
    fields: [
      { label: "Guests", type: "number", min: 1, max: "8", screen: 1 },
      { label: "Notes", type: "long_text", min: 1, max: 8, text: "no", screen: 1 },
      { label: "Agree", type: "waiver", text: "  The policy.\n\nLine two.  ", screen: 1 },
    ],
  });
  check("min/max kept for number only", typed.fields[0].min === 1 && typed.fields[0].max === 8 && typed.fields[1].min === undefined && typed.fields[1].text === undefined);
  check("text kept for waiver only", typed.fields[2].text === "The policy.\n\nLine two.");
  check("found false → empty spec", same(sanitizeFormSpec({ found: false, fields: [{ label: "x" }] }), EMPTY_FORM_SPEC));
  check("garbage → empty spec, no throw", same(sanitizeFormSpec("nope"), EMPTY_FORM_SPEC) && same(sanitizeFormSpec(null), EMPTY_FORM_SPEC));

  // ── E. transcribeForm ───────────────────────────────────────────────────
  console.log("E. transcribeForm with a scripted model");
  let calls = 0;
  let sawSystem = "";
  let sawCorpus = "";
  const llm = async (system: string, corpus: string) => {
    calls++;
    sawSystem = system;
    sawCorpus = corpus;
    return `Here you go:\n${JSON.stringify(MOONLIGHT_SPEC)}\nDone.`;
  };
  const spec = await transcribeForm(MOONLIGHT_SNAPSHOT, { llm });
  check("spec equals the fixture", same(spec, MOONLIGHT_SPEC), JSON.stringify(spec).slice(0, 400));
  check("one call, with the prompt and the serialized snapshot", calls === 1 && sawSystem.includes("NEVER add, rename, merge, reorder or drop") && sawCorpus.includes("=== SCREEN 1 "));
  const empty: FormSnapshot = { url: MOONLIGHT_SNAPSHOT.url, how: "playwright", truncated: false, screens: [{ index: 1, url: MOONLIGHT_SNAPSHOT.url, headings: ["Call us"], elements: [{ tag: "button", label: "Call", required: false }], text: "Call us" }] };
  calls = 0;
  const none = await transcribeForm(empty, { llm });
  check("an empty snapshot makes no call and is not found", calls === 0 && same(none, EMPTY_FORM_SPEC));
  const junk = await transcribeForm(MOONLIGHT_SNAPSHOT, { llm: async () => "I cannot help with that." });
  check("a reply without JSON → empty spec", same(junk, EMPTY_FORM_SPEC));

  // ── F. Traps ────────────────────────────────────────────────────────────
  console.log("F. advanceFrame over reader-traps.html — nothing that commits is touched");
  {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setContent(trapsHtml);
      const frame = page.mainFrame();
      const shot = await snapshotFrame(frame);
      const payTiles = shot.elements.find((e) => e.tag === "tile_list" && e.options?.includes("Pay $50"));
      check("the Pay tiles are read as a tile list (seen, not clicked)", !!payTiles, JSON.stringify(shot.elements.filter((e) => e.tag === "tile_list")));
      const actions = await advanceFrame(frame);
      console.log(`    traps → ${actions.join(", ") || "(nothing to do)"}`);
      const fired = (await page.evaluate("window.__fired")) as string[];
      check("nothing that commits fired", fired.length === 0, fired.join("; "));
      check("the plain Next (type=button) was clicked", (await page.evaluate("window.__next")) === true);
      check("actions: one required select filled, then Next", same(actions, ["choices:1", "next:Next"]), actions.join(", "));
      check("the onchange=submit select was left empty", (await page.evaluate('document.getElementById("svc").value')) === "");
      check("the plain required select was filled", (await page.evaluate('document.getElementById("plain").value')) === "k");
      check("the radio group inside the submit-only form was left alone", (await page.evaluate('document.querySelector("input[name=len]:checked")')) === null);
      check("the pre-marked decoy still carries its marker, untouched", (await page.evaluate('document.getElementById("book").getAttribute("data-fr-target")')) === "next");
      // A second pass over the same screen: still nothing but the plain Next.
      const again = await advanceFrame(frame);
      const firedAgain = (await page.evaluate("window.__fired")) as string[];
      check("a second pass springs nothing either", firedAgain.length === 0 && same(again, ["next:Next"]), `${again.join(", ")} / ${firedAgain.join("; ")}`);
      // An OK button dismisses only inside a dialog.
      await page.setContent(`<dialog open id="d"><p>No staff available</p><button type="button" id="ok">OK</button></dialog><script>window.__ok=false;document.getElementById("ok").onclick=()=>{window.__ok=true;document.getElementById("d").close()}</script>`);
      const dialogActions = await advanceFrame(page.mainFrame());
      check("OK inside a dialog is clicked to dismiss it", (await page.evaluate("window.__ok")) === true && same(dialogActions, ["next:OK"]), dialogActions.join(", "));
    } finally {
      await browser.close();
    }
  }

  // ── G. In-page caps ─────────────────────────────────────────────────────
  console.log("G. snapshotFrame caps every string inside the page");
  {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      const long = (n: number, c = "x") => c.repeat(n);
      const opts = Array.from({ length: 200 }, (_, i) => `<option value="${i + 1}">${long(1000, "o")}${i}</option>`).join("");
      await page.setContent(`<html><body>
        <h2>${long(2000, "h")}</h2>
        <button type="button">${long(400, "b")}</button>
        <label for="a">${long(5000, "L")} *</label><input id="a" placeholder="${long(3000, "p")}" value="${long(500, "v")}">
        <label for="s">${long(300, "S")}</label><select id="s">${opts}</select>
        <fieldset><legend>${long(900, "G")}</legend>
          <label><input type="radio" name="r" value="1"> ${long(700, "r")}</label>
          <label><input type="radio" name="r" value="2"> ${long(700, "q")}</label>
        </fieldset>
        <div>${Array.from({ length: 110 }, (_, i) => `<label for="t${i}">${long(200, "t")}${i}</label><input id="t${i}" placeholder="${long(120, "w")}">`).join("")}</div>
        <label for="s2">${long(300, "S")}</label><select id="s2">${opts}</select>
        <p>${long(9000, "z")}</p>
      </body></html>`);
      // 115 elements would be pushed (each within its own caps); together they pass 64 KB.
      const shot = await snapshotFrame(page.mainFrame());
      const a = shot.elements.find((e) => e.tag === "input" && e.label.startsWith("L"));
      const s = shot.elements.find((e) => e.tag === "select");
      const g = shot.elements.find((e) => e.tag === "radio_group");
      const b = shot.elements.find((e) => e.tag === "button");
      check("heading cut to 160", shot.headings[0]?.length === 160, String(shot.headings[0]?.length));
      check("label cut to 200, still required", a?.label.length === 200 && a.required === true, JSON.stringify({ len: a?.label.length, required: a?.required }));
      check("placeholder cut to 120, value to 80", a?.placeholder?.length === 120 && a.value?.length === 80, JSON.stringify({ p: a?.placeholder?.length, v: a?.value?.length }));
      check("select options: at most 80, each cut to 200", s?.options?.length === 80 && s.options.every((o) => o.length <= 200), JSON.stringify({ n: s?.options?.length, max: Math.max(...(s?.options ?? []).map((o) => o.length)) }));
      check("legend and radio labels cut to 200", g?.label.length === 200 && g.options?.every((o) => o.length <= 200) === true, JSON.stringify({ l: g?.label.length, o: g?.options?.map((o) => o.length) }));
      check("button text cut to 80", b?.label.length === 80, String(b?.label.length));
      check("screen text cut to 2000", shot.text.length <= 2000, String(shot.text.length));
      const bytes = JSON.stringify(shot).length;
      check("the whole screen is at most 64 KB as JSON, later elements dropped to fit", bytes <= 64 * 1024 && shot.elements.length < 115 && shot.elements.length > 100, `${bytes} bytes, ${shot.elements.length} elements`);
      const line = serializeSnapshot({ url: "https://example.com/x", how: "playwright", truncated: false, screens: [{ index: 1, url: "https://example.com/x", headings: [], elements: [{ tag: "select", label: "big", required: false, options: Array.from({ length: 80 }, () => long(200)) }], text: "" }] });
      check("a serialized element line is cut at 4000", line.split("\n").every((l) => l.length <= 4000) && line.includes("…[cut]"), String(Math.max(...line.split("\n").map((l) => l.length))));
      const fp = fingerprint({ headings: ["h"], elements: [{ tag: "input", label: long(5000), required: false }] });
      check("fingerprint uses the capped label", fp.length < 300, String(fp.length));
    } finally {
      await browser.close();
    }
  }

  // ── H. Network guard ────────────────────────────────────────────────────
  console.log("H. netGuard: private addresses are refused, in the page and at the door");
  {
    const no = ["localhost", "127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]", "[::ffff:10.0.0.1]", "foo.internal", "foo.svc", "x.cluster.local.", "localhost.", "192.168.0.1", "100.64.1.1", "[fd12::1]", "[fe80::1]", "0x7f.1", "2130706433", "foo.lan", "a.home", "b.corp", "c.intranet", "nosuchtld"];
    const yes = ["example.com", "booking.gocheckin.net", "8.8.8.8", "[2606:4700::1111]", "sub.example.co.uk."];
    check("isPublicHostname refuses every private form", no.every((h) => !isPublicHostname(h)), no.filter(isPublicHostname).join(", "));
    check("isPublicHostname accepts public names and addresses", yes.every(isPublicHostname), yes.filter((h) => !isPublicHostname(h)).join(", "));
    check("isSafeExternalUrl still https-only and now sees a trailing dot, .svc, cluster.local", !isSafeExternalUrl("http://example.com/") && !isSafeExternalUrl("https://localhost./") && !isSafeExternalUrl("https://x.svc/") && !isSafeExternalUrl("https://x.cluster.local/") && isSafeExternalUrl("https://booking.gocheckin.net/v2/1"));
    check("isPublicTarget: a name that doesn't resolve is not public", (await isPublicTarget("https://no-such-host.invalid/")) === false);
    check("isPublicTarget: private literals, other schemes, credentials", !(await isPublicTarget("http://169.254.169.254/latest/")) && !(await isPublicTarget("http://[::ffff:127.0.0.1]/")) && !(await isPublicTarget("ftp://8.8.8.8/")) && !(await isPublicTarget("https://u:p@8.8.8.8/")) && (await isPublicTarget("http://8.8.8.8/")));

    const srv = await localServer();
    const browser = await launch();
    try {
      // In the guarded context nothing on 127.0.0.1 loads: not a subresource,
      // not a scripted navigation, not a frame; a popup closes; a dialog never holds.
      const { context, page } = await guardedContext(browser);
      await page.setContent(`<html><body>
        <img src="${srv.origin}/pixel.png">
        <iframe src="${srv.origin}/frame"></iframe>
        <script>
          fetch("${srv.origin}/api").catch(() => {});
          setTimeout(() => { location.href = "${srv.origin}/meta"; }, 50);
          setTimeout(() => { window.open("about:blank"); }, 60);
        </script>
      </body></html>`);
      await sleep(900);
      check("guarded context: the loopback server saw no request", srv.hits() === 0, `hits=${srv.hits()}`);
      // The scripted navigation was aborted: Chromium lands on its own error
      // page, never on the loopback address (and the reader treats that
      // error page as unreadable — it stops rather than snapshot it).
      check("guarded context: the page never reached the loopback address", !page.url().startsWith(srv.origin), page.url());
      check("guarded context: the popup was closed", context.pages().length === 1, String(context.pages().length));
      const alerted = await Promise.race([page.evaluate('(() => { alert("hold"); return "went on"; })()'), sleep(3000).then(() => "hung")]);
      check("guarded context: a dialog is dismissed, not waited on", alerted === "went on", String(alerted));
      await context.close();

      // At the door: Crawler.drive refuses the address outright, and load too.
      const events: string[] = [];
      const crawler = new Crawler(`${srv.origin}/`, (m) => events.push(m));
      try {
        const driven = await crawler.drive(`${srv.origin}/`, async (p) => {
          await p.goto(`${srv.origin}/`);
          return "drove";
        });
        check("Crawler.drive on 127.0.0.1 returns null without loading the page", driven === null && srv.hits() === 0, `${JSON.stringify(driven)} hits=${srv.hits()} ${events.join(" | ")}`);
        check("…and says why", events.some((e) => e.includes("not a public website")), events.join(" | "));
        const loaded = await crawler.load(`${srv.origin}/`);
        check("Crawler.load on 127.0.0.1 is null too, still no request", loaded === null && srv.hits() === 0, `hits=${srv.hits()}`);
      } finally {
        await crawler.close();
      }
    } finally {
      await browser.close();
      srv.close();
    }
  }

  // ── I. Halted ───────────────────────────────────────────────────────────
  console.log("I. advanceFrame with the clock run out does nothing");
  {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      const actions = await advanceFrame(page.mainFrame(), () => true);
      const clicks = (await page.evaluate("window.__clicks")) as string[];
      check("halted → no actions, no clicks", actions.length === 0 && clicks.length === 0, `${actions.join(", ")} / ${clicks.join(", ")}`);
    } finally {
      await browser.close();
    }
  }

  // ── K. hasVisibleContent — readBookingForm's client-rendered-app grace ──
  // (readBookingForm itself drives through Crawler.drive, which the network
  // guard refuses for any address that isn't a real public host — section H
  // proves that refusal — so a loopback server can't stand in for the real
  // booking widget here. This proves the signal it waits on instead: a blank
  // client-rendered app reads as empty, the same app a beat later reads as
  // real, and a tile list or a bare heading with no inputs still counts.)
  console.log("K. hasVisibleContent: a client-rendered app read before and after it paints");
  {
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.setContent("<html><body></body></html>");
      check("a blank page has no visible content", (await hasVisibleContent(page.mainFrame())) === false);
      await page.evaluate(() => {
        document.body.innerHTML = "<h1>Pick a service</h1><input placeholder='Name'>";
      });
      check("the same page, after painting its form, does", (await hasVisibleContent(page.mainFrame())) === true);

      await page.setContent("<html><body><h1>Book now</h1></body></html>");
      check("a bare heading with nothing to fill in still counts", (await hasVisibleContent(page.mainFrame())) === true);

      await page.setContent(
        "<html><body><div><a>Gel $35</a><a>Shellac $40</a><a>Dip $45</a></div></body></html>",
      );
      check("a tile list with no heading and no inputs still counts", (await hasVisibleContent(page.mainFrame())) === true);

      await page.setContent("<html><body><div id='spinner'>Loading…</div></body></html>");
      check("plain loading text with nothing clickable does not count", (await hasVisibleContent(page.mainFrame())) === false);
    } finally {
      await browser.close();
    }
  }

  // ── J. Prototype-named keys ─────────────────────────────────────────────
  console.log("J. a label that names an Object.prototype member gets no such key");
  // keyFromLabel lowercases, so "constructor" is the one prototype name a label can reach.
  const keys = specKeys(["Constructor", "constructor", "__proto__", "Name", "Name"]);
  check("specKeys: constructor → q<n>; the rest as before", same(keys, ["q1", "q2", "proto", "name", "name_2"]), JSON.stringify(keys));
  const contact = customerFromAnswers([{ key: "constructor", role: "name" }, { key: "toString", role: "email" }], {});
  check("customerFromAnswers reads own answers only", same(contact, {}), JSON.stringify(contact));
  const real = customerFromAnswers([{ key: "constructor", role: "name" }], { constructor: "Ada Lovelace" });
  check("…but an own answer under such a key still reads", same(real, { firstName: "Ada", lastName: "Lovelace" }), JSON.stringify(real));

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

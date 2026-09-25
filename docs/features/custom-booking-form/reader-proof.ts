/**
 * Primary proof for custom-booking-form's reader and transcriber.
 * Run: npx tsx docs/features/custom-booking-form/reader-proof.ts
 *
 * (A) drives the fake four-screen widget (reader.html) in headless Chromium
 * with the SAME snapshot/advance functions readBookingForm uses; (B) the
 * static cheerio fallback over the same HTML; (C) the serializer; (D) the
 * sanitizer's caps and its refusal to merge or rename; (E) transcribeForm
 * with a scripted model. Offline: no site, no model, no database.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import {
  advanceFrame,
  fingerprint,
  serializeSnapshot,
  snapshotFrame,
  snapshotStatic,
  type FormSnapshot,
  type Screen,
} from "../../../lib/onboarding/formReader";
import { EMPTY_FORM_SPEC, sanitizeFormSpec, transcribeForm } from "../../../lib/onboarding/formTranscribe";
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
const field = (s: Screen | undefined, label: string) => s?.elements.find((e) => e.tag !== "button" && e.label === label);

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

/**
 * Primary proof for booking-flow (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/booking-flow/tsconfig.proof.json docs/features/booking-flow/proof.ts
 *
 * Section A exercises the pure contract (types, intake rules). Section B the
 * pure engines (time, availability, pricing, hours). Section C runs the real
 * store against the local dev Postgres under throwaway users — services,
 * providers, locations, settings, the flow, availability, quotes, bookings,
 * the race, the waitlist, recurrence, the legacy bridge — with zero model
 * calls. Section D renders the real card to static markup. Everything made
 * is deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TZ = "America/New_York";
const SLUG = `proof-booking-flow-${Date.now()}`;

async function main() {
  const T = await import("../../../lib/booking/types");
  const Q = await import("../../../lib/appointmentTypes");

  // ══ A. The contract ═════════════════════════════════════════════════════
  console.log("A. The contract (lib/booking/types.ts, lib/appointmentTypes.ts)");
  {
    check("A1 '$35' is a fixed price", JSON.stringify(T.pricingFromText("$35")) === '{"kind":"fixed","amount":35}');
    check("A1 '$40+' starts at 40", T.pricingFromText("$40+").kind === "starting_at" && T.pricingFromText("$40+").amount === 40);
    check("A1 'from £25' starts at 25", T.pricingFromText("from £25").kind === "starting_at");
    const range = T.pricingFromText("$30–$45");
    check("A1 '$30–$45' is a range", range.kind === "range" && range.amount === 30 && range.maxAmount === 45);
    check("A1 '$60/hr' is hourly", T.pricingFromText("$60/hr").kind === "hourly");
    check("A1 '$12 per person' is per person", T.pricingFromText("$12 per person").kind === "per_person");
    check("A1 'Free' is free", T.pricingFromText("Free").kind === "free");
    check("A1 'Call for a quote' is a quote", T.pricingFromText("Call for a quote").kind === "quote");
    check("A1 '' is variable, never invented", T.pricingFromText("").kind === "variable");

    check("A2 labels: fixed", T.pricingLabel({ kind: "fixed", amount: 45 }) === "$45");
    check("A2 labels: starting at", T.pricingLabel({ kind: "starting_at", amount: 45 }) === "From $45");
    check("A2 labels: range", T.pricingLabel({ kind: "range", amount: 45, maxAmount: 80 }) === "$45–$80");
    check("A2 labels: hourly", T.pricingLabel({ kind: "hourly", amount: 45 }) === "$45/hr");
    check("A2 labels: per person", T.pricingLabel({ kind: "per_person", amount: 12 }) === "$12/person");
    check("A2 labels: per unit", T.pricingLabel({ kind: "per_unit", amount: 40, unitLabel: "room" }) === "$40/room");
    check("A2 labels: quote / free / varies", T.pricingLabel({ kind: "quote" }) === "Quote" && T.pricingLabel({ kind: "free" }) === "Free" && T.pricingLabel({ kind: "variable" }) === "Varies");
    check("A2 labels: GBP", T.pricingLabel({ kind: "fixed", amount: 25 }, "GBP") === "£25");
    check("A2 duration", T.formatDuration(45) === "45 min" && T.formatDuration(90) === "1 hr 30 min" && T.formatDuration(120) === "2 hr");

    const p = T.sanitizePricing({ kind: "range", amount: "30", maxAmount: 20 });
    check("A3 a range whose max is below its min drops the max", p.kind === "range" && p.maxAmount === undefined);
    check("A3 a priced kind with no amount becomes variable", T.sanitizePricing({ kind: "fixed" }).kind === "variable");
    check("A3 an unknown kind is fixed-or-variable, never thrown", T.sanitizePricing({ kind: "nonsense", amount: 5 }).kind === "fixed");

    const cfg = T.sanitizeServiceConfig({
      addons: [{ name: "Beard trim", price: "10", durationMinutes: 15 }, { name: "Beard trim" }, { name: "" }],
      variants: [{ name: "Long hair", pricing: { kind: "fixed", amount: 65 }, durationMinutes: 60 }],
      deposit: { kind: "percent", amount: 20 },
      modes: ["in_person", "mobile", "teleport"],
      staffIds: ["a", "b"],
      images: ["/api/uploads/abc.jpg", "javascript:alert(1)", "https://example.com/x.jpg"],
      bufferAfterMinutes: 10000,
      eligibility: "18+",
    });
    check("A4 add-ons de-duplicate by id and drop the nameless", cfg.addons.length === 1 && cfg.addons[0].id === "beard-trim" && cfg.addons[0].price === 10);
    check("A4 a variant keeps its own pricing and duration", cfg.variants[0].pricing?.amount === 65 && cfg.variants[0].durationMinutes === 60);
    check("A4 deposit percent", cfg.deposit.kind === "percent" && cfg.deposit.amount === 20);
    check("A4 unknown modes are dropped", cfg.modes.join(",") === "in_person,mobile");
    check("A4 only our uploads and https images survive", cfg.images.length === 2);
    check("A4 buffers are clamped", cfg.bufferAfterMinutes === 480);
    check("A4 a percent deposit over 100 is none", T.sanitizeDeposit({ kind: "percent", amount: 150 }).kind === "none");

    const staff = T.sanitizeStaffConfig({
      specialties: ["Fades", "Fades", " Color "],
      hours: { mon: [{ start: "10:00", end: "18:00" }], tue: [{ start: "18:00", end: "10:00" }] },
      timeOff: [{ start: "2026-12-24", end: "2026-12-26", label: "Holiday" }, { start: "x", end: "y" }],
      priceOverrides: { svc1: 55, bad: -5 },
      durationOverrides: { svc1: 45.6 },
    });
    check("A5 specialties trimmed and de-duplicated", staff.specialties.join("|") === "Fades|Color");
    check("A5 a backwards hours range is dropped, the day stays", staff.hours?.mon.length === 1 && staff.hours?.tue.length === 0);
    check("A5 time off keeps only real ranges", staff.timeOff.length === 1 && staff.timeOff[0].label === "Holiday");
    check("A5 overrides keep sane numbers only", staff.priceOverrides.svc1 === 55 && staff.priceOverrides.bad === undefined && staff.durationOverrides.svc1 === 46);
    check("A5 no hours at all reads as business hours", T.sanitizeStaffConfig({ hours: { mon: [] } }).hours === null);

    const loc = T.sanitizeLocationConfig({
      serviceArea: { postalCodes: ["78701", " 78702 ", "78701"], radiusMiles: "12.34", travelFee: 25 },
      meetingLink: "http://insecure.example",
      capacity: 3,
      priceOverrides: { svc1: 50 },
    });
    check("A6 postal codes normalized and de-duplicated", loc.serviceArea.postalCodes.join(",") === "78701,78702");
    check("A6 radius kept to a tenth, fee kept", loc.serviceArea.radiusMiles === 12.3 && loc.serviceArea.travelFee === 25);
    check("A6 an http meeting link is refused", loc.meetingLink === "");
    check("A6 capacity and location pricing", loc.capacity === 3 && loc.priceOverrides.svc1 === 50);
    check("A6 capacity defaults to one room", T.sanitizeLocationConfig({}).capacity === 1);

    const s = T.sanitizeBookingSettings({
      timezone: "Mars/Olympus",
      slotIntervalMinutes: 17,
      leadTimeMinutes: -5,
      maxAdvanceDays: 9999,
      customerFields: [{ key: "firstName", enabled: false, required: false }, { key: "company", enabled: true, required: true, label: "Business" }],
      promoCodes: [{ code: " welcome10 ", kind: "percent", amount: 10 }, { code: "BAD", kind: "percent", amount: 500 }],
      memberships: [{ name: "Gold", discountPercent: 15 }],
      tips: { enabled: true, presets: [10, 20, 500] },
      serviceFee: { kind: "percent", amount: 3 },
    });
    check("A7 an unknown timezone falls back", s.timezone === T.DEFAULT_TIMEZONE);
    check("A7 an odd slot interval falls back to 30", s.slotIntervalMinutes === 30);
    check("A7 lead time and advance window are clamped", s.leadTimeMinutes === 0 && s.maxAdvanceDays === 730);
    const company = s.customerFields.find((f) => f.key === "company")!;
    check("A7 a first_name-role field is an ordinary field: unanswered, it names nobody", Object.keys(Q.customerFromAnswers([{ key: "fn", role: "first_name" }], {})).length === 0 && Q.customerFromAnswers([{ key: "fn", role: "first_name" }], { fn: "Ada" }).firstName === "Ada");
    check("A7 a configurable field keeps its wording", company.enabled && company.required && company.label === "Business");
    check("A7 every customer key is present exactly once", s.customerFields.length === T.CUSTOMER_FIELD_KEYS.length);
    check("A7 promo codes are upper-cased and a >100% one is dropped", s.promoCodes.length === 1 && s.promoCodes[0].code === "WELCOME10");
    check("A7 memberships get ids", s.memberships[0].id === "gold");
    check("A7 tip presets past 100% are dropped", s.tips.presets.join(",") === "10,20");
    check("A7 the public rules carry no promo codes", !("promoCodes" in T.publicRules(s)) && T.publicRules(s).hasPromoCodes === true);
    check("A7 defaults are weekday nine to five", T.sanitizeBookingSettings({}).hours.mon[0].start === "09:00" && T.sanitizeBookingSettings({}).hours.sat.length === 0);
    const ch = T.sanitizeBookingSettings({ channels: ["phone", "fax", "phone", "walk_in"], confirmation: "request", confirmationOwner: "yes" });
    check("A7 booking channels keep the known ones, once; confirmation is instant or request", ch.channels.join() === "phone,walk_in" && ch.confirmation === "request" && ch.confirmationOwner === false && T.sanitizeBookingSettings({}).confirmation === "instant");

    const sel = T.sanitizeSelection({
      serviceId: "svc", addonIds: ["a", "a", "b"], quantity: "3", staffId: "", mode: "mobile",
      customer: { firstName: " Ada ", email: "ada@example.com", smsConsent: "yes", hacker: "x" },
      recurrence: { frequency: "weekly", count: 99 }, promoCode: " welcome10 ", tipPercent: 20, tipAmount: 5,
      answers: { q1: "yes" },
    });
    check("A8 a selection is normalized", sel.addonIds.join(",") === "a,b" && sel.quantity === 3 && sel.staffId === null && sel.mode === "mobile");
    check("A8 customer keeps known keys only", sel.customer.firstName === "Ada" && !("hacker" in sel.customer));
    check("A8 recurrence count is capped", sel.recurrence?.count === 26);
    check("A8 promo code normalized", sel.promoCode === "WELCOME10");
    check("A8 answers pass through", sel.answers.q1 === "yes");
  }
  {
    // Intake rules: the new question types and conditions.
    const date = Q.resolveAnswer({ label: "Event date", type: "date", config: {} }, "2026-10-05");
    check("A9 a date answer is kept", date.ok && date.value === "2026-10-05");
    check("A9 a non-date is refused", !Q.resolveAnswer({ label: "Event date", type: "date", config: {} }, "next tuesday").ok);
    check("A9 an upload must be one of ours", Q.resolveAnswer({ label: "Photo", type: "photo", config: {} }, "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg").ok
      && !Q.resolveAnswer({ label: "Photo", type: "photo", config: {} }, "https://evil.example/x.jpg").ok);
    check("A9 a signature is an upload too", Q.isUploadType("signature") && Q.resolveAnswer({ label: "Sign", type: "signature", config: {} }, "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.png").ok);
    const waiver = Q.resolveAnswer({ label: "Waiver", type: "waiver", config: { text: "I agree" } }, "yes");
    check("A9 an agreed waiver stores Agreed; an unagreed one is unanswered", waiver.ok && waiver.value === "Agreed" && Q.resolveAnswer({ label: "Waiver", type: "waiver", config: {} }, "").ok && (Q.resolveAnswer({ label: "Waiver", type: "waiver", config: {} }, "") as { value: string }).value === "");
    check("A9 waiver config keeps its text and nothing else", JSON.stringify(Q.sanitizeFieldConfig("waiver", { text: " Rules\r\nhere ", options: [] })) === '{"text":"Rules\\nhere"}');
    const cond = Q.sanitizeFieldConfig("short_text", { showIf: { key: "allergies", values: ["Yes", ""] } });
    check("A10 a condition survives on a text question", cond.showIf?.key === "allergies" && cond.showIf.values.join() === "Yes");
    const q = { key: "which", config: cond };
    check("A10 hidden until the other answer matches", !Q.isFieldShown(q, {}, ["allergies", "which"]) && !Q.isFieldShown(q, { allergies: "No" }, ["allergies", "which"]) && Q.isFieldShown(q, { allergies: "yes" }, ["allergies", "which"]));
    check("A10 a condition on an unknown question never hides", Q.isFieldShown(q, {}, ["which"]));
    check("A10 empty values mean 'when answered at all'", Q.isFieldShown({ key: "b", config: { showIf: { key: "a", values: [] } } }, { a: "anything" }));
    check("A10 a pick-any answer matches on any pick", Q.isFieldShown(q, { allergies: ["Nuts", "Yes"] }));
    check("A10 a bad condition key is dropped", Q.sanitizeFieldConfig("short_text", { showIf: { key: "Bad Key", values: [] } }).showIf === undefined);
  }

  await sectionB(check);
  await sectionC(check);
  await sectionD(check);

  console.log(failures ? `\n${failures} check(s) failed (${passes} passed).` : `\nAll ${passes} checks passed.`);
  process.exit(failures ? 1 : 0);
}

type Check = typeof check;

// Filled in below once the engines and store are in place.
async function sectionB(check: Check) {
  const { sectionB: run } = await import("./proof.sections");
  await run(check, TZ);
}
async function sectionC(check: Check) {
  const { sectionC: run } = await import("./proof.sections");
  await run(check, TZ, SLUG);
}
async function sectionD(check: Check) {
  const { sectionD: run } = await import("./proof.sections");
  await run(check, cheerio);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

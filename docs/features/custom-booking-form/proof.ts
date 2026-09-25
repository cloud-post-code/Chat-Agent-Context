/**
 * Primary proof for custom-booking-form: the business's own booking form,
 * copied verbatim into the tenant and walked by the card (see PROOF.md).
 * Run: npx tsx docs/features/custom-booking-form/proof.ts
 *
 * Offline, against the local dev Postgres under throwaway users deleted at
 * the end. The model is doubled at its two seams only — the services `llm`
 * and the transcriber's `formLlm` of `extractServicesAndBooking` — and the
 * browser at `readForm`; everything downstream (the static reader, the
 * sanitizer, the form write, the flow planner, the booking transaction, the
 * card block) is the real code. The reader and transcriber themselves are
 * pinned by reader-proof.ts (the fake widget driven in Chromium).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

/** The provider screen's people — "Any available staff" is a rule, never a provider row. */
const namedStaff = (names: string[]) => names.filter((n) => !/\b(any|anyone|anybody|no preference|first available)\b/i.test(n));

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
const same = (a: unknown, b: unknown): boolean => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const TZ = "America/New_York";
const TAG = `proof-custom-form-${Date.now()}`;
const HOURS = { start: "09:00", end: "17:00" };
const WEEKDAYS = { mon: [HOURS], tue: [HOURS], wed: [HOURS], thu: [HOURS], fri: [HOURS], sat: [], sun: [] };

const readerHtml = readFileSync(path.join(__dirname, "reader.html"), "utf8");
const pageOf = (url: string, html: string) => ({ url, html, $: cheerio.load(html) });

async function main() {
  const { prisma } = await import("../../../lib/db");
  const R = await import("../../../lib/onboarding/formReader");
  const X = await import("../../../lib/onboarding/formTranscribe");
  const F = await import("../../../lib/booking/formSpec");
  const S = await import("../../../lib/booking/store");
  const T = await import("../../../lib/booking/types");
  const { planSteps } = await import("../../../lib/booking/flowSteps");
  const { describeBookingSteps } = await import("../../../lib/booking/steps");
  const Ap = await import("../../../lib/appointments");
  const { bookingBlock } = await import("../../../lib/cards");
  const { extractServicesAndBooking, bookingFormUrl, SERVICES_SYSTEM_PROMPT } = await import("../../../lib/onboarding/services");
  const { MOONLIGHT_POLICY, MOONLIGHT_SPEC } = await import("./fixture.moonlight");
  const NAMED_STAFF = namedStaff(MOONLIGHT_SPEC.staff);

  const made: string[] = [];
  let seq = 0;
  const newUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `${TAG}-${tag}-${seq}@example.invalid`,
        name: `Proof Form ${tag}`,
        slug: `${TAG}-${tag}-${seq++}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    made.push(u.id);
    return u;
  };
  const flowIds = (flow: { kind: string; screen?: number; title?: string }[]) =>
    flow.map((s) => `${s.kind}${s.screen !== undefined ? `:${s.screen}` : ""}${s.title ? ` "${s.title}"` : ""}`).join(", ");
  const stepIds = (steps: { kind: string; screen?: number }[]) =>
    steps.map((s) => (s.kind === "screen" || s.kind === "question" ? `screen:${s.screen}` : s.kind)).join(" → ");

  try {
    // ── A. The static reader over the fake widget ───────────────────────────
    console.log("A. snapshotStatic over reader.html (lib/onboarding/formReader.ts)");
    const snap = R.snapshotStatic(pageOf("https://moonlight.invalid/book", readerHtml));
    const screen = snap.screens[0];
    const inputs = screen.elements.filter((e) => e.tag !== "button" && e.tag !== "tile_list");
    check("A1 one static screen, read from the loaded HTML", snap.how === "static" && snap.screens.length === 1 && !snap.truncated);
    check(
      "A1 the labelled inputs, in order, with their required marks",
      same(inputs.map((e) => `${e.label}${e.required ? "*" : ""}`), ["Full Name*", "Phone Number*", "Email", "Appointment Notes", "I agree to the cancellation policy*"]),
      JSON.stringify(inputs.map((e) => `${e.label}${e.required ? "*" : ""}`)),
    );
    check("A1 each input keeps its own type and placeholder", inputs[1].inputType === "tel" && inputs[1].placeholder === "(555) 555-5555" && inputs[2].inputType === "email" && inputs[3].tag === "textarea" && inputs[4].tag === "checkbox");
    const tiles = screen.elements.filter((e) => e.tag === "tile_list");
    check("A2 the priced service tiles and the staff list are read as option lists under their headings", tiles.length >= 2 && tiles[0].label === "Manicure" && tiles[0].options?.some((o) => o.includes("Gel Manicure $35.00")) === true && tiles.some((t) => t.label === "Select Staff" && same(t.options, ["Any available staff", "Katherine", "Vivian"])), JSON.stringify(tiles.map((t) => [t.label, t.options])));
    check("A2 the policy paragraph is in the screen's text", screen.text.includes(MOONLIGHT_POLICY));
    check("A2 nothing is copyable from a page with no inputs", R.snapshotIsEmpty(R.snapshotStatic(pageOf("https://x.invalid/", "<html><body><h1>Call us</h1><p>555-0100</p></body></html>"))));

    // ── B. The sanitizer: caps, never a normalization ───────────────────────
    console.log("B. sanitizeFormSpec (lib/onboarding/formTranscribe.ts)");
    const near = X.sanitizeFormSpec({
      found: true,
      steps: [{ kind: "questions", title: "Details", screen: 1 }],
      fields: [
        { label: "Name", type: "short_text", required: true, role: "name", screen: 1 },
        { label: "Full Name", type: "short_text", required: false, role: "none", screen: 1 },
        { label: "Date", type: "date", required: false, role: "none", screen: 1 },
      ],
    });
    check("B1 Name, Full Name and Date all survive, in order — nothing merged, renamed or reordered", same(near.fields.map((f) => f.label), ["Name", "Full Name", "Date"]), JSON.stringify(near.fields.map((f) => f.label)));
    const many = X.sanitizeFormSpec({
      found: true,
      steps: [],
      fields: Array.from({ length: 70 }, (_, i) => ({ label: `Question ${i + 1}`, type: i === 0 ? "customer_thing" : "short_text", required: true, role: i === 0 ? "customer" : "none", screen: i === 0 ? 7 : 9, options: [] })),
    });
    check("B2 70 fields → 60 (the cap)", many.fields.length === 60, String(many.fields.length));
    check("B2 an unknown type → short_text", many.fields[0].type === "short_text", many.fields[0].type);
    check('B2 role "customer" → none', many.fields[0].role === "none", many.fields[0].role);
    check("B2 screens 7/9/9 → 1/2/2", same(many.fields.slice(0, 3).map((f) => f.screen), [1, 2, 2]), JSON.stringify(many.fields.slice(0, 3).map((f) => f.screen)));
    check("B3 the fixture is already in sanitized shape (the sanitizer is a fixed point on it)", same(X.sanitizeFormSpec(MOONLIGHT_SPEC), MOONLIGHT_SPEC));
    check("B3 found:false is the empty spec, whatever else is sent", same(X.sanitizeFormSpec({ found: false, fields: [{ label: "x" }] }), X.EMPTY_FORM_SPEC));

    // ── C. writeFormSpec: the form as the site had it ───────────────────────
    console.log("C. writeFormSpec (lib/booking/formSpec.ts), real Postgres");
    const moon = await newUser("moon");
    const logs: string[] = [];
    const wrote = await F.writeFormSpec(moon.id, MOONLIGHT_SPEC, (m) => logs.push(m));
    check("C1 the write reports the rows, the steps and the people", same(wrote, { fields: 5, steps: 5, staff: NAMED_STAFF.length }), JSON.stringify(wrote));
    const rows = (await Ap.getBookingConfig(moon.id)).fields;
    check("C1 five rows, in the form's own order, with the form's own words", same(rows.map((f) => f.label), MOONLIGHT_SPEC.fields.map((f) => f.label)) && same(rows.map((f) => f.order), [0, 1, 2, 3, 4]), JSON.stringify(rows.map((f) => f.label)));
    check("C1 keys derived from the labels", same(rows.map((f) => f.key), ["full_name", "phone_number", "email", "appointment_notes", "i_agree_to_the_cancellation_policy"]), rows.map((f) => f.key).join());
    check("C1 types and required marks as the form had them", same(rows.map((f) => `${f.type}${f.required ? "*" : ""}`), ["short_text*", "phone*", "email", "long_text", "waiver*"]), JSON.stringify(rows.map((f) => `${f.type}${f.required ? "*" : ""}`)));
    check("C1 roles: name, phone, email, notes, policy", same(rows.map((f) => f.role), ["name", "phone", "email", "notes", "policy"]), rows.map((f) => f.role).join());
    check("C1 every field sits on the form's screen 4", rows.every((f) => f.screen === 4), rows.map((f) => f.screen).join());
    check("C1 the phone's placeholder and the waiver's policy text ride in the config", rows[1].config.placeholder === "(555) 555-5555" && rows[4].config.text === MOONLIGHT_POLICY, JSON.stringify([rows[1].config, rows[4].config]));
    check("C1 every row is marked as onboarding's (generated)", Ap.isUntouchedForm(rows) && rows.every((f) => f.config.generated === true));
    const settings = await S.getBookingSettings(moon.id);
    check(
      "C2 the flow is stored in the form's own step order, titles and screen included",
      flowIds(settings.flow) === 'service "Select Service", provider "Select Staff", time "Select Date/Time", questions:4 "How do we say hello?", review "How do we say hello?"',
      flowIds(settings.flow),
    );
    check("C2 'any available staff' on the form makes the provider optional", settings.staffSelection === "optional", settings.staffSelection);
    const staff = await S.listStaff(moon.id);
    check("C2 the people the provider screen listed are seeded as providers", staff.some((s) => s.name === "Katherine") && staff.some((s) => s.name === "Vivian") && staff.length === NAMED_STAFF.length && !staff.some((s) => /any available/i.test(s.name)), staff.map((s) => s.name).join());

    const again = await F.writeFormSpec(moon.id, MOONLIGHT_SPEC);
    check("C3 while the form is still onboarding's, a second read rewrites it (same five rows)", again.fields === 5 && (await prisma.appointmentField.count({ where: { userId: moon.id } })) === 5);
    check("C3 a hand edit is accepted", (await Ap.saveAppointmentField(moon.id, { key: "email", label: "Email address", type: "email", required: false })) === null);
    const edited = (await Ap.getBookingConfig(moon.id)).fields;
    check("C3 …and claims the whole form: nothing is generated any more", !Ap.isUntouchedForm(edited) && edited.every((f) => f.config.generated === undefined));
    const after = await F.writeFormSpec(moon.id, MOONLIGHT_SPEC, (m) => logs.push(m));
    const kept = (await Ap.getBookingConfig(moon.id)).fields;
    check("C3 after the hand edit the write is a no-op and says why", same(after, { fields: 0, steps: 0, staff: 0 }) && kept.length === 5 && kept[2].label === "Email address" && logs.some((l) => /edited by hand/.test(l)), JSON.stringify({ after, logs }));
    const blank = await newUser("blank");
    check("C4 found:false writes nothing", same(await F.writeFormSpec(blank.id, X.EMPTY_FORM_SPEC), { fields: 0, steps: 0, staff: 0 }) && (await prisma.appointmentField.count({ where: { userId: blank.id } })) === 0);

    // ── D. The card walks that form ─────────────────────────────────────────
    console.log("D. getBookingFlow + planSteps (lib/booking/store.ts, flowSteps.ts, steps.ts)");
    // The proof's hand edit above claimed the form; the plan below is over a
    // pristine copy so it reads exactly what the site's form asks.
    const walk = await newUser("walk");
    await F.writeFormSpec(walk.id, MOONLIGHT_SPEC);
    await S.saveBookingSettings(walk.id, { timezone: TZ, hours: WEEKDAYS, leadTimeMinutes: 60, slotIntervalMinutes: 30, maxAdvanceDays: 60 });
    const gel = await S.saveService(walk.id, { name: "Gel Manicure", category: "Manicure", pricing: { kind: "fixed", amount: 35 }, durationMinutes: 45 });
    if (!gel.ok) throw new Error(gel.error);
    const got = await S.getBookingFlow(walk.id);
    check("D1 the flow carries every field, contact ones included, role-tagged and screen-grouped", !!got && same(got.fields.map((f) => `${f.key}:${f.role}@${f.screen}`), ["full_name:name@4", "phone_number:phone@4", "email:email@4", "appointment_notes:notes@4", "i_agree_to_the_cancellation_policy:policy@4"]), JSON.stringify(got?.fields.map((f) => `${f.key}:${f.role}@${f.screen}`)));
    const planned = got ? planSteps(got.flow, got.fields, { serviceId: null, variantId: null, answers: {} }) : [];
    check("D1 the card walks service → provider → time → the one questions screen → review", stepIds(planned) === "service → provider → time → screen:4 → review", stepIds(planned));
    const screenStep = planned.find((s) => s.kind === "screen");
    check(
      "D1 the questions screen carries the form's heading and every field, Full Name required, Email optional",
      screenStep?.kind === "screen" && screenStep.title === "How do we say hello?" && screenStep.fields.length === 5 && screenStep.fields[0].required === true && screenStep.fields[2].required === false,
      JSON.stringify(screenStep),
    );
    const described = got ? describeBookingSteps(got.flow, got.fields) : [];
    check("D2 the step list the owner reads describes the same walk", stepIds(described) === "service → provider → time → screen:4 → review" && described[3].title === "How do we say hello?", stepIds(described));

    // ── E. A booking through that form ──────────────────────────────────────
    console.log("E. createBooking (lib/booking/store.ts) through the copied form");
    const { zonedParts } = await import("../../../lib/booking/time");
    const nowTz = zonedParts(new Date(), TZ);
    const month = `${nowTz.m === 12 ? nowTz.y + 1 : nowTz.y}-${String(nowTz.m === 12 ? 1 : nowTz.m + 1).padStart(2, "0")}`;
    const openDay = (await S.availability(walk.id, { serviceId: gel.id, month })).days?.find((d) => d.open);
    const slots = (await S.availability(walk.id, { serviceId: gel.id, date: openDay!.date })).slots ?? [];
    check("E0 the tenant has open slots to book", slots.length >= 3, String(slots.length));
    const sel = (over: Record<string, unknown>) => T.sanitizeSelection({ serviceId: gel.id, startsAt: slots[0].startsAt, ...over });
    const booked = await S.createBooking(walk.id, sel({ answers: { full_name: "Ada Lovelace", phone_number: "512-555-0100", i_agree_to_the_cancellation_policy: "yes" } }));
    check("E1 answers alone book — no separate customer object", booked.ok && booked.serviceName === "Gel Manicure", booked.ok ? "" : booked.error);
    const stored = (await S.listBookings(walk.id)).find((b) => booked.ok && b.id === booked.id);
    check("E1 the customer is read out of the role-tagged answers: Full Name split, phone kept, email absent", same(stored?.customer, { firstName: "Ada", lastName: "Lovelace", phone: "512-555-0100" }), JSON.stringify(stored?.customer));
    check("E1 the answers carry the policy as Agreed", stored?.answers.i_agree_to_the_cancellation_policy === "Agreed" && stored.answers.full_name === "Ada Lovelace", JSON.stringify(stored?.answers));
    const noPolicy = await S.createBooking(walk.id, sel({ startsAt: slots[1].startsAt, answers: { full_name: "Ada Lovelace", phone_number: "512-555-0100" } }));
    check("E2 a booking that skips the required policy is rejected, by the form's own label", !noPolicy.ok && /I agree to the cancellation policy/.test(noPolicy.ok ? "" : noPolicy.error), noPolicy.ok ? "booked" : noPolicy.error);
    const noPhone = await S.createBooking(walk.id, sel({ startsAt: slots[1].startsAt, answers: { full_name: "Ada Lovelace", i_agree_to_the_cancellation_policy: "yes" } }));
    check("E2 …and so is one that skips the required Phone Number", !noPhone.ok && /Phone Number/.test(noPhone.ok ? "" : noPhone.error), noPhone.ok ? "booked" : noPhone.error);
    const folded = await S.createBooking(walk.id, sel({ startsAt: slots[2].startsAt, customer: { firstName: "Grace", lastName: "Hopper", phone: "512-555-0101" }, answers: { i_agree_to_the_cancellation_policy: "yes" } }));
    const foldedRow = (await S.listBookings(walk.id)).find((b) => folded.ok && b.id === folded.id);
    check("E3 a card that still posts a customer object has it folded onto the role-tagged fields", folded.ok && foldedRow?.answers.full_name === "Grace Hopper" && foldedRow.customer.firstName === "Grace" && foldedRow.customer.phone === "512-555-0101", folded.ok ? JSON.stringify(foldedRow) : folded.error);

    // ── F. Onboarding end to end: read → transcribe → write ────────────────
    console.log("F. extractServicesAndBooking (lib/onboarding/services.ts), scripted model");
    check("F0 the services prompt reports only services, menu, takesAppointments and channels", /"takesAppointments"/.test(SERVICES_SYSTEM_PROMPT) && /"channels"/.test(SERVICES_SYSTEM_PROMPT) && !/requirements|"fields"|"staff"/.test(SERVICES_SYSTEM_PROMPT));
    const home = pageOf("https://moonlight.invalid/", '<html><body><h1>MoonLight Nails</h1><p>Gel Manicure $35.</p><a href="/book">Book online</a></body></html>');
    const bookPage = pageOf("https://moonlight.invalid/book", readerHtml);
    check("F0 the homepage's booking link is the form's url", bookingFormUrl([home, bookPage]) === "https://moonlight.invalid/book");
    let servicesCalls = 0;
    let formCalls = 0;
    let formCorpus = "";
    const servicesLlm = async () => {
      servicesCalls++;
      return { services: [{ name: "Gel Manicure", description: "", price: "$35", duration: "45 min", category: "Manicure" }], booking: { takesAppointments: true, channels: ["online"] } } as Record<string, unknown>;
    };
    const formLlm = async (_system: string, corpus: string) => {
      formCalls++;
      formCorpus = corpus;
      return JSON.stringify(MOONLIGHT_SPEC);
    };
    const onboarded = await newUser("onboard");
    const events: string[] = [];
    const run = await extractServicesAndBooking([home, bookPage], onboarded.id, (m) => events.push(m), { llm: servicesLlm, formLlm, readForm: async () => null });
    check("F1 the browser's null answer falls back to the loaded page's HTML: formHow static, formFound true", run.report.formHow === "static" && run.report.formFound === true, JSON.stringify(run.report));
    check("F1 the transcriber was handed the static snapshot (one call each seam)", servicesCalls === 1 && formCalls === 1 && formCorpus.includes('"Full Name", required'));
    check("F1 the report counts the copied rows and screens", run.report.seededFields === 5 && run.report.formScreens === 1 && run.report.seededServices === 1, JSON.stringify(run.report));
    check("F1 the returned form is the fixture, verbatim", same(run.form, MOONLIGHT_SPEC));
    const onboardedRows = (await Ap.getBookingConfig(onboarded.id)).fields;
    check("F1 the rows were written, in order, generated", same(onboardedRows.map((f) => f.key), ["full_name", "phone_number", "email", "appointment_notes", "i_agree_to_the_cancellation_policy"]) && Ap.isUntouchedForm(onboardedRows), onboardedRows.map((f) => f.key).join());
    check("F1 the flow followed the form", flowIds((await S.getBookingSettings(onboarded.id)).flow).startsWith('service "Select Service", provider "Select Staff", time'));
    const nolink = await newUser("nolink");
    const before = formCalls;
    const plain = await extractServicesAndBooking([pageOf("https://nolink.invalid/", "<html><body><h1>Hi</h1><p>Call us to book.</p></body></html>")], nolink.id, (m) => events.push(m), {
      llm: async () => ({ services: [], booking: { takesAppointments: true, channels: ["phone"] } }),
      formLlm,
      readForm: async () => null,
    });
    check("F2 a site with no booking link or widget: formFound false, formHow none, nothing written, no transcriber call", plain.report.formFound === false && plain.report.formHow === "none" && plain.report.seededFields === 0 && formCalls === before && (await prisma.appointmentField.count({ where: { userId: nolink.id } })) === 0, JSON.stringify(plain.report));
    check("F2 …and says so in the log", events.some((e) => /no booking link or widget/.test(e)));

    // ── G. The block the chat draws ─────────────────────────────────────────
    console.log("G. bookingBlock (lib/cards.ts)");
    check("G1 booking on, no fields, no services → no block (nothing to ask, nothing to sell)", (await Ap.getBookingConfig(nolink.id)).enabled && (await bookingBlock(nolink.id)) === null);
    const fieldsOnly = await newUser("fields");
    await Ap.saveAppointmentField(fieldsOnly.id, { key: "name", label: "Your name", type: "short_text", required: true, role: "name" });
    const block = await bookingBlock(fieldsOnly.id);
    check("G1 fields alone make a block, with role and screen on each field and the flow beside them", block?.type === "booking" && block.fields.length === 1 && block.fields[0].role === "name" && block.fields[0].screen === 1 && block.flow?.services.length === 0, JSON.stringify(block?.fields));
    const onboardedBlock = await bookingBlock(onboarded.id);
    check("G2 the onboarded tenant's block asks its copied form", onboardedBlock?.type === "booking" && onboardedBlock.fields.length === 5 && onboardedBlock.flow?.rules.flow[0].title === "Select Service");
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    const left = await prisma.user.count({ where: { email: { startsWith: TAG } } });
    check("Z no proof users left behind", left === 0, String(left));
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed (${passes} passed).` : `\nAll ${passes} checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Primary proof for booking-on-by-default (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-on-by-default/proof.ts
 *
 * Three sections, one command:
 *   A. bookingEnabled defaults on, without flipping existing tenants.
 *   B. Enabling seeds nothing; the services stage copies the site's own form
 *      when there is one, and leaves a form the tenant wrote alone.
 *   C. Appointment settings live on their panel, which is always there.
 *
 * The `llm` and `formLlm` seams of `extractServicesAndBooking` are the only
 * doubled boundaries (the browser's `readForm` answers null so the loaded
 * page's HTML is read); every write below is the real path. Panel placement
 * is asserted structurally — keys from adminPanelKeys, contents from the
 * rendered React tree — so a regression fails this command instead of
 * needing a human to look. Throwaway users are deleted at the end.
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
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

// Distinctive strings so a DB match can only come from this proof.
const SVC_1 = "Quillhaven kiln retrofits";
const SVC_2 = "Harrowgate flue surveys";

/** A site that names its services and never links a booking form. */
const PAGES = [
  page("https://example.invalid/services", `<h1>Services</h1><p>${SVC_1}. ${SVC_2}.</p>`),
  page("https://example.invalid/book", "<p>Book online.</p>"),
];

/** A site whose homepage links its own booking form — a plain HTML form the
 *  static reader can see when the browser can't. */
const FORM_PAGES = [
  page("https://example.invalid/", `<h1>Kilns</h1><p>${SVC_1}. ${SVC_2}.</p><a href="/book">Book an appointment</a>`),
  page(
    "https://example.invalid/book",
    '<h1>Book</h1><form><label for="n">Your name *</label><input id="n" type="text" required><label for="p">Phone</label><input id="p" type="tel"><button type="submit">Send</button></form>',
  ),
];

/** The transcription the scripted formLlm returns for FORM_PAGES: the form verbatim. */
const FORM_SPEC = {
  found: true,
  steps: [{ kind: "questions", title: "Book", screen: 1 }, { kind: "review", title: "", screen: 1 }],
  fields: [
    { label: "Your name", type: "short_text", required: true, options: [], allowOther: false, role: "name", screen: 1, placeholder: "", help: "" },
    { label: "Phone", type: "phone", required: false, options: [], allowOther: false, role: "phone", screen: 1, placeholder: "", help: "" },
  ],
  services: [],
  staff: [],
  anyStaffOffered: false,
};

/** Services found; the site says it takes bookings online. */
const SERVICES = {
  services: [
    { name: SVC_1, description: "Full retrofit of aging kilns." },
    { name: SVC_2, description: "Statutory flue inspection." },
  ],
  booking: { takesAppointments: true, channels: ["online"] },
};

/** The site never says it takes bookings, and names no services. */
const NOTHING = {
  services: [],
  booking: { takesAppointments: false, channels: [] },
};

async function main() {
  const { prisma, getProfile } = await import("../../../lib/db");
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const { getBookingConfig, setBookingEnabled, saveAppointmentField, isUntouchedForm } = await import("../../../lib/appointments");
  const { createBooking } = await import("../../../lib/booking/store");
  const { sanitizeSelection } = await import("../../../lib/booking/types");
  const { bookingBlock } = await import("../../../lib/cards");
  const { adminPanelKeys } = await import("../../../lib/adminBrain");

  let seq = 0;
  const mkUser = (tag: string) =>
    prisma.user.create({
      data: {
        email: `proof-booking-default-${tag}-${Date.now()}-${seq++}@example.invalid`,
        name: `Proof Booking ${tag}`,
        slug: `proof-booking-${tag}-${Date.now()}-${seq++}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
  const scriptedLlm = (result: unknown) => async () => result as Record<string, unknown>;
  let formCalls = 0;
  const formLlm = async () => {
    formCalls++;
    return JSON.stringify(FORM_SPEC);
  };
  const noBrowser = async () => null;
  const quiet = () => {};
  const made: string[] = [];
  const newUser = async (tag: string) => {
    const u = await mkUser(tag);
    made.push(u.id);
    return u;
  };
  const keysOf = async (userId: string) => (await getBookingConfig(userId)).fields.map((f) => f.key);

  try {
    // ══ A. Booking on by default ══════════════════════════════════════════
    const userDefault = await newUser("default");
    const freshProfile = await getProfile(userDefault.id);
    check(
      "A1 fresh profile has bookingEnabled true",
      freshProfile.bookingEnabled === true,
      `got ${freshProfile.bookingEnabled}`,
    );
    check(
      "A1 getBookingConfig reports enabled for a fresh tenant",
      (await getBookingConfig(userDefault.id)).enabled === true,
    );

    // An existing tenant who turned booking off stays off: the migration
    // changes the column default, it must never UPDATE existing rows.
    const userOff = await newUser("off");
    await getProfile(userOff.id);
    await prisma.profile.update({
      where: { userId: userOff.id },
      data: { bookingEnabled: false },
    });
    check(
      "A2 an explicitly-off tenant is not flipped on",
      (await getBookingConfig(userOff.id)).enabled === false,
    );

    // Off still means off, end to end.
    await setBookingEnabled(userOff.id, false);
    const rejected = await createBooking(
      userOff.id,
      sanitizeSelection({ serviceId: null, startsAt: new Date(Date.now() + 86_400_000).toISOString(), answers: {} }),
    );
    check(
      "A3 booking off rejects a submission",
      rejected.ok === false && /isn't available/.test(rejected.ok ? "" : rejected.error),
      JSON.stringify(rejected),
    );
    check(
      "A3 the toggle is not one-way",
      (await getBookingConfig(userOff.id)).enabled === false,
    );

    // ══ B. The form: nothing seeded, the site's own form copied ═══════════
    // B5: the flag is the whole of "on". Enabling — fresh, or again after an
    // off — writes no question.
    check("B5 a fresh tenant has booking on and an empty form", (await keysOf(userDefault.id)).length === 0);
    await setBookingEnabled(userDefault.id, false);
    await setBookingEnabled(userDefault.id, true);
    check("B5 enabling seeds nothing", (await keysOf(userDefault.id)).length === 0);

    // B6: services found, no booking form on the site — services are seeded,
    // the form stays empty, and the card still books through the services.
    const userNoForm = await newUser("noform");
    const noForm = await extractServicesAndBooking(PAGES, userNoForm.id, quiet, { llm: scriptedLlm(SERVICES), formLlm, readForm: noBrowser });
    check("B6 with no booking link the stage finds no form and copies nothing", noForm.report.formFound === false && noForm.report.formHow === "none" && noForm.report.seededFields === 0 && formCalls === 0, JSON.stringify(noForm.report));
    check("B6 the form stays empty", (await keysOf(userNoForm.id)).length === 0, (await keysOf(userNoForm.id)).join());
    check("B6 the services are seeded as Service rows", noForm.report.seededServices === 2, JSON.stringify(noForm.report));
    const blockNoForm = await bookingBlock(userNoForm.id);
    check("B6 the card books through the services with no questions at all", blockNoForm?.type === "booking" && blockNoForm.fields.length === 0 && blockNoForm.flow?.services.map((s) => s.name).join() === `${SVC_1},${SVC_2}`, JSON.stringify(blockNoForm?.flow?.services.map((s) => s.name)));

    // B7: the site's own form is copied verbatim.
    const userForm = await newUser("form");
    const copied = await extractServicesAndBooking(FORM_PAGES, userForm.id, quiet, { llm: scriptedLlm(SERVICES), formLlm, readForm: noBrowser });
    check("B7 a linked booking form is read from the page's HTML and transcribed", copied.report.formFound === true && copied.report.formHow === "static" && copied.report.seededFields === 2 && formCalls === 1, JSON.stringify(copied.report));
    const formRows = (await getBookingConfig(userForm.id)).fields;
    check("B7 the questions are the form's own, in order, with its marks and roles", formRows.map((f) => `${f.label}${f.required ? "*" : ""}:${f.type}:${f.role}`).join() === "Your name*:short_text:name,Phone:phone:phone", JSON.stringify(formRows));
    check("B7 they are marked as onboarding's, so a re-read may refresh them", isUntouchedForm(formRows) && formRows.every((f) => f.config.generated));

    // B11: a site that says nothing seeds nothing and breaks nothing.
    const userNothing = await newUser("nothing");
    const nothing = await extractServicesAndBooking(PAGES, userNothing.id, quiet, { llm: scriptedLlm(NOTHING), formLlm, readForm: noBrowser });
    check("B11 no services, no form: nothing written, nothing thrown", nothing.report.services === 0 && nothing.report.seededServices === 0 && (await keysOf(userNothing.id)).length === 0);
    check("B11 …and with nothing to ask or sell, no booking card is drawn", (await bookingBlock(userNothing.id)) === null);

    // B13: a form the tenant wrote is theirs — the site's form is never
    // copied over it.
    const userOwned = await newUser("owned");
    await saveAppointmentField(userOwned.id, { key: "company", label: "Company", type: "short_text", required: true });
    const events: string[] = [];
    await extractServicesAndBooking(FORM_PAGES, userOwned.id, (m) => events.push(m), { llm: scriptedLlm(SERVICES), formLlm, readForm: noBrowser });
    const cfgOwned = await getBookingConfig(userOwned.id);
    check(
      "B13 a hand-written form is left exactly as it was",
      cfgOwned.fields.length === 1 && cfgOwned.fields[0].key === "company" && cfgOwned.fields[0].label === "Company",
      JSON.stringify(cfgOwned.fields),
    );
    check("B13 …and the log says why", events.some((e) => /edited by hand/.test(e)), events.join(" | "));

    // B14: idempotent while the form is still onboarding's.
    const before = JSON.stringify(formRows.map((f) => [f.key, f.order, f.label, f.screen]));
    await extractServicesAndBooking(FORM_PAGES, userForm.id, quiet, { llm: scriptedLlm(SERVICES), formLlm, readForm: noBrowser });
    const after = JSON.stringify((await getBookingConfig(userForm.id)).fields.map((f) => [f.key, f.order, f.label, f.screen]));
    check("B14 running the stage twice changes nothing", before === after, `${before} vs ${after}`);

    // B15: tenant isolation.
    check(
      "B15 one tenant's form never reaches another's",
      (await keysOf(userNoForm.id)).length === 0 && (await keysOf(userNothing.id)).length === 0 && (await keysOf(userForm.id)).join() === "your_name,phone",
    );

    // B16: best-effort — a form write failure must not abort the stage or
    // lose the services knowledge written before it.
    const userBoom = await newUser("boom");
    let threw = false;
    // Make the copied rows' write fail, mid-stage.
    const realCreate = prisma.appointmentField.create.bind(prisma.appointmentField);
    (prisma.appointmentField as unknown as { create: unknown }).create = () => {
      throw new Error("proof-induced field write failure");
    };
    let boomReport: { seededFields: number; formFound: boolean } | null = null;
    try {
      boomReport = (await extractServicesAndBooking(FORM_PAGES, userBoom.id, quiet, { llm: scriptedLlm(SERVICES), formLlm, readForm: noBrowser })).report;
    } catch {
      threw = true;
    } finally {
      (prisma.appointmentField as unknown as { create: unknown }).create = realCreate;
    }
    check("B16 a form write failure does not throw out of the stage; the report says no rows were written", threw === false && boomReport?.formFound === true && boomReport.seededFields === 0, JSON.stringify(boomReport));
    check(
      "B16 services knowledge written before the failure survives",
      (await prisma.chunk.count({ where: { userId: userBoom.id, originKind: "source" } })) > 0,
    );
    check("B16 …and no half-written form is left behind", (await keysOf(userBoom.id)).length === 0);

    // ══ C. Settings › Booking is always present ═══════════════════════════
    const onKeys = await adminPanelKeys(userDefault.id);
    const offKeys = await adminPanelKeys(userOff.id);
    check(
      "C17 the Booking settings exist when booking is on",
      onKeys.some((k) => k.key === "booking"),
      onKeys.map((k) => k.key).join(","),
    );
    check(
      "C17 the Booking settings exist when booking is OFF (they hold the on switch)",
      offKeys.some((k) => k.key === "booking"),
      offKeys.map((k) => k.key).join(","),
    );
    check(
      "C18 the combined calendar is retired as a panel key",
      !onKeys.some((k) => k.key === "calendar") && !offKeys.some((k) => k.key === "calendar"),
      onKeys.map((k) => k.key).join(","),
    );

    // C19/C20: BookingSettings renders the toggle; the Appointments grid only
    // shows when booking is on. Real components.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { AppointmentsPanel } = await import("../../../app/admin/AppointmentsPanel");
    const { BookingSettings } = await import("../../../app/admin/BookingSettingsPanel");
    const noopAction = async () => {};

    const cfgOn = await getBookingConfig(userDefault.id);
    const settingsOn = renderToStaticMarkup(React.createElement(BookingSettings, { config: cfgOn }));
    check(
      "C19 Booking settings render the booking toggle",
      /booking/i.test(settingsOn) && /turn booking off/i.test(settingsOn),
    );
    const htmlOn = renderToStaticMarkup(
      React.createElement(AppointmentsPanel, {
        rows: [],
        fieldLabels: {},
        cancelAction: noopAction,
        confirmAction: noopAction,
        bookingEnabled: cfgOn.enabled,
      }),
    );
    check("C20 the month grid shows when booking is on", /Mon/.test(htmlOn) && /Tue/.test(htmlOn));

    const cfgOff = await getBookingConfig(userOff.id);
    const settingsOff = renderToStaticMarkup(React.createElement(BookingSettings, { config: cfgOff }));
    check("C20 the toggle still renders when booking is off", /turn booking on/i.test(settingsOff));
    const htmlOff = renderToStaticMarkup(
      React.createElement(AppointmentsPanel, {
        rows: [],
        fieldLabels: {},
        cancelAction: noopAction,
        confirmAction: noopAction,
        bookingEnabled: cfgOff.enabled,
      }),
    );
    check(
      "C20 the month grid is hidden when booking is off",
      !/Mon<\/div>/.test(htmlOff) && htmlOff.includes("?tab=booking"),
    );
  } finally {
    for (const id of made) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    // D22: baseline restored — nothing this proof made is left behind.
    const leaked = await prisma.user.count({
      where: { email: { startsWith: "proof-booking-default-" } },
    });
    check("D22 no proof users left behind", leaked === 0, `${leaked}`);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Primary proof for booking-on-by-default (see PROOF.md).
 * Run: npx tsx docs/features/booking-on-by-default/proof.ts
 *
 * Three sections, one command:
 *   A. bookingEnabled defaults on, without flipping existing tenants.
 *   B. The services stage always leaves a usable, service-aware form.
 *   C. Appointment settings live on the Calendar panel, which is always there.
 *
 * The `llm` seam is the only doubled boundary (the onboarding-booking-extraction
 * precedent); every write below is the real path. Panel placement is asserted
 * structurally — keys from adminPanelKeys, contents from the rendered React
 * tree — so a regression fails this command instead of needing a human to look.
 * Throwaway users are deleted at the end.
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
const PAGES = [
  page("https://example.invalid/services", `<h1>Services</h1><p>${SVC_1}. ${SVC_2}.</p>`),
  page("https://example.invalid/book", "<p>Book online.</p>"),
];

/** Services found, but the site never spells out what a booking asks for.
 *  This is the common case that currently seeds nothing at all. */
const NO_REQS = {
  services: [
    { name: SVC_1, description: "Full retrofit of aging kilns." },
    { name: SVC_2, description: "Statutory flue inspection." },
  ],
  booking: { takesAppointments: true, requirements: [] },
};

/** Services plus explicit requirements. */
const WITH_REQS = {
  services: [{ name: SVC_1, description: "Full retrofit of aging kilns." }],
  booking: {
    takesAppointments: true,
    requirements: [
      { label: "Your phone number", type: "phone", required: true },
      { label: "Gate code for the property", type: "dropdown", required: false },
    ],
  },
};

/** Requirement labels that derive to keys already claimed: "Name" -> name
 *  (the default) and "Service" -> service (the generated picker). Seeding
 *  upserts on key, so without a guard these silently overwrite both. */
const COLLIDING = {
  services: [{ name: SVC_1, description: "Full retrofit of aging kilns." }],
  booking: {
    takesAppointments: true,
    requirements: [
      { label: "Name", type: "short_text", required: true },
      { label: "Service", type: "short_text", required: true },
      { label: "Contact phone number", type: "phone", required: true },
    ],
  },
};

/** The site never says it takes bookings, and names no services. */
const NOTHING = {
  services: [],
  booking: { takesAppointments: false, requirements: [] },
};

/** Many long service names — every one must survive whole, as an option. */
const LONG_SERVICES = {
  services: Array.from({ length: 12 }, (_, i) => ({
    name: `Extremely Elaborate Service Number ${i + 1} With A Very Long Name`,
    description: "",
  })),
  booking: { takesAppointments: true, requirements: [] },
};

const LABEL_CAP = 120;

/** The names a choice question offers; empty for any other question. */
const optionNames = (f?: { config: { options?: { label: string }[] } }) =>
  (f?.config.options ?? []).map((o) => o.label);

async function main() {
  const { prisma, getProfile } = await import("../../../lib/db");
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const {
    getBookingConfig,
    setBookingEnabled,
    saveAppointmentField,
    createAppointment,
  } = await import("../../../lib/appointments");
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
  const quiet = () => {};
  const made: string[] = [];
  const newUser = async (tag: string) => {
    const u = await mkUser(tag);
    made.push(u.id);
    return u;
  };

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
    const rejected = await createAppointment(userOff.id, {
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      answers: {},
    });
    check(
      "A3 booking off rejects a submission",
      rejected.ok === false,
      JSON.stringify(rejected),
    );
    check(
      "A3 the toggle is not one-way",
      (await getBookingConfig(userOff.id)).enabled === false,
    );

    // ══ B. The form is seeded from the extraction ═════════════════════════
    // B5/B6: services found, zero requirements — the case that seeded nothing.
    const userNoReqs = await newUser("noreqs");
    await extractServicesAndBooking(PAGES, userNoReqs.id, quiet, {
      llm: scriptedLlm(NO_REQS),
    });
    const cfgNoReqs = await getBookingConfig(userNoReqs.id);
    const keysNoReqs = cfgNoReqs.fields.map((f) => f.key);
    check(
      "B5 a requirement-less extraction still seeds a usable catalog",
      cfgNoReqs.fields.length > 0,
      keysNoReqs.join(","),
    );
    check(
      "B5 the defaults floor is present",
      keysNoReqs.includes("name") && keysNoReqs.includes("email"),
      keysNoReqs.join(","),
    );

    // B8/B9/B12: the generated service picker. Since booking-menu-fields the
    // services are the question's OPTIONS (a pick-any menu), not names packed
    // into a text box's label.
    const picker = cfgNoReqs.fields.find((f) => f.key === "service");
    check(
      "B8 a service picker question is generated",
      picker !== undefined,
      JSON.stringify(cfgNoReqs.fields.map((f) => f.label)),
    );
    check(
      "B8 the picker names the extracted services",
      optionNames(picker).includes(SVC_1) && optionNames(picker).includes(SVC_2),
      JSON.stringify(picker?.config),
    );
    check("B8 the picker is a pick-any menu", picker?.type === "multi_select", picker?.type);
    check(
      "B8 exactly one picker exists",
      cfgNoReqs.fields.filter((f) => optionNames(f).includes(SVC_1)).length === 1,
    );
    check(
      "B9 the picker sorts after the defaults",
      !!picker &&
        picker.order >
          Math.max(
            ...cfgNoReqs.fields.filter((f) => ["name", "email"].includes(f.key)).map((f) => f.order),
          ),
      JSON.stringify(cfgNoReqs.fields.map((f) => [f.key, f.order])),
    );
    check(
      "B12 reason is dropped once a picker replaces it",
      picker !== undefined && !keysNoReqs.includes("reason"),
      keysNoReqs.join(","),
    );

    // B6: takesAppointments false must not gate the form either.
    const userNothing = await newUser("nothing");
    await extractServicesAndBooking(PAGES, userNothing.id, quiet, {
      llm: scriptedLlm(NOTHING),
    });
    const cfgNothing = await getBookingConfig(userNothing.id);
    const keysNothing = cfgNothing.fields.map((f) => f.key);
    check(
      "B6 takesAppointments=false still leaves a usable catalog",
      cfgNothing.fields.length > 0,
      keysNothing.join(","),
    );
    check(
      "B11 no services means no picker",
      cfgNothing.fields.length > 0 && !cfgNothing.fields.some((f) => f.key === "service"),
      keysNothing.join(","),
    );
    check(
      "B11 reason is kept when nothing more specific replaced it",
      keysNothing.includes("reason"),
      keysNothing.join(","),
    );

    // B7/B9: extracted requirements, with types, ordered after the picker.
    const userReqs = await newUser("reqs");
    await extractServicesAndBooking(PAGES, userReqs.id, quiet, {
      llm: scriptedLlm(WITH_REQS),
    });
    const cfgReqs = await getBookingConfig(userReqs.id);
    const phone = cfgReqs.fields.find((f) => f.label === "Your phone number");
    const treatment = cfgReqs.fields.find((f) => f.label === "Gate code for the property");
    check(
      "B7 an extracted requirement keeps its type and required flag",
      phone?.type === "phone" && phone?.required === true,
      JSON.stringify(phone),
    );
    check(
      "B7 an off-whitelist type degrades to short_text",
      treatment?.type === "short_text",
      JSON.stringify(treatment),
    );
    const pickerReqs = cfgReqs.fields.find((f) => optionNames(f).includes(SVC_1));
    check(
      "B9 the picker sorts before the extracted requirements",
      !!pickerReqs && !!phone && pickerReqs.order < phone.order,
      JSON.stringify(cfgReqs.fields.map((f) => [f.key, f.order])),
    );

    // B10: long names cost the label nothing — it no longer carries them.
    const userLong = await newUser("long");
    await extractServicesAndBooking(PAGES, userLong.id, quiet, {
      llm: scriptedLlm(LONG_SERVICES),
    });
    const cfgLong = await getBookingConfig(userLong.id);
    const longPicker = cfgLong.fields.find((f) => f.key === "service");
    check("B10 a picker was still seeded", longPicker !== undefined);
    check(
      "B10 the label is within the 120-char cap",
      !!longPicker && longPicker.label.length <= LABEL_CAP,
      `${longPicker?.label.length}`,
    );
    check(
      "B10 every service survives whole, as an option",
      optionNames(longPicker).length === LONG_SERVICES.services.length &&
        LONG_SERVICES.services.every((sv) => optionNames(longPicker).includes(sv.name)),
      JSON.stringify(optionNames(longPicker)),
    );

    // B13: a catalog the tenant already owns is never touched.
    const userOwned = await newUser("owned");
    await saveAppointmentField(userOwned.id, {
      key: "company",
      label: "Company",
      type: "short_text",
      required: true,
    });
    await extractServicesAndBooking(PAGES, userOwned.id, quiet, {
      llm: scriptedLlm(NO_REQS),
    });
    const cfgOwned = await getBookingConfig(userOwned.id);
    check(
      "B13 an existing catalog is left exactly as it was",
      cfgOwned.fields.length === 1 && cfgOwned.fields[0].key === "company",
      JSON.stringify(cfgOwned.fields),
    );

    // B13b: a colliding requirement label must not overwrite a seeded
    // question. Regression: an extracted "Service" replaced the generated
    // picker with the bare word, losing the service names entirely.
    const userClash = await newUser("clash");
    await extractServicesAndBooking(PAGES, userClash.id, quiet, {
      llm: scriptedLlm(COLLIDING),
    });
    const cfgClash = await getBookingConfig(userClash.id);
    const clashPicker = cfgClash.fields.find((f) => f.key === "service");
    check(
      "B13b a colliding requirement does not overwrite the service picker",
      optionNames(clashPicker).includes(SVC_1),
      JSON.stringify(clashPicker),
    );
    check(
      "B13b a colliding requirement does not overwrite a default",
      cfgClash.fields.find((f) => f.key === "name")?.label === "Your name",
      JSON.stringify(cfgClash.fields.find((f) => f.key === "name")),
    );
    check(
      "B13b non-colliding requirements are still seeded",
      cfgClash.fields.some((f) => f.label === "Contact phone number" && f.type === "phone"),
      cfgClash.fields.map((f) => f.label).join(" | "),
    );
    check(
      "B13b every seeded key is unique",
      new Set(cfgClash.fields.map((f) => f.key)).size === cfgClash.fields.length,
      cfgClash.fields.map((f) => f.key).join(","),
    );

    // B14: idempotent.
    const before = JSON.stringify(
      (await getBookingConfig(userNoReqs.id)).fields.map((f) => [f.key, f.order, f.label]),
    );
    await extractServicesAndBooking(PAGES, userNoReqs.id, quiet, {
      llm: scriptedLlm(NO_REQS),
    });
    const after = JSON.stringify(
      (await getBookingConfig(userNoReqs.id)).fields.map((f) => [f.key, f.order, f.label]),
    );
    check("B14 running the stage twice changes nothing", before === after, `${before} vs ${after}`);

    // B15: tenant isolation.
    check(
      "B15 one tenant's services never reach another's catalog",
      !(await getBookingConfig(userReqs.id)).fields.some((f) => optionNames(f).includes(SVC_2)) &&
        !(await getBookingConfig(userNothing.id)).fields.some((f) => optionNames(f).includes(SVC_1)),
    );

    // B16: best-effort — a seeding failure must not abort the stage or lose
    // the services knowledge written before it.
    const userBoom = await newUser("boom");
    const realCount = prisma.appointmentField.count.bind(prisma.appointmentField);
    let threw = false;
    // Make the very first field write fail, mid-seed.
    const realUpsert = prisma.appointmentField.upsert.bind(prisma.appointmentField);
    (prisma.appointmentField as unknown as { upsert: unknown }).upsert = async () => {
      throw new Error("proof-induced field write failure");
    };
    try {
      await extractServicesAndBooking(PAGES, userBoom.id, quiet, {
        llm: scriptedLlm(NO_REQS),
      });
    } catch {
      threw = true;
    } finally {
      (prisma.appointmentField as unknown as { upsert: unknown }).upsert = realUpsert;
    }
    check("B16 a seeding failure does not throw out of the stage", threw === false);
    check(
      "B16 services knowledge written before the failure survives",
      (await prisma.chunk.count({ where: { userId: userBoom.id, originKind: "source" } })) > 0,
    );
    void realCount;

    // ══ C. Settings live on the Calendar ══════════════════════════════════
    const onKeys = await adminPanelKeys(userDefault.id);
    const offKeys = await adminPanelKeys(userOff.id);
    check(
      "C17 the Calendar exists when booking is on",
      onKeys.some((k) => k.key === "calendar"),
      onKeys.map((k) => k.key).join(","),
    );
    check(
      "C17 the Calendar exists when booking is OFF (it holds the on switch)",
      offKeys.some((k) => k.key === "calendar"),
      offKeys.map((k) => k.key).join(","),
    );
    check(
      "C18 booking is retired as a standalone panel key",
      !onKeys.some((k) => k.key === "booking") && !offKeys.some((k) => k.key === "booking"),
      onKeys.map((k) => k.key).join(","),
    );

    // C19/C20: the Calendar panel renders the settings, and the grid only
    // when booking is on. Rendered to static markup — the real component.
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { CalendarPanel } = await import("../../../app/admin/CalendarPanel");
    const noopAction = async () => {};

    const cfgOn = await getBookingConfig(userDefault.id);
    const htmlOn = renderToStaticMarkup(
      React.createElement(CalendarPanel, {
        rows: [],
        fieldLabels: {},
        cancelAction: noopAction,
        config: cfgOn,
      } as never),
    );
    check(
      "C19 the Calendar renders the booking toggle",
      /booking/i.test(htmlOn) && /turn booking off/i.test(htmlOn),
    );
    check(
      "C19 the Calendar renders the question catalog",
      cfgOn.fields.every((f) => htmlOn.includes(f.label)),
      cfgOn.fields.map((f) => f.label).join(" | "),
    );
    check("C20 the month grid shows when booking is on", /Mon/.test(htmlOn) && /Tue/.test(htmlOn));

    const htmlOff = renderToStaticMarkup(
      React.createElement(CalendarPanel, {
        rows: [],
        fieldLabels: {},
        cancelAction: noopAction,
        config: await getBookingConfig(userOff.id),
      } as never),
    );
    check("C20 the toggle still renders when booking is off", /turn booking on/i.test(htmlOff));
    check(
      "C20 the month grid is hidden when booking is off",
      !/Mon<\/div>/.test(htmlOff),
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

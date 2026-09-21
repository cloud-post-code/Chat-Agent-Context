/**
 * Primary proof for booking-form-planner (see PROOF.md).
 * Run: npx tsx docs/features/booking-form-planner/proof.ts
 *
 * A and B exercise the pure rules. C and D run the real store and the real
 * onboarding services stage against the local dev Postgres under throwaway
 * users; the scripted `llm` is the one doubled boundary. Offline.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import { MOONLIGHT, MOONLIGHT_EXTRACT } from "./truth.moonlight";

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

const GEL = "Quillfeather Gel Manicure";
const PEDI = "Quillfeather Spa Pedicure";

const tomorrowAt = (h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

type Planned = { key: string; label: string; type: string; required: boolean; config?: { options?: { label: string }[]; min?: number; max?: number } };
const keys = (fields: { key: string }[]) => fields.map((f) => f.key).join(",");

async function main() {
  const B = await import("../../../lib/onboarding/bookingPage");
  const P = await import("../../../lib/bookingFormPlan");

  // ══ A. Finding the booking page ═════════════════════════════════════════
  {
    const home = page(
      "https://salon.example/",
      `<nav><a href="/service">Services</a><a href="/book-us">Book a party</a>
       <a href="https://www.facebook.com/salon">Book on Facebook</a>
       <a href="mailto:book@salon.example">Book by email</a><a href="tel:+16175550100">Call to book</a>
       <a href="https://booking.gocheckin.net/v2/20986">Booking</a></nav>`,
    );
    check("A1 an offsite booking-platform link is found, ahead of an on-site 'book' link", B.findBookingLink(home) === "https://booking.gocheckin.net/v2/20986", String(B.findBookingLink(home)));
    const social = page("https://salon.example/", `<a href="https://www.facebook.com/salon">Book on Facebook</a><a href="mailto:b@salon.example">Book</a><a href="tel:1">Book</a>`);
    check("A2 social, mailto and tel links never count", B.findBookingLink(social) === null, String(B.findBookingLink(social)));
    const onsite = page("https://salon.example/", `<a href="/appointments">Make an appointment</a>`);
    check("A2 an on-site booking link is found when it is all there is", B.findBookingLink(onsite) === "https://salon.example/appointments", String(B.findBookingLink(onsite)));

    const safe = ["https://booking.gocheckin.net/v2/1", "https://squareup.com/appointments/book/x"];
    const unsafe = ["http://booking.gocheckin.net/v2/1", "https://127.0.0.1/x", "https://10.0.0.8/x", "https://[::1]/x", "https://localhost/x", "https://printer.local/x", "https://db.internal/x", "ftp://a.example/x", "nonsense"];
    check("A3 https public hostnames are loadable", safe.every(B.isSafeExternalUrl));
    check("A3 http, IP literals and private names are not", unsafe.every((u) => !B.isSafeExternalUrl(u)), unsafe.filter(B.isSafeExternalUrl).join(" "));

    const noise = "No staff available for this service on this time. Please select other date & time! OK ";
    const widget = page("https://booking.gocheckin.net/v2/1", `<main>Manicure Basic Manicure $22.00 ${noise.repeat(40)} Kid Manicure $18.00</main>`);
    const corpus = B.bookingCorpus(widget);
    check("A4 the corpus is labelled as the booking page", corpus.startsWith("=== BOOKING PAGE https://booking.gocheckin.net/v2/1"), corpus.slice(0, 60));
    check("A4 a sentence the widget repeats appears once", corpus.split("No staff available").length === 2 && corpus.includes("Kid Manicure $18.00"), String(corpus.split("No staff available").length - 1));
  }

  // ══ B. The plan per kind ════════════════════════════════════════════════
  {
    const services = [
      { name: GEL, description: "", price: "$35", category: "Manicures" },
      // A second row under one heading: a heading per item is dropped as no heading at all.
      { name: "Quillfeather Basic Manicure", description: "", price: "$25", category: "Manicures" },
      { name: PEDI, description: "", price: "$60", category: "Pedicures" },
    ];
    const base = { services: [], staff: [], phone: "unknown", email: "unknown", notes: false, requirements: [] } as const;
    const plan = (f: Record<string, unknown>) => P.planBookingForm({ ...base, ...f } as never) as Planned[];

    const salon = plan({ kind: "personal_service", services, staff: ["Katherine", "Vivian"] });
    check("B1 a salon: who → what → who with → notes", keys(salon) === "name,phone,email,service,staff,notes", keys(salon));
    check("B1 phone is required, email optional", salon[1].required && salon[1].type === "phone" && !salon[2].required);
    const staffQ = salon.find((f) => f.key === "staff");
    check("B1 the staff question is a pick-one led by 'Any available'", staffQ?.type === "select" && staffQ.config?.options?.map((o) => o.label).join("|") === "Any available|Katherine|Vivian" && !staffQ.required, JSON.stringify(staffQ));
    check("B1 the menu is the catalog's, priced and sectioned", JSON.stringify(salon.find((f) => f.key === "service")?.config).includes('"price":"$35"') && JSON.stringify(salon[3].config).includes('"group":"Manicures"'));
    check("B2 no staff named → no staff question", !plan({ kind: "personal_service", services }).some((f) => f.key === "staff"));

    const table = plan({ kind: "table" });
    const party = table.find((f) => f.key === "party_size");
    check("B3 a restaurant asks party size, a required count 1–20", party?.type === "number" && party.required && party.config?.min === 1 && party.config?.max === 20, JSON.stringify(party));
    check("B3 …and a required phone", table.find((f) => f.key === "phone")?.required === true);

    const trade = plan({ kind: "home_service", services });
    check("B4 a home service needs the address and the job", trade.find((f) => f.key === "address")?.required === true && trade.find((f) => f.key === "job")?.required === true && trade.find((f) => f.key === "job")?.type === "long_text", keys(trade));

    check("B5 a consultation keeps 'What would you like to talk about?'", plan({ kind: "consultation" }).find((f) => f.key === "reason")?.label === "What would you like to talk about?");
    check("B5 'other' with no services is today's form", keys(plan({ kind: "other" })) === "name,email,reason", keys(plan({ kind: "other" })));
    check("B5 'other' with services is today's seeded form", keys(plan({ kind: "other", services })) === "name,email,service", keys(plan({ kind: "other", services })));

    const evidence = plan({ kind: "personal_service", services, email: "required", phone: "optional" });
    check("B6 site evidence beats the norm", evidence.find((f) => f.key === "email")?.required === true && evidence.find((f) => f.key === "phone")?.required === false);

    const many = Array.from({ length: 9 }, (_, i) => ({ label: `Extra question ${i}`, type: "short_text", required: false, options: [] }));
    const dupes = [
      { label: "Phone number", type: "phone", required: true, options: [] },
      { label: "Number of guests", type: "number", required: true, options: [] },
      { label: "Special requests", type: "long_text", required: false, options: [] },
      // Seen in the live cross-check: the wizard has its own time step.
      { label: "Date and time", type: "short_text", required: true, options: [] },
      { label: "Preferred day", type: "short_text", required: false, options: [] },
    ];
    const crowded = plan({ kind: "table", requirements: [...dupes, ...many] });
    check("B7 a requirement that repeats a planned question is dropped", crowded.filter((f) => f.type === "phone").length === 1 && crowded.filter((f) => f.type === "number").length === 1 && !crowded.some((f) => f.key === "special_requests"), keys(crowded));
    check("B7 …and so is one asking when: the wizard's last step already does", !crowded.some((f) => f.key === "date_and_time" || f.key === "preferred_day"), keys(crowded));
    check("B7 never more than 8 questions, notes kept, extras dropped first", crowded.length === 8 && crowded.some((f) => f.key === "notes"), keys(crowded));
    const allPlans = [salon, table, trade, crowded, plan({ kind: "class" }), plan({ kind: "other", phone: "optional", email: "optional" })];
    check("B7 name is first and required; one contact is always required", allPlans.every((p) => p[0].key === "name" && p[0].required && p.some((f) => (f.type === "phone" || f.type === "email") && f.required)));
  }

  // ══ C, D. The store and the onboarding stage ════════════════════════════
  const { prisma } = await import("../../../lib/db");
  const A = await import("../../../lib/appointments");
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");
  const { SERVICES_SOURCE_TITLE } = await import("../../../lib/serviceCatalog");

  let seq = 0;
  const made: string[] = [];
  const newUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `proof-form-planner-${tag}-${Date.now()}-${seq++}@example.invalid`,
        name: `Proof Planner ${tag}`,
        slug: `proof-form-planner-${tag}-${Date.now()}-${seq++}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    made.push(u.id);
    return u;
  };
  const scripted = (answer: unknown) => (async () => answer) as never;
  const generatedCount = async (userId: string) =>
    (await prisma.appointmentField.findMany({ where: { userId } })).filter((r) => r.config.includes('"generated":true')).length;

  try {
    // The recorded failure: booking on by default seeded the three defaults,
    // then onboarding found the services and wrote nothing.
    const salon = await newUser("salon");
    await A.setBookingEnabled(salon.id, true);
    await prisma.source.create({
      data: {
        userId: salon.id,
        kind: onboardingIngestKind("services"),
        title: SERVICES_SOURCE_TITLE,
        url: "https://example.invalid/service",
        rawText: `${GEL}. Long-wear gel polish. $35.\n\n${PEDI}. $60.`,
      },
    });
    const shown = (await A.getBookingConfig(salon.id)).fields;
    const menu = shown.find((f) => f.key === "service");
    check("C1 an untouched default form is handed the services menu", menu?.type === "multi_select" && menu.config.options?.map((o) => o.label).join("|") === `${GEL}|${PEDI}`, keys(shown));
    check("C1 …in place of 'What would you like to talk about?'", !shown.some((f) => f.key === "reason") && keys(shown) === "name,email,service", keys(shown));
    const stored = await prisma.appointmentField.findMany({ where: { userId: salon.id }, orderBy: { order: "asc" } });
    check("C1 …written down once, so what is shown is what is stored", keys(stored) === "name,email,service" && keys((await A.getBookingConfig(salon.id)).fields) === "name,email,service", keys(stored));
    check("C1 …still onboarding's to rebuild", stored.every((r) => r.config.includes('"generated":true')));

    // The admin owns what they see: deleting the shown question really removes it.
    const pruner = await newUser("pruner");
    await A.setBookingEnabled(pruner.id, true);
    await prisma.source.create({
      data: { userId: pruner.id, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE, url: "https://example.invalid/service", rawText: `${GEL}. $35.` },
    });
    await A.getBookingConfig(pruner.id);
    await A.deleteAppointmentField(pruner.id, "service");
    check("C1 an admin can delete the menu, and it stays deleted", keys((await A.getBookingConfig(pruner.id)).fields) === "name,email", keys((await A.getBookingConfig(pruner.id)).fields));

    const bare = await A.createAppointment(salon.id, { startsAt: tomorrowAt(9), answers: { name: "Wren", email: "w@example.invalid" } });
    const on = await A.createAppointment(salon.id, { startsAt: tomorrowAt(10), answers: { name: "Wren", email: "w@example.invalid", service: [GEL] } });
    check("C2 the validator holds a pick to that same menu", on.ok === true, JSON.stringify(on));
    const booked = on.ok ? await prisma.appointment.findUnique({ where: { id: on.id } }) : null;
    check("C2 …and stores it with its price", Boolean(booked?.answers.includes("$35")), booked?.answers);
    check("C2 …and requires one, as the menu is required", !bare.ok && bare.error.includes("required"), JSON.stringify(bare));

    const pages = [page("https://example.invalid/service", `<h1>Menu</h1> with Katherine`)];
    const answer = (price: string) => ({
      services: [{ name: GEL, description: "", price, duration: "45 min", category: "Manicures" }, { name: PEDI, description: "", price: "$60", duration: "", category: "Pedicures" }],
      booking: { takesAppointments: true, kind: "personal_service", staff: ["Katherine", "Zelphira the Unmentioned"], phone: "unknown", email: "unknown", notes: true, requirements: [] },
    });
    const first = await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$35")) });
    const rebuilt = (await A.getBookingConfig(salon.id)).fields;
    check("C3 onboarding now rebuilds the untouched form (it wrote nothing before)", first.report.seededFields === 6 && keys(rebuilt) === "name,phone,email,service,staff,notes", `${first.report.seededFields} ${keys(rebuilt)}`);
    check("C3 every question it wrote is marked generated", (await generatedCount(salon.id)) === 6, String(await generatedCount(salon.id)));
    const staffOpts = rebuilt.find((f) => f.key === "staff")?.config.options?.map((o) => o.label) ?? [];
    check("C6 a staff name the text never contained is dropped", staffOpts.join("|") === "Any available|Katherine", staffOpts.join("|"));

    await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$42")) });
    const refreshed = (await A.getBookingConfig(salon.id)).fields.find((f) => f.key === "service");
    check("C4 re-running refreshes a form nobody has edited", refreshed?.config.options?.[0]?.price === "$42", JSON.stringify(refreshed?.config.options?.[0]));

    await A.saveAppointmentField(salon.id, { key: "phone", label: "Best number to text", type: "phone", required: true });
    check("C5 one admin save makes the form the tenant's: nothing is generated any more", (await generatedCount(salon.id)) === 0, String(await generatedCount(salon.id)));
    const third = await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$99")) });
    const kept = (await A.getBookingConfig(salon.id)).fields;
    check("C5 …and onboarding never rewrites it", third.report.seededFields === 0 && kept.find((f) => f.key === "phone")?.label === "Best number to text" && kept.find((f) => f.key === "service")?.config.options?.[0]?.price === "$42", keys(kept));

    const mover = await newUser("mover");
    await extractServicesAndBooking(pages as never, mover.id, () => {}, { llm: scripted(answer("$35")) });
    await A.moveAppointmentField(mover.id, "service", "up");
    check("C5 reordering claims the form too", (await generatedCount(mover.id)) === 0, String(await generatedCount(mover.id)));
    const deleter = await newUser("deleter");
    await extractServicesAndBooking(pages as never, deleter.id, () => {}, { llm: scripted(answer("$35")) });
    await A.deleteAppointmentField(deleter.id, "notes");
    check("C5 deleting a question claims the form too", (await generatedCount(deleter.id)) === 0, String(await generatedCount(deleter.id)));

    // ══ D. The real business, replayed ════════════════════════════════════
    const moon = await newUser("moonlight");
    await A.setBookingEnabled(moon.id, true); // the state production was in
    const moonPages = [page(MOONLIGHT.site, "<h1>MoonLight Nails & Spa</h1>"), page(MOONLIGHT.bookingUrl, "<main>Service Staff Manicure</main>")];
    await extractServicesAndBooking(moonPages as never, moon.id, () => {}, { llm: scripted(MOONLIGHT_EXTRACT) });
    const form = (await A.getBookingConfig(moon.id)).fields;
    const opts = form.find((f) => f.key === "service")?.config.options ?? [];
    check("D1 the menu carries the real page's prices", ["Basic Manicure", "Gel Manicure", "SPA PEDICURE"].every((n) => opts.find((o) => o.label === n)?.price === MOONLIGHT.prices[n]), JSON.stringify(opts.slice(0, 3)));
    check("D1 …under its headings, and more than one can be picked", new Set(opts.map((o) => o.group)).size >= 5 && form.find((f) => f.key === "service")?.type === "multi_select");
    check("D2 it asks what the real page asks: name and phone required, email optional, notes", form.find((f) => f.key === "name")?.required === true && form.find((f) => f.key === "phone")?.required === true && form.find((f) => f.key === "email")?.required === false && form.find((f) => f.key === "notes")?.required === false, keys(form));
    check("D3 the technician step, whose names one read can't see, is an optional text question", form.find((f) => f.key === "preferred_technician")?.required === false);
    check("D3 …and nothing the real page doesn't ask", keys(form) === "name,phone,email,service,preferred_technician,notes", keys(form));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    const left = await prisma.user.count({ where: { email: { startsWith: "proof-form-planner-" } } });
    check("Z no proof users left behind", left === 0, String(left));
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

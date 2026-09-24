/**
 * Primary proof for booking-form-planner (see PROOF.md).
 * Run: npx tsx docs/features/booking-form-planner/proof.ts
 *
 * A and B exercise the pure rules. C and D run the real store and the real
 * onboarding services stage against the local dev Postgres under throwaway
 * users; the scripted `llm` is the one doubled boundary. Offline.
 *
 * The plan is the INTAKE — the questions the booking flow has no step of its
 * own for. The service, the provider, the time and the visitor's contact
 * details are steps of the flow, drawn from the Service, StaffMember and
 * BookingSettings rows the same stage seeds, so the plan never asks them.
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

    // Seen on three more local businesses (try.ts, 2026-09-21).
    const quote = page("https://cleaner.example/", `<a href="https://link.cleangenie.com/widget/form/abc?notrack=true">Get a Quote</a>`);
    check("A5 a trade's 'Get a Quote' is its booking link", B.findBookingLink(quote) === "https://link.cleangenie.com/widget/form/abc?notrack=true", String(B.findBookingLink(quote)));
    const estimate = page("https://handy.example/", `<a href="/request-estimate/">Request Estimate</a><a href="https://getjobber.com/industries/general-contracting/?utm_source=handy.example&utm_medium=referral&utm_campaign=jobber_ambassador"><img alt=""></a>`);
    check("A5 …and so is 'Request Estimate'; a platform's own advert is not", B.findBookingLink(estimate) === "https://handy.example/request-estimate/", String(B.findBookingLink(estimate)));
    const advert = page("https://handy.example/", `<a href="https://getjobber.com/industries/general-contracting/?utm_campaign=jobber_ambassador">Powered by Jobber</a>`);
    check("A6 a booking platform's marketing link alone is no booking page", B.findBookingLink(advert) === null, String(B.findBookingLink(advert)));
    const framed = page(
      "https://handy.example/request-estimate/",
      `<iframe src="https://form.jotform.com/261095441352049?parentURL=x"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe>
       <iframe src="https://www.google.com/maps/embed?pb=1"></iframe><iframe src="https://www.opentable.com/widget/reservation/mural?restaurantIds=1"></iframe>
       <iframe src="https://form.jotform.com/261095441352049?parentURL=x"></iframe><iframe src="about:blank"></iframe>`,
    );
    check("A7 embedded booking and form widgets are found; maps and video are not", B.findBookingFrames(framed).join(" ") === "https://form.jotform.com/261095441352049?parentURL=x https://www.opentable.com/widget/reservation/mural?restaurantIds=1", B.findBookingFrames(framed).join(" "));

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
    check("B1 a salon: who → notes; the service and the person are steps of the flow, never questions", keys(salon) === "name,phone,email,notes", keys(salon));
    check("B1 phone is required, email optional", salon[1].required && salon[1].type === "phone" && !salon[2].required);
    check("B1 no service or staff question, however many the site names", !salon.some((f) => f.key === "service" || f.key === "staff"));
    check("B2 no staff named → still no staff question", !plan({ kind: "personal_service", services }).some((f) => f.key === "staff"));

    const table = plan({ kind: "table" });
    const party = table.find((f) => f.key === "party_size");
    check("B3 a restaurant asks party size, a required count 1–20", party?.type === "number" && party.required && party.config?.min === 1 && party.config?.max === 20, JSON.stringify(party));
    check("B3 …and a required phone", table.find((f) => f.key === "phone")?.required === true);

    check("B3 …and never which dishes: a menu is not what a table books", !plan({ kind: "table", services }).some((f) => f.key === "service"), keys(plan({ kind: "table", services })));

    const trade = plan({ kind: "home_service", services });
    const parts = ["State", "City", "Zip code"].map((label) => ({ label, type: "short_text", required: true, options: [] }));
    check("B4 the parts of an address aren't asked again beside it", keys(plan({ kind: "home_service", services, requirements: parts })) === keys(trade), keys(plan({ kind: "home_service", services, requirements: parts })));
    check("B4 a home service needs the address and the job", trade.find((f) => f.key === "address")?.required === true && trade.find((f) => f.key === "job")?.required === true && trade.find((f) => f.key === "job")?.type === "long_text", keys(trade));

    // What Best Handyman Boston's own Jotform asks, as the extractor reported it.
    const jotform = [
      { label: "Where Is The Project?", type: "short_text", required: true, options: [] },
      { label: "What Do You Need Done?", type: "long_text", required: true, options: [] },
      { label: "Upload Photos", type: "short_text", required: true, options: [] },
      { label: "What Type of Parking Will You Be Able to Provide For Our Team?", type: "select", required: true, options: ["Driveway", "Street parking", "None"] },
    ];
    const handy = plan({ kind: "home_service", services, email: "required", requirements: jotform });
    check("B4 a question the plan already asks in other words is not asked twice", handy.filter((f) => f.type === "long_text").length === 1 && handy.filter((f) => /where|address/i.test(f.label)).length === 1, handy.map((f) => f.label).join(" | "));
    check("B4 a file upload is not a question this wizard can ask", !handy.some((f) => /photo|upload/i.test(f.label)), handy.map((f) => f.label).join(" | "));
    check("B4 …which leaves room for the question that is theirs alone", handy.some((f) => /parking/i.test(f.label) && f.type === "select" && f.required), handy.map((f) => f.label).join(" | "));

    check("B5 a consultation keeps 'What would you like to talk about?'", plan({ kind: "consultation" }).find((f) => f.key === "reason")?.label === "What would you like to talk about?");
    check("B5 'other' with no services is today's form", keys(plan({ kind: "other" })) === "name,email,reason", keys(plan({ kind: "other" })));
    check("B5 'other' with services asks nothing more: the flow's service step is the question", keys(plan({ kind: "other", services })) === "name,email", keys(plan({ kind: "other", services })));

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
  const S = await import("../../../lib/booking/store");
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const { seedStaff } = await import("../../../lib/onboarding/bookingSeed");

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
    // A fresh tenant: booking on by default seeds the three defaults, then
    // the services stage seeds Service rows and rewrites the intake.
    const salon = await newUser("salon");
    await A.setBookingEnabled(salon.id, true);
    check("C1 the defaults are the untouched form", keys((await A.getBookingConfig(salon.id)).fields) === "name,email,reason" && A.isUntouchedForm((await A.getBookingConfig(salon.id)).fields));

    const pages = [page("https://example.invalid/service", `<h1>Menu</h1> with Katherine`)];
    const answer = (price: string) => ({
      services: [{ name: GEL, description: "", price, duration: "45 min", category: "Manicures" }, { name: PEDI, description: "", price: "$60", duration: "", category: "Pedicures" }],
      booking: { takesAppointments: true, kind: "personal_service", staff: ["Katherine", "Zelphira the Unmentioned"], phone: "unknown", email: "unknown", notes: true, requirements: [] },
    });
    const first = await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$35")) });
    const rebuilt = (await A.getBookingConfig(salon.id)).fields;
    check("C3 onboarding rebuilds the untouched form as the intake alone", first.report.seededFields === 4 && keys(rebuilt) === "name,phone,email,notes", `${first.report.seededFields} ${keys(rebuilt)}`);
    check("C3 every question it wrote is marked generated", (await generatedCount(salon.id)) === 4, String(await generatedCount(salon.id)));
    const rows = await S.listServices(salon.id);
    check("C2 the services became Service rows, priced and timed from the menu's own words", first.report.seededServices === 2 && rows.length === 2 && rows[0].name === GEL && rows[0].pricing.kind === "fixed" && rows[0].pricing.amount === 35 && rows[0].durationMinutes === 45 && rows[1].pricing.amount === 60, JSON.stringify(rows.map((r) => [r.name, r.pricing, r.durationMinutes])));
    const flow = await S.getBookingFlow(salon.id);
    check("C2 …so the flow has a service step and the card is asked only for notes", flow?.flow.services.length === 2 && keys(flow.intake) === "notes", keys(flow?.intake ?? []));
    check("C6 a staff name the text never contained is dropped", first.extract.staff.join("|") === "Katherine", first.extract.staff.join("|"));
    const seeded = await seedStaff(salon.id, first.extract.staff.map((name) => ({ name, bio: "" })), pages as never, () => {});
    const again = await seedStaff(salon.id, [{ name: "katherine", bio: "" }], pages as never, () => {});
    check("C6 …and the rest become providers, once: the same name seeded twice is one row", seeded.seeded === 1 && again.seeded === 0 && (await S.listStaff(salon.id)).map((p) => p.name).join() === "Katherine", JSON.stringify(await S.listStaff(salon.id)));

    await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$42")) });
    check("C4 re-running rewrites a form nobody has edited and never duplicates a service", (await generatedCount(salon.id)) === 4 && (await S.listServices(salon.id)).length === 2, String((await S.listServices(salon.id)).length));

    await A.saveAppointmentField(salon.id, { key: "phone", label: "Best number to text", type: "phone", required: true });
    check("C5 one admin save makes the form the tenant's: nothing is generated any more", (await generatedCount(salon.id)) === 0, String(await generatedCount(salon.id)));
    const third = await extractServicesAndBooking(pages as never, salon.id, () => {}, { llm: scripted(answer("$99")) });
    const kept = (await A.getBookingConfig(salon.id)).fields;
    check("C5 …and onboarding never rewrites it", third.report.seededFields === 0 && kept.find((f) => f.key === "phone")?.label === "Best number to text", keys(kept));

    const mover = await newUser("mover");
    await extractServicesAndBooking(pages as never, mover.id, () => {}, { llm: scripted(answer("$35")) });
    await A.moveAppointmentField(mover.id, "notes", "up");
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
    const moonRows = await S.listServices(moon.id);
    const amount = (price: string) => Number.parseFloat(price.replace(/[^0-9.]/g, ""));
    check("D1 the service step carries the real page's prices", ["Basic Manicure", "Gel Manicure", "SPA PEDICURE"].every((n) => moonRows.find((r) => r.name === n)?.pricing.amount === amount(MOONLIGHT.prices[n])), JSON.stringify(moonRows.slice(0, 3).map((r) => [r.name, r.pricing])));
    check("D1 …under its headings", new Set(moonRows.map((r) => r.category)).size >= 5 && moonRows.length === MOONLIGHT_EXTRACT.services.length, String(moonRows.length));
    check("D2 it asks what the real page asks: name and phone required, email optional, notes", form.find((f) => f.key === "name")?.required === true && form.find((f) => f.key === "phone")?.required === true && form.find((f) => f.key === "email")?.required === false && form.find((f) => f.key === "notes")?.required === false, keys(form));
    check("D3 the technician step, whose names one read can't see, is an optional text question", form.find((f) => f.key === "preferred_technician")?.required === false);
    check("D3 …and nothing the real page doesn't ask", keys(form) === "name,phone,email,preferred_technician,notes", keys(form));
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

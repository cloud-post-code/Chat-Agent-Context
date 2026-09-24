/**
 * Primary proof for booking-setup-in-chat (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/booking-flow/tsconfig.proof.json docs/features/booking-setup-in-chat/proof.ts
 *
 * A: the pure rules — image matching, the intake trim, the plan. B: the
 * store against the local dev Postgres under throwaway users — the card's
 * block carries only the trimmed intake, seeding merges by name, the chat's
 * booking review round-trips, and a restart wipes the booking setup. C: the
 * card and the admin editors rendered to static markup. Zero model calls;
 * everything made is deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as cheerio from "cheerio";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
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
const keys = (rows: { key: string }[]) => rows.map((r) => r.key).join(",");
const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

async function main() {
  // ══ A. The rules ═══════════════════════════════════════════════════════
  console.log("A. The rules (lib/booking/matchImages.ts, lib/booking/store.ts trimIntake, lib/bookingFormPlan.ts)");
  {
    const M = await import("../../../lib/booking/matchImages");
    const photos = [
      { src: "hero.jpg", text: "Our Massage Services — relax with us" },
      { src: "deep.jpg", text: "Deep tissue massage on a client's back" },
      { src: "swedish.jpg", text: "Swedish massage room" },
    ];
    check("A1 a one-word overlap with a page heading is not a picture of the service", M.bestImageFor("Hot Stone Massage", photos) === null, String(M.bestImageFor("Hot Stone Massage", photos)));
    check("A1 a caption that names the service is", M.bestImageFor("Deep Tissue Massage", photos) === "deep.jpg" && M.bestImageFor("Swedish Massage", photos) === "swedish.jpg");
    check("A1 words needed: all of one or two, most of more", M.wordsNeeded(1) === 1 && M.wordsNeeded(2) === 2 && M.wordsNeeded(3) === 2 && M.wordsNeeded(5) === 3);
    const taken = new Set(["deep.jpg"]);
    check("A1 a photo already matched is never handed out again", M.bestImageFor("Deep Tissue Massage", photos, taken) === null);

    const { trimIntake } = await import("../../../lib/booking/store");
    const fields = ["name", "email", "phone", "service", "staff", "notes"].map((key, order) => ({ key, label: key, type: "short_text" as const, required: false, order, config: {} }));
    check("A2 with a service step and providers the card is asked only what the flow has no step for", keys(trimIntake(fields, { hasServiceStep: true, hasProviderStep: true })) === "notes");
    check("A2 an older tenant's stored service or staff question stays only while the flow lacks that step", keys(trimIntake(fields, { hasServiceStep: false, hasProviderStep: false })) === "service,staff,notes");

    const P = await import("../../../lib/bookingFormPlan");
    const plan = P.planBookingForm({ kind: "personal_service", services: [{ name: "Cut", description: "" }], staff: ["Ann"], phone: "unknown", email: "unknown", notes: true, requirements: [{ label: "Preferred stylist", type: "select", required: false, options: ["Ann", "Bo"] }] });
    check("A3 the plan never asks for the service or the person: those are steps", !plan.some((f) => f.key === "service" || f.key === "staff" || /stylist/i.test(f.label)), keys(plan));
  }

  // ══ B. The store ═══════════════════════════════════════════════════════
  console.log("B. The store (real Postgres, zero model calls)");
  const { prisma } = await import("../../../lib/db");
  const S = await import("../../../lib/booking/store");
  const A = await import("../../../lib/appointments");
  const C = await import("../../../lib/cards");
  const R = await import("../../../lib/onboarding/bookingReview");
  const Seed = await import("../../../lib/onboarding/bookingSeed");
  const { wipeAccountContent } = await import("../../../lib/accountReset");
  const made: string[] = [];
  const newUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: { email: `proof-booking-setup-${tag}-${Date.now()}@example.invalid`, name: `Proof ${tag}`, slug: `proof-booking-setup-${tag}-${Date.now()}`, passwordHash: "", onboardedAt: new Date() },
    });
    made.push(u.id);
    return u;
  };
  try {
    const salon = await newUser("salon");
    await A.setBookingEnabled(salon.id, true);
    await A.deleteAppointmentField(salon.id, "reason");
    for (const key of ["name", "phone", "email", "staff", "notes"]) {
      await A.saveAppointmentField(salon.id, { key, label: key, type: key === "email" ? "email" : key === "phone" ? "phone" : "short_text", required: key === "name" });
    }
    await S.saveService(salon.id, { name: "Gel Manicure", pricing: { kind: "fixed", amount: 35 }, durationMinutes: 45 });
    await S.saveStaff(salon.id, { name: "Katherine", role: "Nail tech" });
    const block = await C.bookingBlock(salon.id);
    check("B1 the block show_booking draws carries only the trimmed intake, never name/email/phone/staff again", block?.type === "booking" && keys(block.fields) === "notes" && block.flow?.services.length === 1 && block.flow.staff.length === 1, block?.type === "booking" ? keys(block.fields) : String(block));
    check("B1 the services card's Book button carries the same flow", (await C.servicesBlock(salon.id))?.type === "services" && ((await C.servicesBlock(salon.id)) as { booking: { flow: unknown } | null }).booking?.flow !== null);
    await A.setBookingEnabled(salon.id, false);
    check("B1 booking off is no block at all", (await C.bookingBlock(salon.id)) === null);
    await A.setBookingEnabled(salon.id, true);

    // Seeding merges by name and hands one image to one service.
    const pages = [page("https://example.invalid/services", `
      <h2>Our Manicure Services</h2><img src="/hero.jpg" alt="Our manicure services" width="800" height="400">
      <h3>Gel Manicure</h3><img src="/gel.jpg" alt="Gel manicure" width="800" height="400">
      <h3>Spa Pedicure</h3><img src="/pedi.jpg" alt="Spa pedicure" width="800" height="400">`)];
    const downloaded: string[] = [];
    const download = async (url: string) => {
      downloaded.push(url);
      return { filename: `${url.split("/").pop()}` };
    };
    const seeded = await Seed.seedServices(salon.id, [
      { name: "gel manicure!", description: "", price: "$40" },
      { name: "Spa Pedicure", description: "", price: "$60" },
      { name: "Dip Powder", description: "", price: "$45" },
    ], pages as never, () => {}, { download });
    const rows = await S.listServices(salon.id);
    check("B2 a service already on file is left as it is; new ones are added — no duplicates", seeded.seeded === 2 && rows.length === 3 && rows[0].pricing.amount === 35, JSON.stringify(rows.map((r) => [r.name, r.pricing.amount])));
    check("B2 a photo attaches only where a caption names the service, and only once", downloaded.join() === "https://example.invalid/pedi.jpg" && rows.find((r) => r.name === "Spa Pedicure")?.imageUrl === "/api/uploads/pedi.jpg" && rows.find((r) => r.name === "Dip Powder")?.imageUrl === null, downloaded.join());
    const staff = await Seed.seedStaff(salon.id, [{ name: "KATHERINE", bio: "" }, { name: "Vivian", bio: "Senior Stylist — ten years in." }], pages as never, () => {}, { download });
    const people = await S.listStaff(salon.id);
    check("B2 providers merge by name too; a bio's opening title becomes the role", staff.seeded === 1 && people.map((p) => p.name).join() === "Katherine,Vivian" && people[1].role === "Senior Stylist" && people[0].role === "Nail tech", JSON.stringify(people.map((p) => [p.name, p.role])));

    // The chat's booking review round-trips through the same store.
    const review = await R.readBookingReview(salon.id);
    check("B3 the review reads what was seeded", review.services.length === 3 && review.services[0].pricingKind === "fixed" && review.services[0].amount === "35" && review.staff.length === 2 && review.staffSelection === "optional" && review.bookingEnabled);
    const saved = await R.saveBookingReview(salon.id, {
      services: [
        { id: review.services[0].id, name: "Gel Manicure", pricingKind: "starting_at", amount: "38", durationMinutes: "60", enabled: true },
        { id: review.services[2].id, name: "Dip Powder", pricingKind: "fixed", amount: "45", enabled: false },
        { name: "Brow Wax", pricingKind: "fixed", amount: "12", durationMinutes: 15 },
      ],
      removedServiceIds: [review.services[1].id, "not-mine"],
      staff: [{ id: review.staff[0].id, name: "Katherine", role: "Owner", enabled: true }, { name: "Trang" }],
      removedStaffIds: [review.staff[1].id],
      staffSelection: "required",
      bookingEnabled: true,
    });
    const after = await R.readBookingReview(salon.id);
    const gel = after.services.find((s) => s.name === "Gel Manicure");
    check("B3 edits land as partial patches: price, length and on/off change, the photo stays", saved.services === 3 && gel?.pricingKind === "starting_at" && gel.amount === "38" && gel.durationMinutes === 60 && after.services.find((s) => s.name === "Dip Powder")?.enabled === false && after.services.find((s) => s.name === "Spa Pedicure") === undefined && after.services.some((s) => s.name === "Brow Wax"), JSON.stringify(after.services));
    check("B3 providers: renamed role, one removed, one added, and the rule saved", after.staff.map((p) => `${p.name}:${p.role}`).join() === "Katherine:Owner,Trang:" && after.staffSelection === "required", JSON.stringify(after.staff));
    const spa = (await S.listServices(salon.id)).find((r) => r.name === "Spa Pedicure");
    check("B3 a removed service is gone from the store, a foreign id is ignored", spa === undefined && (await S.listServices(salon.id)).length === 3);
    const flowAfter = await S.getBookingFlow(salon.id);
    check("B3 the flow the visitor gets now offers only enabled services and requires a provider", flowAfter?.flow.services.map((s) => s.name).join() === "Gel Manicure,Brow Wax" && flowAfter.flow.rules.staffSelection === "required", flowAfter?.flow.services.map((s) => s.name).join());

    // Restart onboarding wipes the booking setup with everything else.
    await prisma.appointment.create({ data: { userId: salon.id, startsAt: new Date(Date.now() + 86_400_000), serviceName: "Gel Manicure" } });
    await prisma.menuItem.create({ data: { userId: salon.id, key: "latte", name: "Latte" } });
    await prisma.order.create({ data: { userId: salon.id } });
    await prisma.bookingLocation.create({ data: { userId: salon.id, name: "Main St" } });
    await S.saveBookingSettings(salon.id, { staffSelection: "hidden" });
    await prisma.profile.update({ where: { userId: salon.id }, data: { bookingEnabled: false, company_name: "Salon" } });
    await wipeAccountContent(salon.id);
    const counts = await Promise.all([
      prisma.service.count({ where: { userId: salon.id } }),
      prisma.staffMember.count({ where: { userId: salon.id } }),
      prisma.bookingLocation.count({ where: { userId: salon.id } }),
      prisma.bookingSettings.count({ where: { userId: salon.id } }),
      prisma.appointmentField.count({ where: { userId: salon.id } }),
      prisma.appointment.count({ where: { userId: salon.id } }),
      prisma.menuItem.count({ where: { userId: salon.id } }),
      prisma.order.count({ where: { userId: salon.id } }),
    ]);
    const profile = await prisma.profile.findUnique({ where: { userId: salon.id } });
    const user = await prisma.user.findUnique({ where: { id: salon.id } });
    check("B4 a restart leaves no service, provider, location, rule, question, appointment, menu item or order", counts.every((n) => n === 0), counts.join());
    check("B4 …the profile is blank with booking back on, onboarding is due again, and the defaults are back", profile?.company_name === "" && profile.bookingEnabled === true && user?.onboardedAt === null && (await prisma.personaConfig.count({ where: { userId: salon.id } })) === 1 && (await prisma.ingestionSource.count({ where: { userId: salon.id } })) > 0);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    check("Z no proof users left behind", (await prisma.user.count({ where: { email: { startsWith: "proof-booking-setup-" } } })) === 0);
    await prisma.$disconnect();
  }

  // ══ C. The card and the editors, rendered ═══════════════════════════════
  console.log("C. The card and the admin editors, rendered to static markup");
  {
    const { Cards } = await import("../../../app/cards/Cards");
    const T = await import("../../../lib/booking/types");
    const settings = T.sanitizeBookingSettings({});
    const service = (id: string, name: string, imageUrl: string | null): T.ServiceRow => ({
      id, name, category: "", description: "", imageUrl, images: [], pricing: { kind: "fixed", amount: 45 }, durationMinutes: 45,
      addons: [], variants: [], deposit: { kind: "none" }, modes: ["in_person"], staffIds: [], locationIds: [], eligibility: "", preparation: "",
      cancellationPolicy: "", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true,
    });
    const flow: T.BookingFlow = {
      business: { name: "Proof", timezone: "America/New_York", currency: "USD", phone: "" },
      services: [service("a", "Haircut", "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg"), service("b", "Color", null)],
      categories: [], staff: [], locations: [], rules: T.publicRules(settings), preselect: { serviceId: null },
    };
    const html = renderToStaticMarkup(React.createElement(Cards, { block: { type: "booking", fields: [], flow }, slug: "proof" }));
    const $ = cheerio.load(html);
    check("C1 the service step is a list: a thumbnail only where there is a photo, no placeholder blocks", $('[role="list"] [role="button"]').length === 2 && $("img").length === 1 && $('[data-testid="placeholder-image"]').length === 0, `${$("img").length} img`);

    const { ServiceForm } = await import("../../../app/admin/booking/ServiceForm");
    const svc = { ...service("a", "Haircut", null), category: "Hair", variants: [{ id: "long", name: "Long hair", pricing: { kind: "fixed" as const, amount: 65 }, durationMinutes: 60 }], addons: [{ id: "beard", name: "Beard trim", price: 10, durationMinutes: 15 }] };
    const form = cheerio.load(renderToStaticMarkup(React.createElement(ServiceForm, { service: svc, staff: [], locations: [], categories: ["Hair", "Color"] })));
    const names = form("select").map((_, el) => form(el).attr("name") ?? "").get().filter(Boolean);
    check("C2 the service editor's known-answer fields are dropdowns", ["pricingKind", "durationMinutes", "bufferBeforeMinutes", "bufferAfterMinutes", "depositKind", "enabled"].every((n) => names.includes(n)), names.join());
    check("C2 the category is a dropdown of the tenant's categories with a way to add one", form("select").filter((_, el) => form(el).find("option[value='Hair']").length > 0 && form(el).find("option[value='__new__']").length > 0).length === 1 && form("input[name='category']").attr("value") === "Hair");
    check("C2 variants and add-ons are rows that post the same lines the action parses", form("input[name='variants']").attr("value") === "Long hair | $65 | 60" && form("input[name='addons']").attr("value") === "Beard trim | 10 | 15", `${form("input[name='variants']").attr("value")} / ${form("input[name='addons']").attr("value")}`);
    check("C2 no pipe-separated textarea is left for the owner to type", form("textarea[name='variants'], textarea[name='addons']").length === 0);

    const { HoursPanel } = await import("../../../app/admin/booking/HoursPanel");
    const hours = cheerio.load(renderToStaticMarkup(React.createElement(HoursPanel, { settings: { ...settings, holidays: [{ date: "2026-12-25", label: "Christmas" }] } })));
    check("C3 hours & rules: advance window, gaps, default length, confirmation and provider picking are dropdowns, each under its own label", ["maxAdvanceDays", "bufferBeforeMinutes", "bufferAfterMinutes", "defaultDurationMinutes", "confirmation", "staffSelection"].every((n) => hours(`select[name='${n}']`).length === 1) && hours("label").filter((_, el) => /picking a provider/i.test(hours(el).text())).length === 1);
    check("C3 holidays are date rows posting the same lines", hours("input[name='holidays']").attr("value") === "2026-12-25 | Christmas" && hours("input[type='date']").length === 1);

    const { ServicesSetupCard, ProvidersSetupCard } = await import("../../../app/admin/onboarding/BookingSetupCard");
    const setup = cheerio.load(renderToStaticMarkup(React.createElement(ServicesSetupCard, {
      services: [{ id: "a", name: "Haircut", category: "", pricingKind: "fixed", amount: "45", maxAmount: "", durationMinutes: "45", enabled: true, imageUrl: null }],
      onChange: () => {}, onDone: () => {}, busy: false,
    })));
    check("C4 the chat's services review: price kind, length and bookable are dropdowns, the name is typed", setup("select").length === 3 && setup("input[aria-label='Service name']").attr("value") === "Haircut" && setup("button").filter((_, el) => /Done — 1 service/.test(setup(el).text())).length === 1);
    const providers = cheerio.load(renderToStaticMarkup(React.createElement(ProvidersSetupCard, {
      staff: [{ id: "k", name: "Katherine", role: "", enabled: true, photoUrl: null }], staffSelection: "optional", onChange: () => {}, onSelection: () => {}, onDone: () => {}, busy: false,
    })));
    check("C4 the providers review asks whether visitors pick who they see", providers("select[aria-label='Picking a provider'] option").length === 3 && providers("input[aria-label='Provider name']").attr("value") === "Katherine");
  }

  console.log(failures ? `\n${failures} check(s) failed (${passes} passed).` : `\nAll ${passes} checks passed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

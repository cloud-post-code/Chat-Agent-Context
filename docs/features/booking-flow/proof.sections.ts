/**
 * Sections B–D of the booking-flow proof (see proof.ts, which runs them).
 * Split out so the pure section A stays readable and this file can import
 * the store, the engines and the real card.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as cheerioLib from "cheerio";
import type * as CheerioModule from "cheerio";
import type {
  BookingFlow,
  BookingSettings,
  LocationRow,
  ServiceRow,
  StaffRow,
} from "../../../lib/booking/types";

type Check = (name: string, ok: boolean, detail?: string) => void;

const HOURS = { start: "09:00", end: "17:00" };

function weekdays(): BookingSettings["hours"] {
  return { mon: [HOURS], tue: [HOURS], wed: [HOURS], thu: [HOURS], fri: [HOURS], sat: [], sun: [] };
}

// ══ B. The engines ═══════════════════════════════════════════════════════
export async function sectionB(check: Check, TZ: string) {
  console.log("B. The engines (time, availability, pricing, hours)");
  const T = await import("../../../lib/booking/types");
  const time = await import("../../../lib/booking/time");
  const A = await import("../../../lib/booking/availability");
  const P = await import("../../../lib/booking/pricing");
  const H = await import("../../../lib/booking/hours");

  // Time: DST in both directions, calendar arithmetic without drift.
  check("B1 09:00 New York on the spring-forward day is 13:00Z", time.zonedToUtc("2026-03-08", "09:00", TZ).toISOString() === "2026-03-08T13:00:00.000Z");
  check("B1 09:00 New York on the fall-back day is 14:00Z", time.zonedToUtc("2026-11-01", "09:00", TZ).toISOString() === "2026-11-01T14:00:00.000Z");
  check("B1 shiftDays crosses a month without drift", time.shiftDays("2026-01-31", 1) === "2026-02-01" && time.shiftDays("2026-03-01", -1) === "2026-02-28");
  const parts = time.zonedParts(new Date("2026-10-06T12:00:00Z"), TZ);
  check("B1 zonedParts reads the wall clock in the zone", parts.date === "2026-10-06" && parts.hh === 8 && parts.weekday === "tue");

  const settings = T.sanitizeBookingSettings({
    timezone: TZ,
    hours: weekdays(),
    holidays: [{ date: "2026-10-12", label: "Closed" }],
    slotIntervalMinutes: 30,
    leadTimeMinutes: 60,
    maxAdvanceDays: 30,
    sameDayBooking: true,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    dailyCutoff: "15:00",
  });
  const service: ServiceRow = {
    id: "svc", name: "Haircut", category: "Hair", description: "", imageUrl: null, images: [],
    pricing: { kind: "fixed", amount: 45 }, durationMinutes: 60, addons: [{ id: "beard", name: "Beard trim", price: 10, durationMinutes: 15 }],
    variants: [{ id: "long", name: "Long hair", pricing: { kind: "fixed", amount: 65 } }], deposit: { kind: "percent", amount: 20 },
    modes: ["in_person", "mobile"], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true,
  };
  const staffA: StaffRow = { id: "a", name: "Sarah", role: "", bio: "", photoUrl: null, specialties: [], languages: [], credentials: [], genderLabel: "", hours: null, timeOff: [], priceOverrides: { svc: 55 }, durationOverrides: {}, order: 0, enabled: true };
  const staffB: StaffRow = { ...staffA, id: "b", name: "Tom", priceOverrides: {}, hours: { ...weekdays(), wed: [{ start: "12:00", end: "17:00" }] } };
  const mobile: LocationRow = { id: "mob", name: "Mobile", kind: "mobile", address: "", phone: "", timezone: "", hours: null, serviceArea: { postalCodes: ["78701"], travelFee: 15 }, meetingLink: "", note: "", capacity: 1, priceOverrides: { svc: 50 }, order: 1, enabled: true };
  const room2: LocationRow = { ...mobile, id: "room", name: "Studio", kind: "business", serviceArea: { postalCodes: [] }, capacity: 2, priceOverrides: {} };

  // Tuesday 2026-10-06, 08:00 New York.
  const now = new Date("2026-10-06T12:00:00Z");
  const base = { settings, service, durationMinutes: 60, staff: [] as StaffRow[], location: null, booked: [], now };
  const wed = "2026-10-07";
  const slots = A.availableSlots(base, wed);
  check("B2 a nine-to-five day holds fifteen hour-long starts on the half hour", slots.length === 15 && slots[0].startsAt === time.zonedToUtc(wed, "09:00", TZ).toISOString() && slots[14].startsAt === time.zonedToUtc(wed, "16:00", TZ).toISOString(), String(slots.length));
  const booked = [{ startsAt: time.zonedToUtc(wed, "10:00", TZ), endsAt: time.zonedToUtc(wed, "11:00", TZ), staffId: null, locationId: null, status: "confirmed" }];
  const around = A.availableSlots({ ...base, booked }, wed).map((s) => time.zonedParts(new Date(s.startsAt), TZ).hh * 60 + time.zonedParts(new Date(s.startsAt), TZ).mm);
  check("B2 a booking removes every start that would overlap it", !around.includes(9 * 60 + 30) && !around.includes(10 * 60) && !around.includes(10 * 60 + 30) && around.includes(11 * 60) && around.includes(9 * 60));
  check("B2 a holiday is closed", A.availableSlots(base, "2026-10-12").length === 0);
  check("B2 the weekend is closed", A.availableSlots(base, "2026-10-10").length === 0);
  const todaySlots = A.availableSlots({ ...base, now: new Date("2026-10-06T13:15:00Z") }, "2026-10-06");
  check("B2 lead time pushes today's first slot past now plus an hour", todaySlots[0]?.startsAt === time.zonedToUtc("2026-10-06", "10:30", TZ).toISOString(), todaySlots[0]?.startsAt);
  check("B2 same-day off closes today", A.availableSlots({ ...base, settings: { ...settings, sameDayBooking: false } }, "2026-10-06").length === 0);
  check("B2 after the daily cutoff, tomorrow is closed", A.availableSlots({ ...base, now: new Date("2026-10-06T20:00:00Z") }, wed).length === 0 && A.availableSlots({ ...base, now: new Date("2026-10-06T20:00:00Z") }, "2026-10-08").length > 0);
  check("B2 past the advance window is closed", A.availableSlots(base, "2026-11-10").length === 0);
  const withBuffer = A.availableSlots({ ...base, booked, settings: { ...settings, bufferAfterMinutes: 30 } }, wed).map((s) => time.zonedParts(new Date(s.startsAt), TZ).hh * 60 + time.zonedParts(new Date(s.startsAt), TZ).mm);
  check("B2 a buffer keeps the next booking off the heels of the last", !withBuffer.includes(11 * 60) && withBuffer.includes(11 * 60 + 30));
  const days = A.availableDays(base, "2026-10");
  check("B2 the month lists every day, open ones counted", days.length === 31 && days.find((d) => d.date === "2026-10-12")?.open === false && days.find((d) => d.date === wed)?.slots === 15);
  check("B2 earliest slot is the first open one from now", A.earliestSlot(base)?.startsAt === time.zonedToUtc("2026-10-06", "09:00", TZ).toISOString());

  // Providers as the resource.
  // Tom's narrowed Wednesday is for the "own hours" check; here both work the full day.
  const two = { ...base, staff: [staffA, { ...staffB, hours: null }] };
  const bookedA = [{ startsAt: time.zonedToUtc(wed, "10:00", TZ), endsAt: time.zonedToUtc(wed, "11:00", TZ), staffId: "a", locationId: null, status: "confirmed" }];
  const ten = time.zonedToUtc(wed, "10:00", TZ);
  const at10 = A.availableSlots({ ...two, booked: bookedA }, wed).find((s) => s.startsAt === ten.toISOString());
  check("B3 with one provider booked the slot stays open for the other", at10?.staffIds.join() === "b");
  check("B3 a provider's own hours narrow their slots", A.availableSlots({ ...base, staff: [staffB] }, wed)[0]?.startsAt === time.zonedToUtc(wed, "12:00", TZ).toISOString());
  const assign = A.checkSlot(two, ten);
  check("B3 'anyone' gets a provider assigned", assign.ok && assign.staffId !== null);
  const bothBooked = [...bookedA, { ...bookedA[0], staffId: "b" }];
  const full = A.checkSlot({ ...two, booked: bothBooked }, ten);
  check("B3 every provider taken is full (waitlist-eligible)", !full.ok && full.full === true);
  const offGrid = A.checkSlot(two, time.zonedToUtc(wed, "10:10", TZ));
  check("B3 an instant off the grid is refused but not 'full'", !offGrid.ok && offGrid.full === false);
  const timeOff = { ...staffA, timeOff: [{ start: time.zonedToUtc(wed, "00:00", TZ).toISOString(), end: time.zonedToUtc("2026-10-08", "00:00", TZ).toISOString() }] };
  check("B3 time off closes the provider's day", A.availableSlots({ ...base, staff: [timeOff] }, wed).length === 0);

  // Rooms as the resource.
  const roomBooked = [{ startsAt: ten, endsAt: time.zonedToUtc(wed, "11:00", TZ), staffId: null, locationId: "room", status: "confirmed" }];
  const roomSlot = A.checkSlot({ ...base, location: room2, booked: roomBooked }, ten);
  const roomFull = A.checkSlot({ ...base, location: room2, booked: [...roomBooked, ...roomBooked] }, ten);
  check("B4 a two-chair location takes two bookings at once and no more", roomSlot.ok && !roomFull.ok && roomFull.full === true);

  // Pricing.
  const price = (over: Partial<P.PriceInput>) =>
    P.priceBreakdown({ service, variant: null, addons: [], quantity: 1, staff: null, location: null, mode: "in_person", settings, promo: null, membership: null, tipPercent: null, tipAmount: null, ...over });
  const plain = price({});
  check("B5 a fixed service prices as itself", plain.total === 45 && plain.display === "$45" && !plain.estimate);
  const loaded = price({ addons: service.addons, location: mobile, mode: "mobile", promo: { code: "WELCOME10", kind: "percent", amount: 10, serviceIds: [], expiresOn: "", note: "" }, settings: { ...settings, taxRate: 10, serviceFee: { kind: "fixed", amount: 2, label: "Booking fee" } }, tipPercent: 20 });
  const kinds = loaded.lines.map((l) => l.kind);
  check("B5 lines come in order: service, add-on, travel, promo, fee, tax, tip", kinds.join(",") === "service,addon,travel,promo,fee,tax,tip", kinds.join(","));
  const sum = Math.round(loaded.lines.reduce((a, l) => a + (l.amount ?? 0), 0) * 100) / 100;
  check("B5 the total is the sum of its lines", loaded.total === sum, `${loaded.total} vs ${sum}`);
  check("B5 the location's price applies when no provider overrides it", loaded.lines[0].amount === 50);
  check("B5 travel fee and promo are what they say", loaded.lines[2].amount === 15 && loaded.lines[3].amount === -7.5);
  check("B5 deposit is a fifth of the total", loaded.deposit === Math.round(loaded.total * 20) / 100 && loaded.balance === Math.round((loaded.total - loaded.deposit!) * 100) / 100);
  check("B5 a provider's price beats the location's", price({ staff: staffA, location: mobile }).lines[0].amount === 55);
  check("B5 a variant's own price is what the visitor was shown", price({ variant: service.variants[0], staff: staffA }).lines[0].amount === 65);
  const perPerson = price({ service: { ...service, pricing: { kind: "per_person", amount: 12 } }, quantity: 3 });
  check("B5 per person multiplies", perPerson.lines[0].amount === 36 && perPerson.total === 36);
  const from = price({ service: { ...service, pricing: { kind: "starting_at", amount: 45 } } });
  check("B5 'starting at' is an estimate shown as From", from.estimate && from.display.startsWith("From"));
  const quote = price({ service: { ...service, pricing: { kind: "quote" } }, addons: service.addons });
  check("B5 a quote promises nothing but the add-ons", quote.quoteRequired && quote.display === "Quote" && quote.total === 10);
  const member = price({ membership: { id: "gold", name: "Gold", discountPercent: 50 } });
  check("B5 membership halves it", member.total === 22.5);
  check("B5 hourly duration scales with hours", P.durationFor({ service: { ...service, pricing: { kind: "hourly", amount: 40 } }, variant: null, addons: [], staff: null, settings, quantity: 2 }) === 120);
  check("B5 add-ons add minutes", P.durationFor({ service, variant: null, addons: service.addons, staff: null, settings }) === 75);
  check("B5 findPromo matches loosely and honours expiry", P.findPromo({ ...settings, promoCodes: [{ code: "WELCOME10", kind: "percent", amount: 10, serviceIds: [], expiresOn: "2026-01-01", note: "" }] }, "welcome10", "svc", "2026-10-06") === null && P.findPromo({ ...settings, promoCodes: [{ code: "WELCOME10", kind: "percent", amount: 10, serviceIds: ["other"], expiresOn: "", note: "" }] }, "welcome10", "svc", "2026-10-06") === null && P.findPromo({ ...settings, promoCodes: [{ code: "WELCOME10", kind: "percent", amount: 10, serviceIds: [], expiresOn: "", note: "" }] }, "welcome10", "svc", "2026-10-06")?.code === "WELCOME10");

  // Hours from a site's own words.
  check("B6 '9 AM–7 PM'", JSON.stringify(H.parseHoursText("9 AM–7 PM")) === '[{"start":"09:00","end":"19:00"}]');
  check("B6 '9am - 1pm, 2pm - 6pm' is two ranges", H.parseHoursText("9am - 1pm, 2pm - 6pm").length === 2);
  check("B6 'Closed' and '' are closed", H.parseHoursText("Closed").length === 0 && H.parseHoursText("").length === 0);
  const wk = H.weeklyHoursFrom({ monday: "9 AM–7 PM", tuesday: "Closed", saturday: "10 - 4" });
  check("B6 weekly hours from day names", wk?.mon[0].end === "19:00" && wk?.tue.length === 0 && wk?.sat[0].start === "10:00" && wk?.sat[0].end === "16:00");
  check("B6 all closed is null (use the business hours)", H.weeklyHoursFrom({ monday: "Closed" }) === null);
  check("B6 Austin, TX is Central", H.timezoneFromAddress("500 Congress Ave, Austin, TX 78701") === "America/Chicago");
  check("B6 an address with no state is unknown", H.timezoneFromAddress("12 Rue de Rivoli, Paris") === null);
}

// ══ C. The store, against the real database ══════════════════════════════
export async function sectionC(check: Check, TZ: string, SLUG: string) {
  console.log("C. The store (lib/booking/store.ts), real Postgres, zero model calls");
  const { prisma } = await import("../../../lib/db");
  const S = await import("../../../lib/booking/store");
  const T = await import("../../../lib/booking/types");
  const Ap = await import("../../../lib/appointments");
  const time = await import("../../../lib/booking/time");

  const user = await prisma.user.create({
    data: { email: `${SLUG}@example.invalid`, name: "Proof Salon", slug: SLUG, passwordHash: "x" },
  });
  const legacyUser = await prisma.user.create({
    data: { email: `${SLUG}-legacy@example.invalid`, name: "Proof Legacy", slug: `${SLUG}-legacy`, passwordHash: "x" },
  });
  const menuUser = await prisma.user.create({
    data: { email: `${SLUG}-menu@example.invalid`, name: "Proof Menu", slug: `${SLUG}-menu`, passwordHash: "x" },
  });
  const phoneUser = await prisma.user.create({
    data: { email: `${SLUG}-phone@example.invalid`, name: "Proof Phone", slug: `${SLUG}-phone`, passwordHash: "x" },
  });
  try {
    await prisma.profile.upsert({ where: { userId: user.id }, update: { company_name: "Proof Salon", bookingEnabled: true }, create: { userId: user.id, company_name: "Proof Salon", bookingEnabled: true } });
    // The form: nothing is seeded on enable any more, so the fixture writes
    // the name and email questions the first enable used to — role-tagged,
    // asked together on one screen.
    await Ap.rebuildUntouchedForm(user.id, [
      { key: "name", label: "Your name", type: "short_text", required: true, role: "name", screen: 1 },
      { key: "email", label: "Your email", type: "email", required: true, role: "email", screen: 1 },
    ]);
    await S.saveBookingSettings(user.id, {
      timezone: TZ,
      hours: weekdays(),
      leadTimeMinutes: 60,
      slotIntervalMinutes: 30,
      maxAdvanceDays: 60,
      waitlist: true,
      recurring: true,
      staffSelection: "optional",
      taxRate: 0,
      promoCodes: [{ code: "WELCOME10", kind: "percent", amount: 10 }],
    });
    const settings = await S.getBookingSettings(user.id);
    check("C1 settings round-trip through the sanitizer", settings.timezone === TZ && settings.waitlist && settings.promoCodes[0].code === "WELCOME10");

    const haircut = await S.saveService(user.id, {
      name: "Haircut", category: "Hair", description: "A cut and style.",
      pricing: { kind: "fixed", amount: 45 }, durationMinutes: 45,
      addons: [{ id: "beard", name: "Beard trim", price: 10, durationMinutes: 15 }],
      variants: [{ id: "long", name: "Long hair", pricing: { kind: "fixed", amount: 65 } }],
      deposit: { kind: "percent", amount: 20 }, modes: ["in_person", "mobile"],
      images: ["https://example.invalid/haircut.jpg"],
    });
    const consult = await S.saveService(user.id, { name: "Consultation", category: "Advice", pricing: { kind: "quote" }, durationMinutes: 30, modes: ["online"] });
    check("C2 services save", haircut.ok && consult.ok);
    if (!haircut.ok || !consult.ok) throw new Error("services failed");
    const sarah = await S.saveStaff(user.id, { name: "Sarah", role: "Senior stylist", priceOverrides: { [haircut.id]: 55 }, specialties: ["Fades"] });
    const tom = await S.saveStaff(user.id, { name: "Tom", role: "Stylist" });
    const main = await S.saveLocation(user.id, { name: "Main Street", kind: "business", address: "123 Main Street" });
    const mobile = await S.saveLocation(user.id, { name: "We come to you", kind: "mobile", serviceArea: { postalCodes: ["78701"], travelFee: 15 } });
    check("C2 providers and locations save", sarah.ok && tom.ok && main.ok && mobile.ok);
    if (!sarah.ok || !tom.ok || !main.ok || !mobile.ok) throw new Error("rows failed");
    const services = await S.listServices(user.id);
    check("C2 a service reads back whole", services[0].name === "Haircut" && services[0].addons[0].price === 10 && services[0].variants[0].pricing?.amount === 65 && services[0].deposit.kind === "percent" && services[0].imageUrl === "https://example.invalid/haircut.jpg");
    await S.moveService(user.id, consult.id, "up");
    check("C2 services reorder", (await S.listServices(user.id))[0].id === consult.id);
    await S.moveService(user.id, consult.id, "down");

    const got = await S.getBookingFlow(user.id, { preselectServiceId: haircut.id });
    check("C3 the flow carries services, providers, locations and public rules", !!got && got.flow.services.length === 2 && got.flow.staff.length === 2 && got.flow.locations.length === 2 && got.flow.categories.join() === "Hair,Advice");
    check("C3 promo codes never leave the server", !!got && !("promoCodes" in got.flow.rules) && got.flow.rules.hasPromoCodes === true);
    check("C3 the preselect names the service", got?.flow.preselect.serviceId === haircut.id);
    check("C3 the business name and zone ride along", got?.flow.business.name === "Proof Salon" && got?.flow.business.timezone === TZ);
    await prisma.profile.update({ where: { userId: user.id }, data: { bookingEnabled: false } });
    check("C3 booking off is no flow at all", (await S.getBookingFlow(user.id)) === null);
    await prisma.profile.update({ where: { userId: user.id }, data: { bookingEnabled: true } });

    // Availability: next month, then the first open day.
    const nowTz = time.zonedParts(new Date(), TZ);
    const month = `${nowTz.m === 12 ? nowTz.y + 1 : nowTz.y}-${String(nowTz.m === 12 ? 1 : nowTz.m + 1).padStart(2, "0")}`;
    const monthAvail = await S.availability(user.id, { serviceId: haircut.id, month });
    const openDay = monthAvail.days?.find((d) => d.open);
    check("C4 a month of days, some open", (monthAvail.days?.length ?? 0) >= 28 && !!openDay && monthAvail.timezone === TZ);
    const dayAvail = await S.availability(user.id, { serviceId: haircut.id, date: openDay!.date });
    check("C4 an open day has slots, both providers free, and an opening instant", (dayAvail.slots?.length ?? 0) > 0 && dayAvail.slots![0].staffIds.length === 2 && dayAvail.full === false && typeof dayAvail.dayStart === "string");
    check("C4 an unknown service draws nothing bookable", (await S.availability(user.id, { serviceId: "nope", date: openDay!.date })).slots?.length === 0);
    const slot = dayAvail.slots![0];

    const customer = { firstName: "Ada", lastName: "Lovelace", email: "ada@example.invalid", phone: "512-555-0100", smsConsent: "yes" };
    const sel = (over: Record<string, unknown>) =>
      T.sanitizeSelection({ serviceId: haircut.id, addonIds: ["beard"], staffId: null, locationId: main.id, mode: "in_person", startsAt: slot.startsAt, customer, answers: {}, ...over });

    const quote = await S.quoteBooking(user.id, sel({ variantId: "long", locationId: mobile.id, mode: "mobile", postalCode: "78701", promoCode: "welcome10", staffId: sarah.id }));
    check("C5 a quote prices the variant, add-on, travel and promo", quote.ok && quote.breakdown.lines.map((l) => `${l.kind}:${l.amount}`).join(",") === "variant:65,addon:10,travel:15,promo:-9" && quote.breakdown.total === 81 && quote.breakdown.deposit === 16.2, quote.ok ? JSON.stringify(quote.breakdown.lines) : quote.error);
    const badZip = await S.quoteBooking(user.id, sel({ locationId: mobile.id, mode: "mobile", postalCode: "10001" }));
    check("C5 outside the service area is refused", !badZip.ok);

    const first = await S.createBooking(user.id, sel({}));
    check("C6 'anyone available' books and assigns a provider", first.ok && first.status === "confirmed" && ["Sarah", "Tom"].includes(first.staffName) && first.serviceName === "Haircut" && first.locationName === "Main Street", first.ok ? "" : first.error);
    check("C6 the booked duration includes the add-on", first.ok && (new Date(first.endsAt).getTime() - new Date(first.startsAt).getTime()) / 60000 === 60);
    const second = await S.createBooking(user.id, sel({}));
    check("C6 the same slot goes to the other provider", second.ok && first.ok && second.staffName !== first.staffName);
    const third = await S.createBooking(user.id, sel({}));
    check("C6 a third is full, not an error of another kind", !third.ok && third.full === true, third.ok ? "booked" : third.error);
    const waitlisted = await S.createBooking(user.id, sel({ waitlist: true }));
    check("C6 …and can join the waitlist", waitlisted.ok && waitlisted.status === "waitlisted");
    const details = await S.listBookings(user.id);
    check("C6 the owner sees who, what, where and what was agreed", details.length === 3 && details.every((d) => d.serviceName === "Haircut" && d.customer.firstName === "Ada") && details.some((d) => d.status === "waitlisted") && details[0].pricing?.total === 55 && details[0].addons.join() === "Beard trim");

    // Rejections the client can't talk its way past.
    check("C7 an unknown service", !(await S.createBooking(user.id, sel({ serviceId: "nope", startsAt: dayAvail.slots![3].startsAt }))).ok);
    check("C7 a mode the service doesn't offer", !(await S.createBooking(user.id, sel({ mode: "online", locationId: null, startsAt: dayAvail.slots![3].startsAt }))).ok);
    check("C7 a missing required email", !(await S.createBooking(user.id, sel({ customer: { ...customer, email: "" }, startsAt: dayAvail.slots![3].startsAt }))).ok);
    check("C7 an instant off the grid", !(await S.createBooking(user.id, sel({ startsAt: new Date(new Date(slot.startsAt).getTime() + 7 * 60000).toISOString() }))).ok);
    await S.saveService(user.id, { id: haircut.id, name: "Haircut", staffIds: [sarah.id] });
    check("C7 a provider who doesn't perform the service", !(await S.createBooking(user.id, sel({ staffId: tom.id, startsAt: dayAvail.slots![3].startsAt }))).ok);
    await S.saveService(user.id, { id: haircut.id, name: "Haircut", staffIds: [] });
    check("C7 the service's other fields survived a partial save", (await S.listServices(user.id))[0].addons.length === 1);

    // Recurrence, all or nothing.
    const later = dayAvail.slots![dayAvail.slots!.length - 1];
    const series = await S.createBooking(user.id, sel({ startsAt: later.startsAt, staffId: sarah.id, recurrence: { frequency: "weekly", count: 3 } }));
    check("C8 a weekly series books three", series.ok && series.ids.length === 3, series.ok ? "" : series.error);
    const seriesRows = await prisma.appointment.findMany({ where: { userId: user.id, staffId: sarah.id, recurrence: { not: "" } }, orderBy: { startsAt: "asc" } });
    check("C8 …a week apart, tagged as one series", seriesRows.length === 3 && (seriesRows[1].startsAt.getTime() - seriesRows[0].startsAt.getTime()) / 86400000 === 7 && new Set(seriesRows.map((r) => JSON.parse(r.recurrence).groupId)).size === 1);
    const clash = await S.createBooking(user.id, sel({ startsAt: later.startsAt, staffId: sarah.id, recurrence: { frequency: "weekly", count: 2 } }));
    check("C8 a series that can't complete books nothing", !clash.ok && (await prisma.appointment.count({ where: { userId: user.id } })) === 6);

    // Cancel frees the slot.
    if (first.ok && second.ok) {
      await S.setBookingStatus(user.id, first.id, "cancelled");
      const again = await S.availability(user.id, { serviceId: haircut.id, date: openDay!.date });
      check("C9 cancelling frees the provider's slot", again.slots?.some((s) => s.startsAt === slot.startsAt) === true);
      check("C9 a cancelled booking leaves the owner's list", !(await S.listBookings(user.id)).some((d) => d.id === first.id));
    }

    // The intake-only path still holds its old contract.
    const legacyAt = dayAvail.slots![5].startsAt;
    await Ap.setBookingEnabled(user.id, true);
    const a1 = await Ap.createAppointment(user.id, { startsAt: legacyAt, answers: { name: "Ada", email: "ada@example.invalid" } });
    const a2 = await Ap.createAppointment(user.id, { startsAt: legacyAt, answers: { name: "Bob", email: "bob@example.invalid" } });
    check("C10 the old wizard still books, and the same instant twice is refused", a1.ok && !a2.ok && /taken/i.test(a2.ok ? "" : a2.error));

    // The legacy bridge: a tenant with only the picker question.
    await prisma.profile.upsert({ where: { userId: legacyUser.id }, update: { bookingEnabled: true }, create: { userId: legacyUser.id, bookingEnabled: true } });
    await Ap.saveAppointmentField(legacyUser.id, { key: "name", label: "Your name", type: "short_text", required: true, role: "name" });
    await Ap.saveAppointmentField(legacyUser.id, { key: "email", label: "Your email", type: "email", required: true, role: "email" });
    await Ap.saveAppointmentField(legacyUser.id, {
      key: "service", label: "Which services would you like?", type: "multi_select", required: true,
      config: { options: [{ label: "Gel Manicure", price: "$35", duration: "45 min", group: "Manicures" }, { label: "Spa Pedicure", price: "from $50", group: "Pedicures" }], allowOther: true },
    });
    await Ap.saveAppointmentField(legacyUser.id, { key: "allergies", label: "Any allergies?", type: "yes_no", required: false });
    await prisma.photo.create({ data: { userId: legacyUser.id, filename: "0f1e2d3c-1111-2222-3333-444455556666.jpg", caption: "A gel manicure being finished", kind: "gallery" } });
    const legacy = await S.getBookingFlow(legacyUser.id);
    const gel = legacy?.flow.services.find((s) => s.name === "Gel Manicure");
    check("C11 a picker-only tenant gets a service step built from the menu", !!legacy && legacy.flow.services.length === 2 && gel?.category === "Manicures");
    check("C11 …written as real rows the owner can now edit", !!gel && !gel.id.startsWith("legacy:") && (await S.listServices(legacyUser.id)).length === 2);
    check("C11 …priced and timed from the menu's own words", gel?.pricing.kind === "fixed" && gel?.pricing.amount === 35 && gel?.durationMinutes === 45 && legacy?.flow.services[1].pricing.kind === "starting_at");
    check("C11 …with a gallery photo matched by its caption", gel?.imageUrl === "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg");
    check("C11 only the picker leaves the fields; name, email and the rest stay", legacy?.fields.map((f) => f.key).join() === "name,email,allergies", legacy?.fields.map((f) => f.key).join());
    check("C11 name and email are ordinary role-tagged fields, still required", legacy?.fields.filter((f) => f.key === "name" || f.key === "email").every((f) => f.required && (f.role === "name" || f.role === "email")) === true);
    const lslot = (await S.availability(legacyUser.id, { serviceId: gel!.id, date: openDay!.date })).slots?.[0];
    const lb = await S.createBooking(legacyUser.id, T.sanitizeSelection({ serviceId: gel!.id, startsAt: lslot?.startsAt, customer, answers: { allergies: "yes" } }));
    check("C11 booking a derived service works", lb.ok && lb.serviceName === "Gel Manicure", lb.ok ? "" : lb.error);
    const stored = (await Ap.listAppointments(legacyUser.id))[0];
    check("C11 …and the old readers still see the pick with its price", stored?.answers.service?.includes("Gel Manicure ($35") === true && stored?.answers.allergies === "Yes");

    // A tenant whose services extractor wrote menu items (the menu-cart
    // feature): those carry the site's prices and the model's own image match.
    await prisma.profile.upsert({ where: { userId: menuUser.id }, update: { bookingEnabled: true }, create: { userId: menuUser.id, bookingEnabled: true } });
    await prisma.menuItem.create({
      data: { userId: menuUser.id, key: "deep-tissue-massage", name: "Deep Tissue Massage", category: "Massage", order: 0,
        data: JSON.stringify({ price: "$80", estimatedTime: "1 hr", image: "https://example.invalid/deep.jpg", shortDescription: "Firm pressure for tight muscles." }) },
    });
    const fromMenu = await S.getBookingFlow(menuUser.id);
    const deep = fromMenu?.flow.services[0];
    check("C12 menu items become services with their price, length and picture", deep?.name === "Deep Tissue Massage" && deep.pricing.kind === "fixed" && deep.pricing.amount === 80 && deep.durationMinutes === 60 && deep.imageUrl === "https://example.invalid/deep.jpg" && deep.description === "Firm pressure for tight muscles.");

    // Refresh from the site fills blanks and never overwrites the owner.
    const { enrichServices } = await import("../../../lib/onboarding/bookingSeed");
    const blowout = await S.saveService(user.id, { name: "Blowout", pricing: { kind: "variable" }, durationMinutes: 30 });
    check("C13 a service can start unpriced", blowout.ok);
    const html = '<html><body><h2>Blowout</h2><img src="https://example.invalid/blowout.jpg" alt="Blowout at the salon"></body></html>';
    const page = { url: "https://example.invalid/services", html, $: cheerioLib.load(html) };
    const enriched = await enrichServices(
      user.id,
      [
        { name: "Blowout", description: "Wash and blow-dry.", price: "$40", duration: "30 min", addons: [{ name: "Deep conditioning", price: "$15" }] },
        { name: "Haircut", description: "", price: "$99" },
        { name: "Kids Cut", description: "Under 12s.", price: "$20", duration: "20 min" },
      ],
      [],
      [page],
      () => {},
      { download: async () => ({ filename: "0f1e2d3c-1111-2222-3333-444455556666.jpg" }) },
    );
    const after = await S.listServices(user.id);
    const b = after.find((r) => r.name === "Blowout");
    const kids = after.find((r) => r.name === "Kids Cut");
    const cut = after.find((r) => r.id === haircut.id);
    check("C13 the refresh fills the blanks: price, description, add-on, photo", enriched.updated === 1 && b?.pricing.amount === 40 && b?.description === "Wash and blow-dry." && b?.addons[0]?.price === 15 && b?.imageUrl === "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg" && enriched.imaged === 1, JSON.stringify(enriched));
    check("C13 …adds a service the site names that the owner lacks", enriched.added === 1 && kids?.pricing.amount === 20 && kids?.durationMinutes === 20);
    check("C13 …and never overwrites a price the owner set", cut?.pricing.amount === 45);

    // A business whose site says "call to book" and nothing about booking
    // online: the stage records the channels, turns the card into a request
    // the owner confirms, and asks for a phone number. The scripted model is
    // the one doubled boundary; everything else is the real stage.
    const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
    await prisma.profile.upsert({ where: { userId: phoneUser.id }, update: { bookingEnabled: true, company_phone_number: "(512) 555-0199" }, create: { userId: phoneUser.id, bookingEnabled: true, company_phone_number: "(512) 555-0199" } });
    const phoneHtml = "<html><body><h1>Services</h1><p>Basic Manicure $22. Call (512) 555-0199 to book.</p></body></html>";
    const phonePages = [{ url: "https://phone-only.invalid/services", html: phoneHtml, $: cheerioLib.load(phoneHtml) }];
    const scripted = async () => ({
      services: [{ name: "Basic Manicure", description: "", price: "$22", duration: "", category: "Manicure" }],
      booking: { takesAppointments: true, kind: "personal_service", staff: [], phone: "required", email: "unknown", notes: false, channels: ["phone"], requirements: [] },
    });
    const staged = await extractServicesAndBooking(phonePages, phoneUser.id, () => {}, { llm: scripted });
    const phoneSettings = await S.getBookingSettings(phoneUser.id);
    check("C14 the stage reports how the site takes bookings", staged.extract.channels.join() === "phone");
    check("C14 phone-only means requests the owner confirms", phoneSettings.channels.join() === "phone" && phoneSettings.confirmation === "request");
    const phoneFlow = await S.getBookingFlow(phoneUser.id);
    check("C14 the card is told the number and that bookings are requests", phoneFlow?.flow.business.phone === "(512) 555-0199" && phoneFlow?.flow.rules.confirmation === "request" && phoneFlow?.flow.services[0]?.pricing.amount === 22);
    await S.saveBookingSettings(phoneUser.id, { confirmation: "instant", confirmationOwner: true });
    await extractServicesAndBooking(phonePages, phoneUser.id, () => {}, { llm: scripted });
    check("C14 an owner's own choice outlives a later site read", (await S.getBookingSettings(phoneUser.id)).confirmation === "instant");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: legacyUser.id } });
    await prisma.user.delete({ where: { id: menuUser.id } });
    await prisma.user.delete({ where: { id: phoneUser.id } });
    check("Z no proof users left behind", (await prisma.user.count({ where: { slug: { startsWith: SLUG } } })) === 0);
  }
}

// ══ D. What the visitor is handed (static render of the real card) ═══════
export async function sectionD(check: Check, cheerio: typeof CheerioModule) {
  console.log("D. The card (app/cards/Cards.tsx), rendered to static markup");
  const T = await import("../../../lib/booking/types");
  const { Cards } = await import("../../../app/cards/Cards");

  const settings = T.sanitizeBookingSettings({ hours: weekdays(), waitlist: true, recurring: true, tips: { enabled: true } });
  const svc = (over: Partial<ServiceRow>): ServiceRow => ({
    id: "s", name: "Haircut", category: "Hair", description: "A cut.", imageUrl: null, images: [], pricing: { kind: "fixed", amount: 45 }, durationMinutes: 45,
    addons: [], variants: [], deposit: { kind: "none" }, modes: [], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
    bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true, ...over,
  });
  const flow: BookingFlow = {
    business: { name: "Proof Salon", timezone: "America/New_York", currency: "USD", phone: "(512) 555-0100" },
    services: [
      svc({ id: "cut", name: "Haircut", imageUrl: "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg", deposit: { kind: "percent", amount: 20 } }),
      svc({ id: "color", name: "Color", category: "Color", pricing: { kind: "starting_at", amount: 80 }, durationMinutes: 90, modes: ["in_person", "mobile"] }),
      svc({ id: "consult", name: "Consultation", category: "Advice", pricing: { kind: "quote" } }),
    ],
    categories: ["Hair", "Color", "Advice"],
    staff: [{ id: "a", name: "Sarah", role: "Senior stylist", bio: "", photoUrl: null, specialties: ["Fades"], languages: ["English"], credentials: [], genderLabel: "", hours: null, timeOff: [], priceOverrides: {}, durationOverrides: {}, order: 0, enabled: true }],
    locations: [],
    rules: T.publicRules(settings),
    preselect: { serviceId: null },
  };
  // The migrated tenant's form: the old details step as screen 1, one question per later screen.
  const fields = [
    { key: "first_name", label: "First name", type: "short_text" as const, required: true, config: {}, role: "first_name" as const, screen: 1 },
    { key: "last_name", label: "Last name", type: "short_text" as const, required: true, config: {}, role: "last_name" as const, screen: 1 },
    { key: "email", label: "Email", type: "email" as const, required: true, config: { placeholder: "you@example.com" }, role: "email" as const, screen: 1 },
    { key: "phone", label: "Phone", type: "phone" as const, required: false, config: { help: "For reminders only." }, role: "phone" as const, screen: 1 },
    { key: "sms_consent", label: "Text me appointment reminders", type: "yes_no" as const, required: false, config: {}, role: "none" as const, screen: 1 },
    { key: "notes", label: "Anything else?", type: "long_text" as const, required: false, config: {}, role: "notes" as const, screen: 2 },
  ];
  // An old stored block: fields saved before roles and screens existed, and no flow.
  const oldFields = [{ key: "notes", label: "Anything else?", type: "long_text" as const, required: false, config: {} }];

  // A booking is a conversation of cards. Outside a chat the block draws a
  // thread of its own: on the server nothing is asked yet (the cards come one
  // at a time once the browser takes over), and the other way to book is in
  // view from the first paint.
  const html = renderToStaticMarkup(React.createElement(Cards, { block: { type: "booking", fields, flow }, slug: "proof" }));
  const $ = cheerio.load(html);
  check("D1 a booking block outside a chat draws its own thread shell", $("[data-booking-thread]").length === 1);
  check("D1 no step is asked before the browser takes over, and no step counter anywhere", $("[data-booking-step]").length === 0 && !/Step \d+ of/.test(html));
  check("D1 no network was needed to draw it", !html.includes("Loading"));
  check("D1 the other way to book is one tap away", $('a[href="tel:+15125550100"], a[href="tel:5125550100"]').length === 1 && html.includes("Prefer to call?"));
  check("D1 a visitor sees no preview banner", !html.includes("Preview — nothing gets booked."));
  const { BookingThread } = await import("../../../app/cards/booking/BookingThread");
  const previewHtml = renderToStaticMarkup(React.createElement(BookingThread, { slug: "proof", fields, flow, preview: true }));
  check("D1 the owner's preview says so", previewHtml.includes("Preview — nothing gets booked."));

  // The service step's card, as the thread lays it out first: a tile per service.
  const { ServiceStep } = await import("../../../app/cards/booking/ServiceStep");
  const { emptySelection } = await import("../../../lib/booking/session");
  const serviceProps = { flow, selection: emptySelection(null, "America/New_York"), onPick: () => {} };
  const service = renderToStaticMarkup(React.createElement(ServiceStep, serviceProps));
  const $v = cheerio.load(service);
  check("D1 the service step opens with a tile per service", $v("img").length === 1 && $v('[data-testid="placeholder-image"]').length === 2, `${$v("img").length} img, ${$v('[data-testid="placeholder-image"]').length} placeholders`);
  check("D1 the imaged service draws its photo", $v("img").attr("src") === "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg");
  check("D1 prices read as the business would say them", service.includes("$45") && service.includes("From $80") && service.includes("Quote"));
  check("D1 durations and badges", service.includes("45 min") && service.includes("1 hr 30 min") && service.includes("Deposit") && service.includes(T.MODE_LABELS.mobile));
  check("D1 category chips", ["All", "Hair", "Color", "Advice"].every((c) => $v("button").filter((_, b) => $v(b).text().trim() === c).length > 0));
  check("D1 the service card carries the phone line as well", $v('a[href^="tel:"]').length === 1);
  const $locked = cheerio.load(renderToStaticMarkup(React.createElement(ServiceStep, { ...serviceProps, locked: true })));
  check("D1 a finished booking locks the service card: tiles disabled, still in view", $locked("fieldset[disabled]").length === 1 && $locked('[role="button"]').length === 3);

  const noFlow = renderToStaticMarkup(React.createElement(Cards, { block: { type: "booking", fields: oldFields }, slug: "proof" }));
  check("D2 an old stored block still draws the first question at once", noFlow.includes("Anything else?") && !noFlow.includes("Loading"));

  // The steps are the business's own: a migrated tenant (empty stored flow)
  // walks today's order, contact details as one screen among the questions.
  const { planSteps, contactFields } = await import("../../../lib/booking/flowSteps");
  const { toFlowFields } = await import("../../../app/cards/booking/BookingFlowCard");
  const empty = { serviceId: null, variantId: null, answers: {} };
  const planned = planSteps(flow, fields, empty);
  const kinds = planned.map((s) => (s.kind === "screen" ? `screen:${s.screen}` : s.kind)).join(" → ");
  check("D4 a migrated tenant walks today's order", kinds === "service → provider → time → screen:1 → screen:2 → review", kinds);
  const details = planned.find((s) => s.kind === "screen");
  check("D4 the first screen is the old details step", details?.kind === "screen" && details.fields.map((f) => f.key).join() === "first_name,last_name,email,phone,sms_consent" && contactFields(details.fields).length === 4);
  check("D4 the options step appears once a service with options is chosen", planSteps({ ...flow, services: [svc({ id: "cut", variants: [{ id: "v", name: "Long", pricing: { kind: "fixed", amount: 60 }, durationMinutes: 60 }] })] }, fields, { ...empty, serviceId: "cut" }).map((s) => s.kind).join() === "service,options,provider,time,screen,screen,review");
  check("D4 a block from before roles and screens reads as one question per screen", toFlowFields(oldFields).every((f) => f.role === "none" && f.screen === 1) && toFlowFields([...oldFields, ...oldFields]).map((f) => f.screen).join() === "1,2");

  // A business whose form asks for details first: the first card asked is
  // that screen, drawing every field on it together, as its own form does.
  const detailsFirst: BookingFlow = { ...flow, rules: { ...flow.rules, flow: [{ kind: "questions", screen: 1, title: "Your details" }, { kind: "service" }, { kind: "provider" }, { kind: "time" }, { kind: "questions", screen: 2 }, { kind: "review" }] } };
  type ScreenCardStep = import("../../../app/cards/booking/ScreenStep").ScreenCardStep;
  const { ScreenStep } = await import("../../../app/cards/booking/ScreenStep");
  const firstStep = planSteps(detailsFirst, fields, empty)[0];
  check("D5 the details screen is the first card asked, with no separate details step", firstStep?.kind === "screen" && firstStep.screen === 1 && planSteps(detailsFirst, fields, empty).length === 6);
  const screenProps = { step: firstStep as ScreenCardStep, answers: {}, setAnswer: () => {}, slug: "proof", onNext: () => {} };
  const first = renderToStaticMarkup(React.createElement(ScreenStep, screenProps));
  const $f = cheerio.load(first);
  const labels = $f("label").map((_, l) => $f(l).text().trim()).get();
  check("D5 the details screen lists its fields together, required ones starred", labels.join("|") === "First name *|Last name *|Email *|Phone|Text me appointment reminders", labels.join("|"));
  check("D5 the screen's own heading, placeholder and help line", first.includes("Your details") && $f('input[type="email"]').attr("placeholder") === "you@example.com" && first.includes("For reminders only.") && $f('input[type="tel"]').attr("placeholder") === "Optional");
  check("D5 no Back button and no step counter: earlier cards stay editable in the thread", $f("button").filter((_, b) => $f(b).text().trim() === "Back").length === 0 && !/Step \d+ of/.test(first));
  check("D5 Next waits for the required answers", $f("button").filter((_, b) => $f(b).text().trim() === "Next").attr("aria-disabled") === "true");
  const $again = cheerio.load(renderToStaticMarkup(React.createElement(ScreenStep, { ...screenProps, nextLabel: "Update" })));
  check("D5 a step already answered offers Update", $again("button").filter((_, b) => $again(b).text().trim() === "Update").length === 1);
  const $done = cheerio.load(renderToStaticMarkup(React.createElement(ScreenStep, { ...screenProps, locked: true })));
  check("D5 a locked step keeps its answers in view: controls disabled, no Next", $done("fieldset[disabled]").length === 1 && $done("button").filter((_, b) => /^(Next|Update|Skip)$/.test($done(b).text().trim())).length === 0 && $done("label").length === 5);

  const services = renderToStaticMarkup(React.createElement(Cards, {
    block: { type: "services", items: [{ id: "cut", name: "Haircut", description: "A cut.", imageUrl: "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg", priceLabel: "$45", duration: "45 min" }, { id: "color", name: "Color", description: "" }], booking: { fields, serviceKey: null, flow } },
    slug: "proof",
  }));
  const $s = cheerio.load(services);
  check("D3 the services card shows thumbnails, prices and a Book button", $s("img").length === 1 && services.includes("$45") && $s("button").filter((_, b) => $s(b).text().trim() === "Book").length === 2);
}

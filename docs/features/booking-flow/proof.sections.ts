/**
 * Sections B–D of the booking-flow proof (see proof.ts, which runs them).
 * Split out so the pure section A stays readable and this file can import
 * the store, the engines and the real card.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  try {
    await prisma.profile.upsert({ where: { userId: user.id }, update: { company_name: "Proof Salon", bookingEnabled: true }, create: { userId: user.id, company_name: "Proof Salon", bookingEnabled: true } });
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
    await Ap.saveAppointmentField(legacyUser.id, { key: "name", label: "Your name", type: "short_text", required: true });
    await Ap.saveAppointmentField(legacyUser.id, { key: "email", label: "Your email", type: "email", required: true });
    await Ap.saveAppointmentField(legacyUser.id, {
      key: "service", label: "Which services would you like?", type: "multi_select", required: true,
      config: { options: [{ label: "Gel Manicure", price: "$35", duration: "45 min", group: "Manicures" }, { label: "Spa Pedicure", price: "from $50", group: "Pedicures" }], allowOther: true },
    });
    await Ap.saveAppointmentField(legacyUser.id, { key: "allergies", label: "Any allergies?", type: "yes_no", required: false });
    await prisma.photo.create({ data: { userId: legacyUser.id, filename: "0f1e2d3c-1111-2222-3333-444455556666.jpg", caption: "A gel manicure being finished", kind: "gallery" } });
    const legacy = await S.getBookingFlow(legacyUser.id);
    const gel = legacy?.flow.services.find((s) => s.name === "Gel Manicure");
    check("C11 a picker-only tenant gets a service step derived from the menu", !!legacy && legacy.flow.services.length === 2 && gel?.id.startsWith("legacy:") === true && gel?.category === "Manicures");
    check("C11 …priced and timed from the menu's own words", gel?.pricing.kind === "fixed" && gel?.pricing.amount === 35 && gel?.durationMinutes === 45 && legacy?.flow.services[1].pricing.kind === "starting_at");
    check("C11 …with a gallery photo matched by its caption", gel?.imageUrl === "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg");
    check("C11 name, email and the picker leave the intake; the rest stays", legacy?.intake.map((f) => f.key).join() === "allergies");
    check("C11 the old required name/email fold onto the customer step", legacy?.flow.rules.customerFields.find((f) => f.key === "email")?.required === true);
    const lslot = (await S.availability(legacyUser.id, { serviceId: gel!.id, date: openDay!.date })).slots?.[0];
    const lb = await S.createBooking(legacyUser.id, T.sanitizeSelection({ serviceId: gel!.id, startsAt: lslot?.startsAt, customer, answers: { allergies: "yes" } }));
    check("C11 booking a derived service works", lb.ok && lb.serviceName === "Gel Manicure", lb.ok ? "" : lb.error);
    const stored = (await Ap.listAppointments(legacyUser.id))[0];
    check("C11 …and the old readers still see the pick with its price", stored?.answers.service?.includes("Gel Manicure ($35") === true && stored?.answers.allergies === "Yes");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.user.delete({ where: { id: legacyUser.id } });
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
    business: { name: "Proof Salon", timezone: "America/New_York", currency: "USD" },
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
  const fields = [{ key: "notes", label: "Anything else?", type: "long_text" as const, required: false, config: {} }];

  const html = renderToStaticMarkup(React.createElement(Cards, { block: { type: "booking", fields, flow }, slug: "proof" }));
  const $ = cheerio.load(html);
  check("D1 the service step opens with a tile per service", $("img").length === 1 && $('[data-testid="placeholder-image"]').length === 2, `${$("img").length} img, ${$('[data-testid="placeholder-image"]').length} placeholders`);
  check("D1 the imaged service draws its photo", $("img").attr("src") === "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg");
  check("D1 prices read as the business would say them", html.includes("$45") && html.includes("From $80") && html.includes("Quote"));
  check("D1 durations and badges", html.includes("45 min") && html.includes("1 hr 30 min") && html.includes("Deposit") && html.includes(T.MODE_LABELS.mobile));
  check("D1 category chips", ["All", "Hair", "Color", "Advice"].every((c) => $("button").filter((_, b) => $(b).text().trim() === c).length > 0));
  check("D1 no network was needed to draw it", !html.includes("Loading"));
  check("D1 the step counter", /Step 1 of \d+/.test(html));

  const noFlow = renderToStaticMarkup(React.createElement(Cards, { block: { type: "booking", fields }, slug: "proof" }));
  check("D2 an old stored block still draws the first question at once", noFlow.includes("Anything else?") && !noFlow.includes("Loading"));

  const services = renderToStaticMarkup(React.createElement(Cards, {
    block: { type: "services", items: [{ id: "cut", name: "Haircut", description: "A cut.", imageUrl: "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg", priceLabel: "$45", duration: "45 min" }, { id: "color", name: "Color", description: "" }], booking: { fields, serviceKey: null, flow } },
    slug: "proof",
  }));
  const $s = cheerio.load(services);
  check("D3 the services card shows thumbnails, prices and a Book button", $s("img").length === 1 && services.includes("$45") && $s("button").filter((_, b) => $s(b).text().trim() === "Book").length === 2);
}

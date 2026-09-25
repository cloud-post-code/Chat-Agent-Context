/**
 * The availability engine, pure, with no imports beyond ./types and ./time.
 *
 * Turns a resolved selection (service, duration, provider candidates,
 * location, a window of already-confirmed bookings, "now") into open days,
 * open slots for one day, the very next open slot, and a verdict on one
 * exact instant. Every rule DESIGN.md lists for booking hours lives here so
 * the card, the quote endpoint and the transaction that actually inserts a
 * row all see the same answer.
 */

import type { BookingSettings, DayAvailability, DayKey, LocationRow, ServiceRow, Slot, StaffRow, WeeklyHours } from "./types";
import { addMinutes, pad2, shiftDays, ymd, zonedToUtc } from "./time";

export type Booked = { startsAt: Date; endsAt: Date; staffId: string | null; locationId: string | null; status: string };

export type AvailabilityInput = {
  settings: BookingSettings;
  service: ServiceRow | null;
  durationMinutes: number;
  staff: StaffRow[];
  location: LocationRow | null;
  booked: Booked[];
  now: Date;
};

export type CheckSlotResult =
  | { ok: true; staffId: string | null; endsAt: Date }
  | { ok: false; reason: string; full: boolean };

/** The day of week a "YYYY-MM-DD" calendar date names — timezone-independent, it's just the calendar. */
function weekdayOfDate(date: string): DayKey {
  const [y, m, d] = date.split("-").map((s) => Number.parseInt(s, 10));
  const wd = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  const map: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[wd];
}

function effectiveZone(input: AvailabilityInput): string {
  return input.location?.timezone || input.settings.timezone;
}

/** Business hours, or the location's when it sets its own — the grid's source of hours ranges for a date. */
function baseHoursFor(input: AvailabilityInput, date: string): { start: string; end: string }[] {
  const hours: WeeklyHours = input.location?.hours ?? input.settings.hours;
  return hours[weekdayOfDate(date)] ?? [];
}

/** The max of settings' and the service's own buffers, before and after. */
function buffers(input: AvailabilityInput): { before: number; after: number } {
  return {
    before: Math.max(input.settings.bufferBeforeMinutes, input.service?.bufferBeforeMinutes ?? 0),
    after: Math.max(input.settings.bufferAfterMinutes, input.service?.bufferAfterMinutes ?? 0),
  };
}

/**
 * Whether a whole calendar date is closed: past, a holiday, past the advance
 * window, today when same-day booking is off, or tomorrow once the daily
 * cutoff's wall-clock time has passed — all judged in the business's own
 * zone (settings.timezone), per DESIGN.md, regardless of a location override.
 */
function isDateClosed(input: AvailabilityInput, date: string): boolean {
  const { settings, now } = input;
  const businessZone = settings.timezone;
  const today = ymd(now, businessZone);
  if (date < today) return true;
  if (settings.holidays.some((h) => h.date === date)) return true;
  const maxDate = shiftDays(today, settings.maxAdvanceDays);
  if (date > maxDate) return true;
  if (date === today && !settings.sameDayBooking) return true;
  if (settings.dailyCutoff) {
    const tomorrow = shiftDays(today, 1);
    if (date === tomorrow) {
      const nowInstant = now.getTime();
      const cutoffInstant = zonedToUtc(today, settings.dailyCutoff, businessZone).getTime();
      if (nowInstant >= cutoffInstant) return true;
    }
  }
  return false;
}

/** Every slot start for one date: stepped by the slot interval from each business/location hours range's start. */
function slotStartsForDate(input: AvailabilityInput, date: string, zone: string): Date[] {
  const ranges = baseHoursFor(input, date);
  const interval = input.settings.slotIntervalMinutes;
  const starts: Date[] = [];
  for (const r of ranges) {
    const rangeStart = zonedToUtc(date, r.start, zone);
    const rangeEnd = zonedToUtc(date, r.end, zone);
    let t = rangeStart;
    while (addMinutes(t, input.durationMinutes).getTime() <= rangeEnd.getTime()) {
      starts.push(t);
      t = addMinutes(t, interval);
    }
  }
  return starts;
}

function overlapsWithBuffer(
  start: Date,
  end: Date,
  before: number,
  after: number,
  bookedStart: Date,
  bookedEnd: Date,
): boolean {
  // Every appointment occupies its own time plus the buffers around it, the
  // booked one included: a 30-minute clean-up after a 10:00–11:00 booking
  // pushes the next start to 11:30, whichever of the two is "new".
  const s = start.getTime() - before * 60_000;
  const e = end.getTime() + after * 60_000;
  return s < bookedEnd.getTime() + after * 60_000 && e > bookedStart.getTime() - before * 60_000;
}

/**
 * Businesses with no providers tracked ([] staff): the resource is the
 * location itself — chairs, bays, rooms — and `location.capacity` (default 1)
 * says how many bookings may overlap there at once. Only bookings at the same
 * location (both null when there's no location step) count toward it.
 */
function hasBlockingBooking(input: AvailabilityInput, start: Date, end: Date): boolean {
  const { before, after } = buffers(input);
  const capacity = input.location?.capacity ?? 1;
  const locationId = input.location?.id ?? null;
  const overlapping = input.booked.filter(
    (b) =>
      b.status === "confirmed" &&
      b.locationId === locationId &&
      overlapsWithBuffer(start, end, before, after, b.startsAt, b.endsAt),
  ).length;
  return overlapping >= capacity;
}

/**
 * The provider candidates free for [start, end): in their own hours (else
 * business/location hours) minus time off, minus a conflicting booking of
 * their own. A `staffId: null` booking that overlaps blocks one provider —
 * the first that would otherwise be free — consistently, since it names no
 * one specific but still occupies someone.
 */
function freeCandidatesFor(input: AvailabilityInput, start: Date, end: Date, date: string, zone: string): string[] {
  const { before, after } = buffers(input);
  const day = weekdayOfDate(date);

  const eligible: string[] = [];
  for (const staff of input.staff) {
    const hours = staff.hours ?? input.location?.hours ?? input.settings.hours;
    const dayRanges = hours[day] ?? [];
    const withinHours = dayRanges.some((r) => {
      const rs = zonedToUtc(date, r.start, zone);
      const re = zonedToUtc(date, r.end, zone);
      return start.getTime() >= rs.getTime() && end.getTime() <= re.getTime();
    });
    if (!withinHours) continue;

    const onTimeOff = staff.timeOff.some((t) => {
      const ts = new Date(t.start).getTime();
      const te = new Date(t.end).getTime();
      return start.getTime() < te && end.getTime() > ts;
    });
    if (onTimeOff) continue;

    const conflict = input.booked.some(
      (b) =>
        b.status === "confirmed" &&
        b.staffId === staff.id &&
        overlapsWithBuffer(start, end, before, after, b.startsAt, b.endsAt),
    );
    if (conflict) continue;

    eligible.push(staff.id);
  }

  const nullBlockers = input.booked.filter(
    (b) => b.status === "confirmed" && b.staffId === null && overlapsWithBuffer(start, end, before, after, b.startsAt, b.endsAt),
  ).length;

  return eligible.slice(nullBlockers);
}

function dayBookingCount(input: AvailabilityInput, staffId: string, date: string, zone: string): number {
  return input.booked.filter(
    (b) => b.status === "confirmed" && b.staffId === staffId && ymd(b.startsAt, zone) === date,
  ).length;
}

/** Every open slot for one date, business/location hours minus everything that closes or fills it. */
export function availableSlots(input: AvailabilityInput, date: string): Slot[] {
  const zone = effectiveZone(input);
  if (isDateClosed(input, date)) return [];
  const minStart = addMinutes(input.now, input.settings.leadTimeMinutes).getTime();
  const out: Slot[] = [];
  for (const s of slotStartsForDate(input, date, zone)) {
    if (s.getTime() < minStart) continue;
    const e = addMinutes(s, input.durationMinutes);
    if (input.staff.length === 0) {
      if (hasBlockingBooking(input, s, e)) continue;
      out.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), staffIds: [] });
    } else {
      const free = freeCandidatesFor(input, s, e, date, zone);
      if (free.length === 0) continue;
      out.push({ startsAt: s.toISOString(), endsAt: e.toISOString(), staffIds: free });
    }
  }
  return out;
}

/** One row per calendar day of `month`, in the business zone, open = it has at least one slot. */
export function availableDays(input: AvailabilityInput, month: string): DayAvailability[] {
  const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: DayAvailability[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(day)}`;
    const slots = availableSlots(input, date);
    out.push({ date, open: slots.length > 0, slots: slots.length });
  }
  return out;
}

/** The very next open slot, scanning day by day from today (business zone) through maxAdvanceDays. */
export function earliestSlot(input: AvailabilityInput): Slot | null {
  const businessZone = input.settings.timezone;
  const today = ymd(input.now, businessZone);
  for (let n = 0; n <= input.settings.maxAdvanceDays; n++) {
    const date = shiftDays(today, n);
    const slots = availableSlots(input, date);
    if (slots.length > 0) return slots[0];
  }
  return null;
}

/**
 * Whether one exact instant is bookable right now: it must land precisely on
 * a computed slot for its day (else a structural rejection, not "full"), and
 * then a provider or the room must actually be free for it.
 */
export function checkSlot(input: AvailabilityInput, startsAt: Date): CheckSlotResult {
  const zone = effectiveZone(input);
  const date = ymd(startsAt, zone);

  if (isDateClosed(input, date)) {
    return { ok: false, reason: "That day is closed", full: false };
  }

  const grid = slotStartsForDate(input, date, zone);
  if (!grid.some((g) => g.getTime() === startsAt.getTime())) {
    return { ok: false, reason: "That time isn't available", full: false };
  }

  const minStart = addMinutes(input.now, input.settings.leadTimeMinutes).getTime();
  if (startsAt.getTime() < minStart) {
    return { ok: false, reason: "That time is too soon", full: false };
  }

  const endsAt = addMinutes(startsAt, input.durationMinutes);

  if (input.staff.length === 0) {
    if (hasBlockingBooking(input, startsAt, endsAt)) {
      return { ok: false, reason: "That time was just taken", full: true };
    }
    return { ok: true, staffId: null, endsAt };
  }

  const free = freeCandidatesFor(input, startsAt, endsAt, date, zone);

  if (input.staff.length === 1) {
    const only = input.staff[0];
    if (!free.includes(only.id)) {
      return { ok: false, reason: "That time was just taken", full: true };
    }
    return { ok: true, staffId: only.id, endsAt };
  }

  if (free.length === 0) {
    return { ok: false, reason: "That time was just taken", full: true };
  }

  // The free candidate with the fewest bookings that day; ties go to whoever
  // appears first in `input.staff` (the caller's own order).
  let chosen = free[0];
  let chosenCount = dayBookingCount(input, chosen, date, zone);
  for (const id of free.slice(1)) {
    const count = dayBookingCount(input, id, date, zone);
    if (count < chosenCount) {
      chosen = id;
      chosenCount = count;
    }
  }
  return { ok: true, staffId: chosen, endsAt };
}

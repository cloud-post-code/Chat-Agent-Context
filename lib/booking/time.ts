/**
 * Timezone math, pure, with no imports.
 *
 * Everything else in the booking engine (availability, the card, the store)
 * needs to move between a wall-clock date/time in some IANA zone and a real
 * instant (a `Date`, which is always UTC internally). This module is the only
 * place that talks to `Intl.DateTimeFormat`, so a DST edge case gets fixed in
 * one spot instead of wherever it was next noticed.
 */

import type { DayKey } from "./types";
import { DAY_KEYS } from "./types";

/** Weekday name Intl gives back → our DayKey. */
const WEEKDAY_TO_KEY: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

export type ZonedParts = { y: number; m: number; d: number; hh: number; mm: number; weekday: DayKey; date: string };

/** formatToParts is the only Intl entry point that hands back every field at once. */
function partsOf(d: Date, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

/** An instant's wall-clock date/time and weekday in a given zone. */
export function zonedParts(d: Date, tz: string): ZonedParts {
  const p = partsOf(d, tz);
  const y = Number.parseInt(p.year, 10);
  const m = Number.parseInt(p.month, 10);
  const day = Number.parseInt(p.day, 10);
  // Intl's 24h hour12:false can print "24" for midnight; normalize to 0.
  const hh = Number.parseInt(p.hour, 10) % 24;
  const mm = Number.parseInt(p.minute, 10);
  const weekday = WEEKDAY_TO_KEY[p.weekday] ?? "mon";
  return { y, m, d: day, hh, mm, weekday, date: `${pad4(y)}-${pad2(m)}-${pad2(day)}` };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * A wall-clock "YYYY-MM-DD" + "HH:MM" in `tz` → the UTC instant it names.
 *
 * There is no direct API for this, so we guess (treat the wall-clock as if it
 * were UTC), see what that guess reads back as in `tz`, and correct by the
 * difference — once. One correction is enough because the offset a timezone
 * uses only changes at DST transitions, and those are at least an hour apart
 * from any offset change a single correction could straddle.
 */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, mo, da] = date.split("-").map((s) => Number.parseInt(s, 10));
  const [hh, mm] = time.split(":").map((s) => Number.parseInt(s, 10));
  const guess = new Date(Date.UTC(y, (mo || 1) - 1, da || 1, hh || 0, mm || 0, 0, 0));
  const got = zonedParts(guess, tz);
  const gotUtc = Date.UTC(got.y, got.m - 1, got.d, got.hh, got.mm, 0, 0);
  const wantUtc = Date.UTC(y, (mo || 1) - 1, da || 1, hh || 0, mm || 0, 0, 0);
  const diff = wantUtc - gotUtc;
  return new Date(guess.getTime() + diff);
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

/** The "YYYY-MM-DD" an instant falls on in a zone — shorthand over zonedParts. */
export function ymd(d: Date, tz: string): string {
  return zonedParts(d, tz).date;
}

/**
 * `date` shifted by `n` calendar days, with no timezone involved at all — the
 * string is parsed and rebuilt with Date.UTC so a day never gets dropped or
 * doubled by a DST transition landing on it.
 */
export function shiftDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map((s) => Number.parseInt(s, 10));
  const shifted = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return `${pad4(shifted.getUTCFullYear())}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** Intl.DateTimeFormat over an instant in a zone, with booking-card-friendly defaults. */
export function formatInZone(d: Date, tz: string, opts?: Intl.DateTimeFormatOptions): string {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...opts,
  };
  try {
    return new Intl.DateTimeFormat("en-US", options).format(d);
  } catch {
    return d.toISOString();
  }
}


/**
 * Pure text → hours, with no imports.
 *
 * Small businesses write their hours as prose ("9 AM–7 PM"), onboarding
 * scrapes that prose off a website, and the admin needs the same parser so a
 * typed-in value behaves the same as a scraped one. Never throws: a string
 * that doesn't parse becomes "closed" rather than an error the seeder has to
 * catch.
 */

import type { DayKey, HoursRange, WeeklyHours } from "./types";
import { DAY_KEYS } from "./types";
import { pad2 } from "./time";

type Token = { hour: number; minute: number; meridiem: "am" | "pm" | null };

/** "9", "9am", "9:30 PM", "9:30a", "6p", "9 a.m.", "09:00", "17:00" → its hour/minute/explicit-meridiem. */
function parseToken(raw: string): Token | null {
  const s = raw.trim().toLowerCase();
  // The meridiem as small businesses write it: am / pm, a / p, a.m. / p.m.
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])(?:\.?m\.?)?$/) ?? s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hour = Number.parseInt(m[1], 10);
  const minute = m[2] ? Number.parseInt(m[2], 10) : 0;
  const meridiem = m[3] === "a" ? "am" : m[3] === "p" ? "pm" : null;
  if (hour > 23 || minute > 59) return null;
  if (meridiem && hour > 12) return null; // "13pm" isn't a thing
  return { hour, minute, meridiem };
}

/** A token's hour, 0-23, once its (possibly absent) am/pm is applied. */
function tokenHour24(tok: Token): number {
  let h = tok.hour;
  if (tok.meridiem === "pm" && h < 12) h += 12;
  if (tok.meridiem === "am" && h === 12) h = 0;
  return h;
}

/** One "9am - 1pm" / "9:30-18:00" / "9 - 5" chunk → a range, or null if it doesn't parse. */
function parseSingleRange(raw: string): HoursRange | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s*(?:-|–|—|\bto\b)\s*/i);
  if (parts.length !== 2) return null;
  const startTok = parseToken(parts[0]);
  const endTok = parseToken(parts[1]);
  if (!startTok || !endTok) return null;

  const startHour = tokenHour24(startTok);
  let endHour = tokenHour24(endTok);

  // Ambiguous bare numbers ("9-5", "3pm-5"): a closing hour that reads as at
  // or before the (already-resolved) opening hour, and is itself ≤ 12, must
  // be the afternoon — nobody closes before they open.
  if (!endTok.meridiem && endTok.hour <= 12 && endTok.hour <= startHour && endTok.hour !== 12) {
    endHour = endTok.hour + 12;
  }

  const start = `${pad2(startHour)}:${pad2(startTok.minute)}`;
  const end = `${pad2(endHour)}:${pad2(endTok.minute)}`;
  return { start, end };
}

/**
 * "9 AM–7 PM", "9am-5pm", "9:30a – 6p", "9 a.m. - 5 p.m.", "9:30 AM - 6:00 PM",
 * "09:00-17:00", "9 - 5", "Closed", "" (→ closed), "9am - 1pm, 2pm - 6pm"
 * (two ranges), "24 hours". A day range in front ("Tues. – Sat., 9:30a – 6p")
 * is skipped as a segment that isn't a time.
 */
export function parseHoursText(text: string): HoursRange[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  if (/^closed$/i.test(raw)) return [];
  if (/^24\s*(?:hours?|hrs?)?$/i.test(raw) || /^24\s*\/\s*7$/.test(raw)) {
    return [{ start: "00:00", end: "23:59" }];
  }
  const segments = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: HoursRange[] = [];
  for (const seg of segments) {
    const r = parseSingleRange(seg);
    if (r) out.push(r);
  }
  return out;
}

const LONG_DAY_TO_KEY: Record<string, DayKey> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
};

/** Onboarding's {monday: "9 AM–7 PM", ...} (long or 3-letter day names) → WeeklyHours, or null if every day is closed. */
export function weeklyHoursFrom(hours: Record<string, string>): WeeklyHours | null {
  const out = {} as WeeklyHours;
  for (const k of DAY_KEYS) out[k] = [];
  for (const [rawKey, value] of Object.entries(hours ?? {})) {
    const key = rawKey.trim().toLowerCase();
    const dayKey: DayKey | undefined = (DAY_KEYS as readonly string[]).includes(key)
      ? (key as DayKey)
      : LONG_DAY_TO_KEY[key];
    if (!dayKey) continue;
    out[dayKey] = parseHoursText(value);
  }
  return DAY_KEYS.some((d) => out[d].length > 0) ? out : null;
}

// ── US state → IANA zone ───────────────────────────────────────────────────
// A state split across zones is mapped to the zone most of its population
// lives in (e.g. Texas → Central despite El Paso's Mountain corner).

const STATE_ZONE: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Denver",
  IL: "America/Chicago",
  IN: "America/New_York",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/New_York",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  "District of Columbia": "DC",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};

// Longest names first so "North Carolina" wins over a stray "Carolina"-less
// match, and so state names sharing a prefix never shadow one another.
const STATE_NAMES_BY_LENGTH = Object.keys(STATE_NAME_TO_ABBR).sort((a, b) => b.length - a.length);

/**
 * A US state — name or 2-letter abbreviation — found in a free-text address
 * → its IANA zone. The abbreviation only counts in the standard
 * ", ST 12345" position (an abbreviation loose in prose is too likely to be
 * an ordinary word); a full state name counts anywhere, word-bounded.
 */
export function timezoneFromAddress(address: string): string | null {
  const addr = address ?? "";

  const zipMatch = addr.match(/,\s*([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/);
  if (zipMatch) {
    const zone = STATE_ZONE[zipMatch[1].toUpperCase()];
    if (zone) return zone;
  }

  for (const name of STATE_NAMES_BY_LENGTH) {
    const re = new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i");
    if (re.test(addr)) {
      const zone = STATE_ZONE[STATE_NAME_TO_ABBR[name]];
      if (zone) return zone;
    }
  }

  return null;
}

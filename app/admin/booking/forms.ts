/**
 * Small, pure FormData → value helpers shared by the booking admin's server
 * actions (app/admin/actions.ts). Kept apart from actions.ts so they can be
 * unit-checked without a request context — actions.ts stays thin auth
 * wrappers, these do the parsing.
 */

import { DAY_KEYS, isTime, type WeeklyHours, type HoursRange } from "@/lib/booking/types";

/** WeeklyHoursEditor never renders more than this many ranges a day. */
const MAX_RANGES_PER_DAY = 4;

/**
 * Build a WeeklyHours from a WeeklyHoursEditor's hidden inputs, named
 * "<prefix>.<day>.<i>.start" / "<prefix>.<day>.<i>.end" (mon/tue/… × up to
 * MAX_RANGES_PER_DAY). A day with no valid range comes back empty — the same
 * "empty array = closed" rule sanitizeWeeklyHours applies, so a day the
 * editor left blank (its "Closed" box checked) round-trips as closed.
 */
export function hoursFromForm(formData: FormData, prefix: string): WeeklyHours {
  const out = {} as WeeklyHours;
  for (const day of DAY_KEYS) {
    const ranges: HoursRange[] = [];
    for (let i = 0; i < MAX_RANGES_PER_DAY; i++) {
      const start = String(formData.get(`${prefix}.${day}.${i}.start`) ?? "").trim();
      const end = String(formData.get(`${prefix}.${day}.${i}.end`) ?? "").trim();
      if (isTime(start) && isTime(end) && start < end) ranges.push({ start, end });
    }
    out[day] = ranges;
  }
  return out;
}

/** A form field as a finite number, or undefined when blank/invalid. */
export function numOrUndef(v: FormDataEntryValue | null): number | undefined {
  const n = Number.parseFloat(String(v ?? "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/** A form field as a whole number, or undefined when blank/invalid. */
export function intOrUndef(v: FormDataEntryValue | null): number | undefined {
  const n = numOrUndef(v);
  return n === undefined ? undefined : Math.round(n);
}

/** A form field as a whole number, falling back when blank/invalid. */
export function intOr(v: FormDataEntryValue | null, fallback: number): number {
  return intOrUndef(v) ?? fallback;
}

/** A form field as trimmed text, or undefined when blank — so a caller can
 *  tell "left blank" (keep the stored value) apart from "cleared". */
export function strOrUndef(v: FormDataEntryValue | null): string | undefined {
  const s = String(v ?? "").trim();
  return s || undefined;
}

/** A comma/newline-separated list field → trimmed, deduped, non-empty parts. */
export function listOf(v: FormDataEntryValue | null): string[] {
  return [
    ...new Set(
      String(v ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

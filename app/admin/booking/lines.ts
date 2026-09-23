/**
 * Pure line-based parsers/formatters for the admin's price-list-style
 * textareas — the BookingFieldForm menu idiom (`app/admin/BookingFieldForm.tsx`,
 * `parseOptionLines`) applied to service variants, add-ons, promo codes,
 * memberships, holidays and staff time off. Each parser never throws: a
 * malformed line is dropped, not fatal, so a stray keystroke in a textarea
 * can't lock up the form. Formatters are the inverse, so a saved row reopens
 * exactly as it was typed (modulo the same lossy normalization every price
 * label in this codebase already accepts — "$45" round-trips, a range keeps
 * both ends, "from $45" reads back as "From $45").
 *
 * Owned by the admin surface; the shapes and sanitizers themselves come from
 * lib/booking/types.ts (import-free, shared with the card and the store).
 */

import {
  pricingFromText,
  pricingLabel,
  slugId,
  isDate,
  type ServiceVariant,
  type ServiceAddon,
  type PromoCode,
  type Membership,
  type Holiday,
  type TimeOff,
} from "@/lib/booking/types";

/** One "|"-delimited line, each cell trimmed. */
const cells = (line: string): string[] => line.split("|").map((c) => c.trim());

const linesOf = (text: string): string[] =>
  String(text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Drop the trailing empty cells so `formatX` output reads clean, not
 *  "Name | | |". Keeps at least one cell (the name). */
function joinCells(parts: string[]): string {
  const out = [...parts];
  while (out.length > 1 && !out[out.length - 1]) out.pop();
  return out.join(" | ");
}

// ── Service variants: Name | price | minutes | description ─────────────────
// Price is free text ("$45", "from $45", "$45–80", "quote") read through
// pricingFromText, the same rule the onboarding extractor uses for a menu.

export function parseVariantLines(text: string): ServiceVariant[] {
  const out: ServiceVariant[] = [];
  const seen = new Set<string>();
  for (const line of linesOf(text)) {
    const [name, priceText, minutesText, description] = cells(line);
    if (!name) continue;
    const id = slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const variant: ServiceVariant = { id, name };
    if (priceText) variant.pricing = pricingFromText(priceText);
    const minutes = Number.parseInt(minutesText ?? "", 10);
    if (Number.isFinite(minutes) && minutes > 0) variant.durationMinutes = minutes;
    if (description) variant.description = description;
    out.push(variant);
  }
  return out;
}

export function formatVariantLines(variants: ServiceVariant[] | undefined): string {
  return (variants ?? [])
    .map((v) =>
      joinCells([
        v.name,
        v.pricing ? pricingLabel(v.pricing) : "",
        v.durationMinutes ? String(v.durationMinutes) : "",
        v.description ?? "",
      ]),
    )
    .join("\n");
}

// ── Service add-ons: Name | price | minutes | description ──────────────────
// Price here is a plain number — an add-on is always a flat amount, never a
// range or a quote, so it needs none of pricingFromText's guesswork.

export function parseAddonLines(text: string): ServiceAddon[] {
  const out: ServiceAddon[] = [];
  const seen = new Set<string>();
  for (const line of linesOf(text)) {
    const [name, priceText, minutesText, description] = cells(line);
    if (!name) continue;
    const id = slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const addon: ServiceAddon = { id, name };
    if (priceText) {
      const price = Number.parseFloat(priceText.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(price) && price >= 0) addon.price = Math.round(price * 100) / 100;
    }
    const minutes = Number.parseInt(minutesText ?? "", 10);
    if (Number.isFinite(minutes) && minutes > 0) addon.durationMinutes = minutes;
    if (description) addon.description = description;
    out.push(addon);
  }
  return out;
}

export function formatAddonLines(addons: ServiceAddon[] | undefined): string {
  return (addons ?? [])
    .map((a) =>
      joinCells([
        a.name,
        a.price !== undefined ? String(a.price) : "",
        a.durationMinutes ? String(a.durationMinutes) : "",
        a.description ?? "",
      ]),
    )
    .join("\n");
}

// ── Promo codes: CODE | 10% | note | 2026-12-31 | serviceId,serviceId ──────

export function parsePromoLines(text: string): PromoCode[] {
  const out: PromoCode[] = [];
  const seen = new Set<string>();
  for (const line of linesOf(text)) {
    const [codeText, amountText, note, expiresOn, serviceIdsText] = cells(line);
    const code = (codeText ?? "").toUpperCase().replace(/\s+/g, "");
    if (!code || seen.has(code)) continue;
    const amount = Number.parseFloat((amountText ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    seen.add(code);
    out.push({
      code,
      kind: /%/.test(amountText ?? "") ? "percent" : "fixed",
      amount,
      serviceIds: (serviceIdsText ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      expiresOn: isDate(expiresOn) ? expiresOn : "",
      note: note ?? "",
    });
  }
  return out;
}

export function formatPromoLines(promos: PromoCode[] | undefined): string {
  return (promos ?? [])
    .map((p) =>
      joinCells([
        p.code,
        p.kind === "percent" ? `${p.amount}%` : String(p.amount),
        p.note ?? "",
        p.expiresOn ?? "",
        p.serviceIds.join(","),
      ]),
    )
    .join("\n");
}

// ── Memberships: Name | 15% ──────────────────────────────────────────────

export function parseMembershipLines(text: string): Membership[] {
  const out: Membership[] = [];
  const seen = new Set<string>();
  for (const line of linesOf(text)) {
    const [name, percentText] = cells(line);
    if (!name) continue;
    const id = slugId(name);
    if (seen.has(id)) continue;
    const discountPercent = Number.parseFloat((percentText ?? "").replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) continue;
    seen.add(id);
    out.push({ id, name, discountPercent });
  }
  return out;
}

export function formatMembershipLines(memberships: Membership[] | undefined): string {
  return (memberships ?? []).map((m) => `${m.name} | ${m.discountPercent}%`).join("\n");
}

// ── Holidays: YYYY-MM-DD | label ────────────────────────────────────────

export function parseHolidayLines(text: string): Holiday[] {
  const out: Holiday[] = [];
  for (const line of linesOf(text)) {
    const [date, label] = cells(line);
    if (!isDate(date)) continue;
    out.push(label ? { date, label } : { date });
  }
  return out;
}

export function formatHolidayLines(holidays: Holiday[] | undefined): string {
  return (holidays ?? []).map((h) => (h.label ? `${h.date} | ${h.label}` : h.date)).join("\n");
}

// ── Staff time off: 2026-12-24 | 2026-12-27 | Holiday ───────────────────
// Kept simple, per the design: whole days in the business's own zone. A UTC
// midnight boundary is close enough for a day-granularity block — the
// availability engine only needs "these calendar days are out."

export function parseTimeOffLines(text: string): TimeOff[] {
  const out: TimeOff[] = [];
  for (const line of linesOf(text)) {
    const [startDate, endDate, label] = cells(line);
    if (!isDate(startDate) || !isDate(endDate ?? startDate)) continue;
    const start = new Date(`${startDate}T00:00:00.000Z`);
    // Half-open [start, end): the end date's whole day is included, so the
    // boundary sits at the NEXT day's midnight.
    const endExclusive = new Date(`${endDate || startDate}T00:00:00.000Z`);
    endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
    if (Number.isNaN(start.getTime()) || endExclusive <= start) continue;
    const item: TimeOff = { start: start.toISOString(), end: endExclusive.toISOString() };
    if (label) item.label = label;
    out.push(item);
  }
  return out;
}

export function formatTimeOffLines(timeOff: TimeOff[] | undefined): string {
  return (timeOff ?? [])
    .map((t) => {
      const start = t.start.slice(0, 10);
      const endExclusive = new Date(t.end);
      endExclusive.setUTCDate(endExclusive.getUTCDate() - 1);
      const end = endExclusive.toISOString().slice(0, 10);
      return t.label ? `${start} | ${end} | ${t.label}` : `${start} | ${end}`;
    })
    .join("\n");
}

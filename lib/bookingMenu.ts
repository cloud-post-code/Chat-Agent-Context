import type { FieldOption } from "./appointmentTypes";

/**
 * A business's services as menu options — one per service, carrying the price
 * and duration the site states, grouped the way the site groups them. The
 * booking flow's service step draws Service rows now; this shape is what an
 * older tenant's stored service question holds, and lib/booking/store.ts
 * reads it (and the services catalog) to write those rows once.
 *
 * Import-free apart from types.
 */

export type MenuService = {
  name: string;
  description: string;
  price?: string;
  duration?: string;
  category?: string;
};

/** The key an older onboarding wrote its service question under. */
export const SERVICE_PICKER_KEY = "service";

// A comma counts only between digit groups ("$1,200"), so the one ending a
// clause ("$35, 45 minutes") is not swallowed into the price.
const AMOUNT = /\p{Sc}\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/gu;
const DURATION =
  /\d+(?:\.\d+)?\s*(?:hours?|hrs?)\b(?:\s*(?:and\s*)?\d+\s*(?:minutes?|mins?)\b)?|\d+\s*(?:minutes?|mins?)\b/gi;

/**
 * The price a description states, in the description's own figures. One
 * amount is the price; "from $40" and "$40+" are a floor; several amounts
 * ("Short $30, long $45") are a floor at the lowest, since which one applies
 * depends on something the menu line doesn't say. Empty when no amount is
 * stated — never a guess.
 */
export function priceFromText(text: string): string {
  const found = [...text.matchAll(AMOUNT)];
  if (!found.length) return "";
  const value = (s: string) => Number.parseFloat(s.replace(/[^\d.]/g, ""));
  const distinct = [...new Set(found.map((m) => m[0].replace(/\s/g, "")))];
  if (distinct.length > 1) {
    const lowest = distinct.reduce((a, b) => (value(b) < value(a) ? b : a));
    return `${lowest}+`;
  }
  const at = found[0].index ?? 0;
  const before = text.slice(Math.max(0, at - 16), at);
  const after = text.slice(at + found[0][0].length, at + found[0][0].length + 8);
  const floor = /(?:from|starting at|starts at|start at)\s*$/i.test(before) || /^\s*(?:\+|and up)/i.test(after);
  return `${distinct[0]}${floor ? "+" : ""}`;
}

/** The one duration a description states; empty when it states none, or several. */
export function durationFromText(text: string): string {
  const found = text.match(DURATION) ?? [];
  return found.length === 1 ? found[0].replace(/\s+/g, " ") : "";
}

/** A description cut at a word, for a row that has to stay scannable. */
function brief(text: string, max = 140): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).replace(/[\s,;:.]+$/, "")}…`;
}

/** Whether a description says anything once its price and duration are taken out. */
function saysMore(description: string): boolean {
  const rest = description.replace(AMOUNT, " ").replace(DURATION, " ");
  return (rest.match(/\p{L}{3,}/gu) ?? []).length >= 2;
}

/**
 * One option per service. A stated price/duration wins; failing that, one is
 * read out of the description, which is where older catalogs (and sites that
 * write "Gel manicure, 45 minutes, $35") keep it.
 */
export function serviceOptions(services: MenuService[]): FieldOption[] {
  const options: FieldOption[] = [];
  for (const s of services) {
    const label = s.name.replace(/\s+/g, " ").trim();
    if (!label) continue;
    const description = (s.description ?? "").trim();
    const opt: FieldOption = { label };
    const price = (s.price ?? "").trim() || priceFromText(description);
    const duration = (s.duration ?? "").trim() || durationFromText(description);
    if (price) opt.price = price;
    if (duration) opt.duration = duration;
    if (description && saysMore(description)) opt.description = brief(description);
    if (s.category?.trim()) opt.group = s.category.trim();
    options.push(opt);
  }
  // Sections only help when they sort the menu; one section, or a section per
  // item, is a heading over nothing.
  const groups = new Set(options.map((o) => o.group ?? ""));
  if (groups.size < 2 || groups.size === options.length) for (const o of options) delete o.group;
  // Grouped options are drawn section by section, so keep each section's
  // options together, sections in the order the menu first names them.
  const order = [...new Set(options.map((o) => o.group ?? ""))];
  return options
    .map((o, i) => ({ o, i }))
    .sort((a, b) => order.indexOf(a.o.group ?? "") - order.indexOf(b.o.group ?? "") || a.i - b.i)
    .map(({ o }) => o);
}

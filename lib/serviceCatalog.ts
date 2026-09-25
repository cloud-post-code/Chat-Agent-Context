import { flat } from "@/lib/util/text";
/**
 * The text format of the services catalog, stated once for its writer
 * (lib/onboarding/services.ts) and its reader (servicesBlock in lib/cards.ts).
 *
 * Services are knowledge, not a table: onboarding saves them as one Source the
 * agent retrieves from, and the services card draws from that same record — so
 * what the card lists and what the agent can say about it never drift apart.
 * The record's rawText is therefore the structure: one paragraph per service,
 * the name on its first line and the description on the next.
 *
 * Import-free on purpose: the chat path reads this and must not drag the
 * onboarding crawler in behind it.
 */

export type ServiceItem = { name: string; description: string };

/** The title the services extractor gives its Source — how the card finds it. */
export const SERVICES_SOURCE_TITLE = "Services";

/** A line break inside a field would read as structure, so none survives. */
export function formatServiceCatalog(services: ServiceItem[]): string {
  return services
    .map((s) => ({ name: flat(s.name), description: flat(s.description) }))
    .filter((s) => s.name)
    .map((s) => (s.description ? `${s.name}\n${s.description}` : s.name))
    .join("\n\n");
}

/**
 * Records saved before this format existed hold "Name. Description" (or
 * "Name.") on one line per service. Such a record is recognizable as a whole:
 * every paragraph is a single line that ends with a period or has one inside
 * it. A current-format record only looks like that if no service has a
 * description AND every name carries a period — not a real catalog.
 */
function isLegacyCatalog(paragraphs: string[][]): boolean {
  return paragraphs.every(
    (lines) => lines.length === 1 && (lines[0].endsWith(".") || lines[0].includes(". ")),
  );
}

/** Never throws: text of any shape comes back as the services it can name. */
export function parseServiceCatalog(raw: string | null | undefined): ServiceItem[] {
  const paragraphs = (raw ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => flat(l)).filter(Boolean))
    .filter((lines) => lines.length > 0);
  if (!paragraphs.length) return [];

  if (isLegacyCatalog(paragraphs)) {
    return paragraphs.map(([line]) => {
      const cut = line.indexOf(". ");
      return cut === -1
        ? { name: line.replace(/\.$/, ""), description: "" }
        : { name: line.slice(0, cut), description: line.slice(cut + 2).trim() };
    });
  }
  return paragraphs.map(([name, ...rest]) => ({ name, description: rest.join(" ") }));
}

// ── Menu facts read out of prose ──────────────────────────────────────────

/** A service as the extractor reports it: the site's own name, description and stated facts. */
export type MenuService = {
  name: string;
  description: string;
  price?: string;
  duration?: string;
  category?: string;
};

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

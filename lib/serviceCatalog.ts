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
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

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
    .map((p) => p.split("\n").map(flat).filter(Boolean))
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

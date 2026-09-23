/**
 * The weekly-hours shape and its text serialization, split out of extract.ts
 * so a module that only needs these (lib/onboarding/save.ts) doesn't drag in
 * extract.ts's next/font import — that import breaks under plain `tsx` (no
 * Next.js runtime), which the bulk-site-builder proof runs under.
 */

export const DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
export type Hours = Record<(typeof DAYS)[number], string>;

export const emptyHours = (): Hours =>
  Object.fromEntries(DAYS.map((d) => [d, ""])) as Hours;

export function serializeHours(hours: Hours): string {
  const parts = DAYS.flatMap((d) =>
    hours[d] ? [`${d[0].toUpperCase()}${d.slice(1)}: ${hours[d]}`] : []);
  return parts.join("; ");
}

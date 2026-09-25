/**
 * Text helpers every module used to copy. Pure, import-free.
 */

/** A trimmed string capped at `max` characters; anything that isn't a string is "". */
export const str = (v: unknown, max = Infinity): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Like `str`, with internal whitespace collapsed to single spaces. */
export const flat = (v: unknown, max = Infinity): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Lowercase URL-safe slug: accents stripped, runs of anything that isn't a
 * letter or digit become one dash, no leading or trailing dash, at most
 * `max` characters. "" when nothing survives — callers pick the fallback.
 */
export function slugify(text: string, max = 40): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** A model's tag list, trimmed, lowercased, de-duplicated, capped at `max`. */
export function capTags(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of v) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

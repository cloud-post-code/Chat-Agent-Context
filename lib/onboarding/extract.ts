import type { Crawler, Page } from "./crawl";
import { HEADING_FONTS, type FontKey } from "@/lib/fonts";
import { saveBytes } from "@/lib/uploads";

/**
 * Steps 1 and 2 of guided onboarding: deterministic parsers over the crawled
 * site. Every field the site doesn't state stays EMPTY — the form is the
 * user's to correct, and a wrong guess presented as fact is worse than a
 * blank. That rule is why owner name only matches an explicit "Owner:" label
 * and never a bio's prose.
 */

export const DAYS = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
] as const;
export type Hours = Record<(typeof DAYS)[number], string>;

export type Location = { address: string; phone: string; hours: Hours };

export type CoreInfo = {
  company_name: string;
  owner_name: string;
  company_address: string;
  company_phone_number: string;
  company_email: string;
  company_hours: Hours;
  /** Every distinct address found, each with its own hours. locations[0]
   *  mirrors company_address/company_hours for backward compatibility. */
  locations: Location[];
};

export type ThemeExtract = {
  themeBodyFont: string;
  themeColors: Record<string, string>;
  themeRadius: "sharp" | "rounded" | "pill";
  themeFontSize: string;
  themeHeadingWeight: string;
  themeLogo: string;
};

const emptyHours = (): Hours =>
  Object.fromEntries(DAYS.map((d) => [d, ""])) as Hours;

/** "Monday–Friday 8:00am–4:30pm. Closed Saturday and Sunday." → per-day map. */
export function parseHours(text: string): Hours {
  const hours = emptyHours();
  const t = text.replace(/–|—/g, "-").toLowerCase();
  const day = "(monday|tuesday|wednesday|thursday|friday|saturday|sunday)";
  const time = "(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))";

  for (const m of t.matchAll(new RegExp(`${day}\\s*-\\s*${day}[:\\s]*${time}\\s*-\\s*${time}`, "g"))) {
    const from = DAYS.indexOf(m[1] as (typeof DAYS)[number]);
    const to = DAYS.indexOf(m[2] as (typeof DAYS)[number]);
    for (let i = from; i <= to && from >= 0; i++) hours[DAYS[i]] = `${m[3]}–${m[4]}`;
  }
  for (const m of t.matchAll(new RegExp(`${day}[:\\s]+${time}\\s*-\\s*${time}`, "g"))) {
    hours[m[1] as (typeof DAYS)[number]] = `${m[2]}–${m[3]}`;
  }
  for (const m of t.matchAll(new RegExp(`closed\\s+((?:${day}(?:\\s*(?:,|and)\\s*)?)+)`, "g"))) {
    for (const d of m[1].matchAll(new RegExp(day, "g"))) hours[d[1] as (typeof DAYS)[number]] = "";
  }
  return hours;
}

export function serializeHours(hours: Hours): string {
  const parts = DAYS.flatMap((d) =>
    hours[d] ? [`${d[0].toUpperCase()}${d.slice(1)}: ${hours[d]}`] : []);
  return parts.join("; ");
}

// Street address, tolerant of the "City ST 02481" form many small-business
// sites use (no comma before the state).
const ADDRESS_RE =
  /\d{1,5}\s+[A-Z][A-Za-z]*(?:\s[A-Za-z.]+){0,4}\s(?:Lane|Ln|Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Way|Court|Ct|Place|Pl)\.?,?\s+[A-Z][A-Za-z .]+?,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?/;
const PHONE_RE = /(?:\+1[ .-]?)?\(?\d{3}\)?[ .-]{0,2}\d{3}[ .-]{0,2}\d{4}/;

/**
 * Locations on one page. Sites that label them ("Location 1: …", "Address 2:
 * …") get segment-scoped parsing so each location keeps its own phone and
 * hours; otherwise every distinct address on the page becomes a location and
 * the page's hours attach to the first.
 */
function parsePageLocations(text: string): Location[] {
  const out: Location[] = [];
  const segments = text.split(/(?:location|address)\s*\d+\s*:/i);
  if (segments.length > 1) {
    for (const seg of segments.slice(1)) {
      const address = seg.match(ADDRESS_RE)?.[0]?.trim() ?? "";
      if (!address) continue;
      out.push({
        address,
        phone: seg.match(PHONE_RE)?.[0]?.trim().replace(/\s+-\s*/g, "-") ?? "",
        hours: parseHours(seg),
      });
    }
    if (out.length) return out;
  }
  const addresses = [...new Set([...text.matchAll(new RegExp(ADDRESS_RE, "g"))].map((m) => m[0].trim()))];
  return addresses.map((address, i) => ({
    address,
    phone: "",
    hours: i === 0 ? parseHours(text.match(/hours[:\s][^.]*(?:\.[^.]*(?:closed|open)[^.]*)?\.?/i)?.[0] ?? "") : emptyHours(),
  }));
}

/** Core business info from the homepage plus likely contact/about pages. */
export async function extractCoreInfo(crawler: Crawler, pages: Page[]): Promise<CoreInfo> {
  const info: CoreInfo = {
    company_name: "", owner_name: "", company_address: "",
    company_phone_number: "", company_email: "", company_hours: emptyHours(),
    locations: [],
  };

  const home = pages[0];
  if (home) {
    info.company_name =
      home.$('meta[property="og:site_name"]').attr("content")?.trim() ||
      (home.$("title").text() || "").split(/[—|·-]/)[0].trim() ||
      home.$("h1").first().text().trim();
  }

  for (const page of pages) {
    const text = page.$("body").text().replace(/\s+/g, " ");
    if (!info.owner_name) {
      const m = text.match(/(?:owner|proprietor)\s*:\s*([A-Z][a-zA-Z.'-]+(?:\s[A-Z][a-zA-Z.'-]+){0,3})/);
      if (m) info.owner_name = m[1].trim();
    }
    if (!info.company_phone_number) {
      const m = text.match(PHONE_RE);
      if (m) info.company_phone_number = m[0].trim();
    }
    if (!info.company_email) {
      const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (m && !/\.(png|jpg|svg|webp)$/i.test(m[0])) info.company_email = m[0];
    }
    // One location first; only then look for more — a page with labeled
    // "Location 1 / Location 2" blocks yields them all, each with own hours.
    // The same address on two pages is ONE location; a footer lists bare
    // addresses on every page while the contact page carries the hours, so
    // the copy that knows its hours wins the merge.
    for (const loc of parsePageLocations(text)) {
      const existing = info.locations.find(
        (l) => l.address.toLowerCase() === loc.address.toLowerCase(),
      );
      if (!existing) {
        info.locations.push(loc);
        continue;
      }
      const incomingHasHours = Object.values(loc.hours).some(Boolean);
      const existingHasHours = Object.values(existing.hours).some(Boolean);
      if (incomingHasHours && !existingHasHours) {
        existing.hours = loc.hours;
        if (loc.phone) existing.phone = loc.phone;
      } else if (!existing.phone && loc.phone) {
        existing.phone = loc.phone;
      }
    }
    const hoursText = text.match(/hours[:\s][^.]*(?:\.[^.]*(?:closed|open)[^.]*)?\.?/i)?.[0];
    if (hoursText && Object.values(info.company_hours).every((v) => !v)) {
      info.company_hours = parseHours(hoursText);
    }
  }
  // The first location doubles as the flat fields the rest of the app reads.
  if (info.locations[0]) {
    info.company_address = info.locations[0].address;
    const first = info.locations[0].hours;
    if (Object.values(first).some(Boolean)) info.company_hours = first;
    else info.locations[0].hours = info.company_hours;
  }
  return info;
}

// ── Theme ──

const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

function saturation(hex: string): number {
  const h = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function cssOf(pages: Page[]): string {
  return pages.map((p) => p.$("style").text()).join("\n");
}

/** Pick the curated font key whose family best matches the site's stack. */
function matchFont(family: string): string {
  const wanted = family.toLowerCase();
  for (const [key, v] of Object.entries(HEADING_FONTS) as [FontKey, { family: string }][]) {
    const first = v.family.split(",")[0].replace(/['"]/g, "").trim().toLowerCase();
    if (first && wanted.includes(first)) return key;
  }
  if (/georgia|garamond|times|serif/.test(wanted) && !/sans-serif/.test(wanted)) {
    return "libre-baskerville";
  }
  return "inter";
}

/** Closest supported theme values from the site's own CSS + logo image. */
export async function extractTheme(crawler: Crawler, pages: Page[]): Promise<ThemeExtract> {
  const css = cssOf(pages);
  const home = pages[0];

  // Colors: role them from declarations where possible, saturation otherwise.
  const colors: Record<string, string> = {};
  const bodyBlock = css.match(/body\s*{([^}]*)}/)?.[1] || "";
  const bg = bodyBlock.match(/background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/)?.[1];
  const text = bodyBlock.match(/[^-]color:\s*(#[0-9a-fA-F]{3,8})/)?.[1];
  if (bg) colors.bg = bg;
  if (text) colors.text = text;
  const all = [...new Set(css.match(HEX) || [])];
  const brand = all
    .filter((c) => c.toLowerCase() !== bg?.toLowerCase() && c.toLowerCase() !== text?.toLowerCase())
    .sort((a, b) => saturation(b) - saturation(a))[0];
  if (brand && saturation(brand) > 0.25) colors.primary = brand;

  // Radius: any pill-sized radius wins; no radius at all reads as sharp.
  const radii = [...css.matchAll(/border-radius:\s*(\d+)(px|%)/g)]
    .map((m) => (m[2] === "%" ? Number(m[1]) * 4 : Number(m[1])));
  const themeRadius: ThemeExtract["themeRadius"] =
    radii.some((r) => r >= 100) ? "pill" : radii.some((r) => r > 0) ? "rounded" : "sharp";

  const bodyFamily = bodyBlock.match(/font-family:\s*([^;}]+)/)?.[1] || "";
  const fontSize = bodyBlock.match(/font-size:\s*(\d{2})px/)?.[1] || "";
  const weight = css.match(/h[12][^{]*{[^}]*font-weight:\s*(\d{3})/)?.[1];
  const themeHeadingWeight =
    weight && ["500", "600", "700", "800"].includes(weight) ? weight : "";

  // Logo: exact file, converted into the app's upload store.
  let themeLogo = "";
  const logoSrc = home
    ?.$('img[class*="logo" i], img[alt*="logo" i], img[src*="logo" i]')
    .first()
    .attr("src");
  if (home && logoSrc) {
    const got = await crawler.loadBytes(crawler.resolve(logoSrc, home.url) || logoSrc);
    if (got) {
      const type = got.contentType || (logoSrc.endsWith(".png") ? "image/png" : "");
      try {
        themeLogo = `/api/uploads/${await saveBytes(got.bytes, type)}`;
      } catch {
        themeLogo = ""; // unsupported format (e.g. svg) — leave empty
      }
    }
  }

  return {
    themeBodyFont: matchFont(bodyFamily),
    themeColors: colors,
    themeRadius,
    themeFontSize: fontSize,
    themeHeadingWeight,
    themeLogo,
  };
}

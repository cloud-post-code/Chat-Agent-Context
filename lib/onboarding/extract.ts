import type { Crawler, Page } from "./crawl";
import { HEADING_FONTS } from "@/lib/fonts";
import { normalizeExtractedTheme } from "@/lib/theme";
import { saveBytes } from "@/lib/uploads";
import { llmCorpus, llmExtract } from "./knowledgeLlm";
import { themeCorpus } from "./themeCorpus";
import { DAYS, emptyHours, serializeHours } from "./hours";
import type { Hours } from "./hours";

export { DAYS, emptyHours, serializeHours } from "./hours";
export type { Hours } from "./hours";

/**
 * Steps 1 and 2 of guided onboarding: model extraction over the crawled site.
 * Every field the site doesn't state stays EMPTY — the form is the user's to
 * correct, and a wrong guess presented as fact is worse than a blank. The
 * prompts enforce that rule; the sanitizers below only validate the model's
 * output against the app's supported values, they never extract.
 */

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

export const CORE_SYSTEM_PROMPT = `You find a business's core contact details in text extracted from its website. The text contains multiple pages, each preceded by "=== <url>".

Rules:
- Report ONLY what the text literally states. Never guess or infer; a detail the text does not state stays "".
- "company_name" is the business's own name as the site presents it — not a tagline or a page title suffix.
- "company_phone_number" and "company_email" are the business's primary public contact details, copied as written.

Respond with ONLY this JSON, no other text:
{"company_name":"","company_phone_number":"","company_email":""}`;

const str = (v: unknown, max = 300): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Core business info from the homepage plus likely contact/about pages. */
export async function extractCoreInfo(
  crawler: Crawler,
  pages: Page[],
  log: (m: string) => void = () => {},
): Promise<CoreInfo> {
  const raw = await llmExtract(CORE_SYSTEM_PROMPT, llmCorpus(pages), 500, log);
  return {
    company_name: str(raw.company_name),
    owner_name: "", // the dedicated owners stage fills this in
    company_address: "",
    company_phone_number: str(raw.company_phone_number, 40),
    company_email: str(raw.company_email, 200),
    company_hours: emptyHours(),
    // Addresses and hours are NOT extracted here — the dedicated locations
    // stage (lib/onboarding/locations.ts) owns them, with its own discovery
    // and its own extraction prompt.
    locations: [],
  };
}

/**
 * Fold one extracted location into a list. The same address on two pages is
 * ONE location; a footer lists bare addresses on every page while a location
 * or contact page carries the hours, so the copy that knows its hours wins.
 */
export function mergeLocation(locations: Location[], loc: Location): void {
  const existing = locations.find(
    (l) => l.address.toLowerCase() === loc.address.toLowerCase(),
  );
  if (!existing) {
    locations.push(loc);
    return;
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

// ── Theme ──

export const THEME_SYSTEM_PROMPT = `You read what a website's rendered pages state about their visual theme. The input has a "RENDERED:" section (computed styles measured in a real browser: page background, text color, body font, prominent saturated fills with how many elements carry each, and control corner radius), a "CSS:" section (the site's own stylesheet text), and an "IMAGES:" section (one image per line: url | class | alt).

Rules:
- Report ONLY what the input states. A value you cannot find stays "".
- The RENDERED section is measured ground truth; when it and the CSS text disagree, RENDERED wins.
- "background" and "text_color" are the page body's background and text colors as hex values.
- "primary" is the site's most prominent saturated brand color as a hex value — not a gray, near-white, or near-black. Prefer the RENDERED fill that reads as the brand (buttons, headers, accents) over incidental colors. When the page background itself IS the brand color (a dark green or navy site), that hue is still the primary.
- "secondary" is the site's second brand color as a hex value — a genuinely different hue used for accents (gold on a green site, orange on a navy site), not a shade of "primary" and not a gray. "" when the site uses only one brand color.
- "font_key" is the closest match for the body font family, chosen from exactly this list: FONT_KEYS. The RENDERED body font is what the site actually uses — when it is not on the list, pick the list entry closest in style (a serif site gets a serif key, a geometric sans gets one). "" only when no body font appears anywhere.
- "radius" is "pill" when controls are rounded into pills (radius ≥ 100px or ≥ half the control height), "rounded" for any smaller nonzero radius, "sharp" when nothing is rounded.
- "font_size_px" is the body font size in pixels as a bare number string (e.g. "16"), "" when unstated.
- "heading_weight" is the h1/h2 font-weight, one of "500", "600", "700", "800", or "".
- "logo_url" is the url of the image that is the site's logo, copied exactly from the IMAGES list; "" when none of the listed images is a logo.

Respond with ONLY this JSON, no other text:
{"background":"","text_color":"","primary":"","secondary":"","font_key":"","radius":"","font_size_px":"","heading_weight":"","logo_url":""}`;

const HEX_VALUE = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;

const hexOr = (v: unknown): string | undefined =>
  typeof v === "string" && HEX_VALUE.test(v.trim()) ? v.trim() : undefined;


/** Closest supported theme values, extracted by the model from the site's own
 *  CSS and image list, then validated against the app's supported values. */
export async function extractTheme(
  crawler: Crawler,
  pages: Page[],
  log: (m: string) => void = () => {},
): Promise<ThemeExtract> {
  const { corpus, imageUrls } = await themeCorpus(crawler, pages);
  const system = THEME_SYSTEM_PROMPT.replace("FONT_KEYS", Object.keys(HEADING_FONTS).join(", "));
  const raw = await llmExtract(system, corpus, 500, log);

  const colors = { ...normalizeExtractedTheme({
    bg: hexOr(raw.background),
    text: hexOr(raw.text_color),
    primary: hexOr(raw.primary),
    accent: hexOr(raw.secondary),
  }) } as Record<string, string>;

  const fontKey = str(raw.font_key, 60);
  const radius = str(raw.radius, 10);
  const weight = str(raw.heading_weight, 3);
  const fontSize = str(raw.font_size_px, 4);

  // Logo: the model's pick must be an image the homepage actually lists; the
  // exact file is then converted into the app's upload store.
  let themeLogo = "";
  const home = pages[0];
  const logoSrc = str(raw.logo_url, 2000);
  if (home && logoSrc && imageUrls.includes(logoSrc)) {
    const got = await crawler.loadImageBytes(logoSrc);
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
    themeBodyFont: fontKey in HEADING_FONTS ? fontKey : "inter",
    themeColors: colors,
    themeRadius: radius === "pill" || radius === "rounded" ? radius : "sharp",
    themeFontSize: /^\d{2}$/.test(fontSize) ? fontSize : "",
    themeHeadingWeight: ["500", "600", "700", "800"].includes(weight) ? weight : "",
    themeLogo,
  };
}

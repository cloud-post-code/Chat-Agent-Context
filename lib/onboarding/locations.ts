import type { Crawler, Page } from "./crawl";
import {
  DAYS, emptyHours, mergeLocation, type Location,
} from "./extract";
import { llmCorpus, llmExtract } from "./knowledgeLlm";

/**
 * The dedicated locations-and-hours stage. Hours often live on their own
 * pages (a /locations index with one page per shop, an /hours page, the
 * contact page) rather than where the rest of the contact info sits, so this
 * stage does its own discovery and its own extraction prompt written for
 * exactly this job. Extraction is model-only; never invent; absent stays
 * empty.
 */

const LOCATIONS_SYSTEM_PROMPT = `You find a business's physical locations and opening hours in text extracted from its website.

Rules:
- Report ONLY locations and hours that literally appear in the text. Never guess, infer, or fill gaps. A field the text does not state stays "".
- One entry per distinct street address. The same address mentioned twice is one location; keep whichever mention includes hours or a phone number.
- Hours are per day. Copy the times as written (e.g. "9 AM–7 PM"). A day stated as closed is "". A day not mentioned is also "".
- If the business is online-only or the text shows no street address at all, return an empty locations list.

Respond with ONLY this JSON, no other text:
{"locations":[{"address":"","phone":"","hours":{"monday":"","tuesday":"","wednesday":"","thursday":"","friday":"","saturday":"","sunday":""}}]}`;

/**
 * Pages worth reading for locations/hours: nav links that say so, common
 * paths, and — when a /locations index exists — each location's own page
 * (the pattern behind titlecitybarbers.com, where every shop has one).
 */
export async function discoverLocationPages(
  crawler: Crawler,
  home: Page,
  preloaded: Page[],
): Promise<Page[]> {
  const seen = new Set<string>([home.url, ...preloaded.map((p) => p.url)]);
  const pages: Page[] = [home, ...preloaded];

  const candidates = crawler
    .navLinks(home)
    .filter((l) => /hours|locations?|visit|directions?|find us|contact/i.test(l.text))
    .map((l) => l.url);
  for (const p of ["/locations", "/location", "/hours", "/contact", "/visit", "/find-us"]) {
    const abs = crawler.resolve(p);
    if (abs) candidates.push(abs);
  }

  // Two levels, each loaded together (the crawler caps the open tabs) and
  // read back in candidate order: the candidates, then the pages they link.
  const urls = [...new Set(candidates)].slice(0, 8).filter((u) => !seen.has(u));
  urls.forEach((u) => seen.add(u));
  const found: { page: Page; subs: string[] }[] = [];
  for (const page of await Promise.all(urls.map((u) => crawler.load(u)))) {
    if (!page) continue;
    const subs = new Set<string>();
    // A locations INDEX links each location's own page — follow one level.
    if (/locations?\/?$/i.test(new URL(page.url).pathname)) {
      page.$("a").each((_, el) => {
        const href = page.$(el).attr("href");
        const abs = href ? crawler.resolve(href, page.url) : null;
        if (abs && /locations?\//i.test(new URL(abs).pathname) && !seen.has(abs)) subs.add(abs);
      });
    }
    const kept = [...subs].slice(0, 12);
    kept.forEach((u) => seen.add(u));
    found.push({ page, subs: kept });
  }
  const subPages = await Promise.all(
    found.map((f) => Promise.all(f.subs.map((u) => crawler.load(u)))),
  );
  found.forEach((f, i) => {
    pages.push(f.page);
    for (const sub of subPages[i]) if (sub) pages.push(sub);
  });
  return pages;
}

/** Model output → clean bounded Location[]. Anything malformed is dropped. */
function sanitize(raw: unknown): Location[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { locations?: unknown }).locations)) {
    return [];
  }
  const out: Location[] = [];
  for (const l of (raw as { locations: unknown[] }).locations.slice(0, 12)) {
    const loc = (l ?? {}) as Record<string, unknown>;
    const address = typeof loc.address === "string" ? loc.address.trim() : "";
    if (!address) continue;
    const rawHours = (loc.hours ?? {}) as Record<string, unknown>;
    const hours = emptyHours();
    for (const d of DAYS) {
      if (typeof rawHours[d] === "string") hours[d] = (rawHours[d] as string).trim();
    }
    out.push({
      address,
      phone: typeof loc.phone === "string" ? loc.phone.trim() : "",
      hours,
    });
  }
  return out;
}

function mergeAll(locs: Location[]): Location[] {
  const merged: Location[] = [];
  for (const loc of locs) mergeLocation(merged, loc);
  return merged;
}

/** All locations with their hours, deduped, extracted by the prompt from the
 *  discovered pages. */
export async function extractLocations(
  pages: Page[],
  log: (m: string) => void,
): Promise<Location[]> {
  log(`Location agent read ${pages.length} pages`);
  const raw = await llmExtract(LOCATIONS_SYSTEM_PROMPT, llmCorpus(pages), 2000, log);
  return mergeAll(sanitize(raw));
}

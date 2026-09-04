import { claude, claudeModel } from "@/lib/claude";
import type { Crawler, Page } from "./crawl";
import {
  DAYS, mergeLocation, parsePageLocations, type Hours, type Location,
} from "./extract";

/**
 * The dedicated locations-and-hours stage. Hours often live on their own
 * pages (a /locations index with one page per shop, an /hours page, the
 * contact page) rather than where the rest of the contact info sits, so this
 * stage does its own discovery and — when a model key is configured — its own
 * extraction prompt written for exactly this job. Without a key it falls back
 * to the deterministic parser. Either way: never invent; absent stays empty.
 */

export const LOCATIONS_SYSTEM_PROMPT = `You find a business's physical locations and opening hours in text extracted from its website.

Rules:
- Report ONLY locations and hours that literally appear in the text. Never guess, infer, or fill gaps. A field the text does not state stays "".
- One entry per distinct street address. The same address mentioned twice is one location; keep whichever mention includes hours or a phone number.
- Hours are per day. Copy the times as written (e.g. "9 AM–7 PM"). A day stated as closed is "". A day not mentioned is also "".
- If the business is online-only or the text shows no street address at all, return an empty locations list.

Respond with ONLY this JSON, no other text:
{"locations":[{"address":"","phone":"","hours":{"monday":"","tuesday":"","wednesday":"","thursday":"","friday":"","saturday":"","sunday":""}}]}`;

const emptyHours = (): Hours => Object.fromEntries(DAYS.map((d) => [d, ""])) as Hours;

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

  for (const url of [...new Set(candidates)].slice(0, 8)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await crawler.load(url);
    if (!page) continue;
    pages.push(page);
    // A locations INDEX links each location's own page — follow one level.
    if (/locations?\/?$/i.test(new URL(page.url).pathname)) {
      const subs = new Set<string>();
      page.$("a").each((_, el) => {
        const href = page.$(el).attr("href");
        const abs = href ? crawler.resolve(href, page.url) : null;
        if (abs && /locations?\//i.test(new URL(abs).pathname) && !seen.has(abs)) subs.add(abs);
      });
      for (const sub of [...subs].slice(0, 12)) {
        seen.add(sub);
        const subPage = await crawler.load(sub);
        if (subPage) pages.push(subPage);
      }
    }
  }
  return pages;
}

function pageText(page: Page): string {
  const clone = page.$("body").clone();
  clone.find("script, style").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

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

async function promptExtract(pages: Page[], log: (m: string) => void): Promise<Location[] | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const corpus = pages
    .map((p) => `=== ${p.url}\n${pageText(p).slice(0, 3500)}`)
    .join("\n\n")
    .slice(0, 40_000);
  try {
    const res = await claude().messages.create({
      model: claudeModel(),
      max_tokens: 2000,
      system: LOCATIONS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: corpus }],
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? sanitize(JSON.parse(json)) : null;
  } catch (err) {
    log(`Model extraction unavailable (${err instanceof Error ? err.message.slice(0, 60) : "error"}) — using the pattern parser`);
    return null;
  }
}

function mergeAll(locs: Location[]): Location[] {
  const merged: Location[] = [];
  for (const loc of locs) mergeLocation(merged, loc);
  return merged;
}

/** All locations with their hours, deduped, from the discovered pages. Runs
 *  both the model prompt and the deterministic parser and keeps whichever
 *  found more distinct addresses — the parser catches per-shop pages the
 *  prompt's corpus budget may have truncated, the prompt catches prose the
 *  regex can't. */
export async function extractLocations(
  pages: Page[],
  log: (m: string) => void,
): Promise<Location[]> {
  log(`Location agent read ${pages.length} pages`);
  const parsed = mergeAll(pages.flatMap((p) => parsePageLocations(pageText(p))));
  const fromPrompt = mergeAll((await promptExtract(pages, log)) ?? []);
  return fromPrompt.length > parsed.length ? fromPrompt : parsed;
}

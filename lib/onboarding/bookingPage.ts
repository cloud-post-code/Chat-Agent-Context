import type { Page } from "./crawl";

/**
 * The business's own booking page — where its real menu and its real booking
 * questions are. Most small businesses book through an offsite widget
 * (GoCheckIn, Vagaro, Square…), which the origin-pinned crawler never sees, so
 * this is the one offsite page onboarding may read: a single link, taken from
 * the business's own homepage, held to `isSafeExternalUrl`.
 */

/** Hosts that are booking products: a link to one is a booking link whatever it says. */
const BOOKING_HOSTS =
  /(^|\.)(gocheckin\.net|vagaro\.com|squareup\.com|square\.site|booksy\.com|fresha\.com|acuityscheduling\.com|as\.me|calendly\.com|mindbodyonline\.com|schedulicity\.com|setmore\.com|simplybook\.me|glossgenius\.com|styleseat\.com|opentable\.com|resy\.com|exploretock\.com|housecallpro\.com|jobber\.com|getjobber\.com|zenoti\.com|boulevard\.io|joinblvd\.com|genbook\.com|appointy\.com|cal\.com)$/i;
const BOOKING_WORDS = /\b(book(ing|ings)?|appointments?|schedul(e|ing)|reserv(e|ation|ations))\b/i;
/** Where a business is talked about, not booked. */
const NOT_BOOKING =
  /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|pinterest\.com|yelp\.com|google\.com|goo\.gl|maps\.app\.goo\.gl)$/i;

/** Public `https` hostnames only: no IP literals, no names that stay inside a network. */
export function isSafeExternalUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || /^[\d.]+$/.test(host) || !host.includes(".")) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(host);
}

/**
 * The booking link on a page, or null. A known booking host beats a link that
 * only says "book"; offsite beats on-site (the on-site ones are already
 * candidates in `discoverServicePages`); first in document order breaks ties.
 */
export function findBookingLink(page: Page): string | null {
  let origin: string;
  try {
    origin = new URL(page.url).origin;
  } catch {
    return null;
  }
  let best: { url: string; score: number } | null = null;
  page.$("a[href]").each((_, el) => {
    const href = page.$(el).attr("href") ?? "";
    let u: URL;
    try {
      u = new URL(href, page.url);
    } catch {
      return;
    }
    if (!/^https?:$/.test(u.protocol) || NOT_BOOKING.test(u.hostname)) return;
    const offsite = u.origin !== origin;
    if (offsite && !isSafeExternalUrl(u.href)) return;
    const platform = BOOKING_HOSTS.test(u.hostname);
    const text = `${page.$(el).text()} ${page.$(el).attr("aria-label") ?? ""} ${page.$(el).attr("title") ?? ""}`;
    const says = BOOKING_WORDS.test(text) || BOOKING_WORDS.test(u.pathname.replace(/[-_/]/g, " "));
    if (!platform && !says) return;
    const score = (platform ? 4 : 0) + (offsite ? 2 : 0) + (says ? 1 : 0);
    if (!best || score > best.score) best = { url: u.href, score };
  });
  return (best as { url: string } | null)?.url ?? null;
}

const BOOKING_PAGE_CHARS = 9000;

const GRAM = 6;

/**
 * Drop boilerplate a widget repeats: any run of six words seen three times or
 * more is kept where it first appears and removed everywhere after. Menu rows
 * survive — "Manicure add on $10.00" twice is a menu, not boilerplate.
 */
function dropRepeats(text: string): string {
  const words = text.split(" ");
  const gram = (i: number) => words.slice(i, i + GRAM).join(" ").toLowerCase();
  const count = new Map<string, number>();
  for (let i = 0; i + GRAM <= words.length; i++) count.set(gram(i), (count.get(gram(i)) ?? 0) + 1);
  const seen = new Set<string>();
  const drop = new Set<number>();
  for (let i = 0; i + GRAM <= words.length; i++) {
    const g = gram(i);
    if ((count.get(g) ?? 0) < 3) continue;
    if (seen.has(g)) for (let j = i; j < i + GRAM; j++) drop.add(j);
    seen.add(g);
  }
  return words.filter((_, i) => !drop.has(i)).join(" ");
}

/**
 * A booking page as extraction text. Widgets repeat the same modal under every
 * category ("No staff available… OK", forty times over), which would spend the
 * budget before the menu ends.
 */
export function bookingCorpus(page: Page): string {
  const clone = page.$("body").clone();
  clone.find("script, style, noscript").remove();
  const text = dropRepeats(clone.text().replace(/\s+/g, " ").trim());
  return `=== BOOKING PAGE ${page.url}\n${text.slice(0, BOOKING_PAGE_CHARS)}`;
}

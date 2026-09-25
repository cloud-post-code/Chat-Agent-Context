import type { Page } from "./crawl";
import { isPublicHostname } from "./netGuard";

/**
 * The business's own booking page — where its real menu and its real booking
 * questions are. Most small businesses book through an offsite widget
 * (GoCheckIn, Vagaro, Square…), which the origin-pinned crawler never sees, so
 * this is the one offsite page onboarding may read: a single link, taken from
 * the business's own homepage, held to `isSafeExternalUrl`.
 */

/** Hosts that are booking products: a link to one is a booking link whatever it says. */
export const BOOKING_HOSTS =
  /(^|\.)(gocheckin\.net|vagaro\.com|squareup\.com|square\.site|booksy\.com|fresha\.com|acuityscheduling\.com|as\.me|calendly\.com|mindbodyonline\.com|schedulicity\.com|setmore\.com|simplybook\.me|glossgenius\.com|styleseat\.com|opentable\.com|resy\.com|exploretock\.com|housecallpro\.com|jobber\.com|getjobber\.com|zenoti\.com|boulevard\.io|joinblvd\.com|genbook\.com|appointy\.com|cal\.com)$/i;
// A trade's booking is a request: "Get a Quote", "Request Estimate".
const BOOKING_WORDS =
  /\b(book(ing|ings)?|appointments?|schedul(e|ing)|reserv(e|ation|ations)|(get|request|free)[\w\s]{0,12}(quote|estimate)|(quote|estimate)[\s-]?(request|form)?)\b/i;
/** Form products a business embeds its booking or quote form from. */
export const FORM_HOSTS =
  /(^|\.)(jotform\.com|typeform\.com|cleangenie\.com|leadconnectorhq\.com|msgsndr\.com|hsforms\.com|cognitoforms\.com|wufoo\.com|paperform\.co|tally\.so)$/i;
/** A platform selling itself — "Powered by", ambassador and referral links — not a business's page on it. */
const PLATFORM_ADVERT = /^\/(industries|features|pricing|blog|about|partners?|lp)?(\/|$)|[?&]utm_campaign=/i;
/** Where a business is talked about, not booked. */
const NOT_BOOKING =
  /(^|\.)(facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|youtube\.com|linkedin\.com|pinterest\.com|yelp\.com|google\.com|goo\.gl|maps\.app\.goo\.gl)$/i;

/**
 * Public `https` hostnames only: no IP literals, no names that stay inside a
 * network (netGuard.ts `isPublicHostname`). Syntactic — what the name
 * resolves to is checked where the browser opens it (`isPublicTarget`).
 */
export function isSafeExternalUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  return isPublicHostname(host);
}

/**
 * Whether a url the reader is on — the entered site itself, or the one
 * offsite booking page — may be read: http(s) to a public hostname. The
 * page's own origin gets no exemption: it is what the tenant typed.
 */
export function isReadableUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return false;
  return isPublicHostname(u.hostname);
}

/**
 * The booking link across every page read so far, or null. A known booking
 * host beats a link that only says "book"; offsite beats on-site (the
 * on-site ones are already candidates in `discoverServicePages`); the
 * highest score across every page wins, first in document order breaking a
 * tie — a business's nav usually repeats the same link on every page, but a
 * site whose "Book" link sits on a page other than the homepage (a services
 * or contact page, say) is still found.
 */
export function findBookingLink(pages: Page[]): string | null {
  let best: { url: string; score: number } | null = null;
  for (const page of pages) {
    let origin: string;
    try {
      origin = new URL(page.url).origin;
    } catch {
      continue;
    }
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
      const platform = BOOKING_HOSTS.test(u.hostname) && !PLATFORM_ADVERT.test(u.pathname + u.search);
      if (BOOKING_HOSTS.test(u.hostname) && !platform) return;
      const text = `${page.$(el).text()} ${page.$(el).attr("aria-label") ?? ""} ${page.$(el).attr("title") ?? ""}`;
      const says = BOOKING_WORDS.test(text) || BOOKING_WORDS.test(u.pathname.replace(/[-_/]/g, " "));
      if (!platform && !says) return;
      const score = (platform ? 4 : 0) + (offsite ? 2 : 0) + (says ? 1 : 0);
      if (!best || score > best.score) best = { url: u.href, score };
    });
  }
  return (best as { url: string } | null)?.url ?? null;
}

/** The registrable-domain-ish suffix ("bethanytaryn.com" out of "shop.bethanytaryn.com"): the last two dot-separated labels — a rough stand-in for a public-suffix lookup, good enough to tell a business's own other subdomain from an unrelated host. */
function baseDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".");
  return parts.slice(-2).join(".");
}

/**
 * A same-business subdomain the page links to that isn't the site itself —
 * "shop.", "store.", "book.", "schedule." storefronts are common enough that
 * the real booking page sometimes lives one hop further, on a page discovery
 * hasn't loaded yet. Null when the page links to no other subdomain of its
 * own domain. First such link in document order wins.
 */
export function findSiblingSubdomain(page: Page): string | null {
  let entryHost: string;
  try {
    entryHost = new URL(page.url).hostname;
  } catch {
    return null;
  }
  const base = baseDomain(entryHost);
  let found: string | null = null;
  page.$("a[href]").each((_, el) => {
    if (found) return;
    const href = page.$(el).attr("href") ?? "";
    let u: URL;
    try {
      u = new URL(href, page.url);
    } catch {
      return;
    }
    if (u.hostname === entryHost || baseDomain(u.hostname) !== base) return;
    if (!isSafeExternalUrl(u.href)) return;
    found = u.origin + "/";
  });
  return found;
}

/**
 * Booking and form widgets embedded in a page. Most "Book now" pages are an
 * empty shell around one of these, so the questions are only in the frame.
 */
export function findBookingFrames(page: Page): string[] {
  const out = new Set<string>();
  page.$("iframe[src]").each((_, el) => {
    const src = page.$(el).attr("src") ?? "";
    if (!isSafeExternalUrl(src)) return;
    const host = new URL(src).hostname;
    if (BOOKING_HOSTS.test(host) || FORM_HOSTS.test(host)) out.add(src);
  });
  return [...out];
}

/** A widget's whole menu: sixty priced rows with their headings fit in this
 *  with room to spare once repeated boilerplate is dropped. */
const BOOKING_PAGE_CHARS = 16000;

/** Whether a hostname is a booking product's, not the business's own site. */
export function isBookingHost(hostname: string): boolean {
  return BOOKING_HOSTS.test(hostname);
}

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

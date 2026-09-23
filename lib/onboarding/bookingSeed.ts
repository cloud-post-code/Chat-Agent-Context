import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { prisma } from "@/lib/db";
import type { Page } from "./crawl";
import type { Location } from "./extract";
import type { MenuService } from "@/lib/bookingMenu";
import { priceFromText, durationFromText } from "@/lib/bookingMenu";
import { durationMinutes } from "@/lib/appointmentTypes";
import { saveBytes } from "@/lib/uploads";
import {
  pricingFromText,
  sanitizeAddons,
  DEFAULT_TIMEZONE,
  defaultWeeklyHours,
  type Pricing,
  type Deposit,
  type ServiceRow,
} from "@/lib/booking/types";
import {
  listServices,
  saveService,
  listStaff,
  saveStaff,
  listLocations,
  saveLocation,
  saveBookingSettings,
  getBookingSettings,
} from "@/lib/booking/store";
import { bestImageFor } from "@/lib/booking/matchImages";
import { weeklyHoursFrom, timezoneFromAddress } from "@/lib/booking/hours";

/**
 * Onboarding's booking seeder: `Service`, `StaffMember`, `BookingLocation` and
 * `BookingSettings` rows from whatever the crawl and the sibling extractors
 * already found. Every write here is gated on the tenant's table being
 * EMPTY — re-onboarding, or onboarding a tenant who has since built their own
 * booking setup by hand, must never duplicate or overwrite a single row. Every
 * export is best-effort and never throws: a failure is logged through the
 * caller's `log` and the stage that called it moves on with an empty result.
 */

const MAX_DOWNLOADS_PER_RUN = 25;
const MAX_IMAGE_BYTES = 3_500_000;
const DOWNLOAD_TIMEOUT_MS = 10_000;

const errMsg = (err: unknown): string => (err instanceof Error ? err.message.slice(0, 160) : String(err));

// ── Pricing / duration from the extracted menu text ─────────────────────────

/** The service's own stated price, else one read out of its description,
 *  else "we don't know" ({kind:"variable"}) — never invented. */
export function pricingFromService(s: MenuService): Pricing {
  const stated = (s.price ?? "").trim();
  if (stated) return pricingFromText(stated);
  const fromDescription = priceFromText(s.description ?? "");
  if (fromDescription) return pricingFromText(fromDescription);
  return { kind: "variable" };
}

/** The service's own stated duration, else one read out of its description,
 *  else the tenant's default appointment length. */
export function durationFromService(s: MenuService, fallback: number): number {
  const stated = durationMinutes(s.duration);
  if (stated !== null) return stated;
  const fromDescription = durationMinutes(durationFromText(s.description ?? ""));
  if (fromDescription !== null) return fromDescription;
  return fallback;
}

// ── Image candidates from the crawled pages ──────────────────────────────────

/** Skip chrome, not content — the images.ts NOISE_RE precedent, slightly
 *  broader per this module's own contract. */
const NOISE_RE = /logo|icon|sprite|favicon|pixel|avatar|placeholder/i;

function absoluteImageUrl(raw: string, pageUrl: string): string | null {
  if (!raw || raw.startsWith("data:") || /\.svg(\?|$)/i.test(raw)) return null;
  try {
    const u = new URL(raw, pageUrl);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The nearest heading (h1–h4) that reads before this element: its own
 *  previous siblings first (or a heading nested in one of them), then its
 *  ancestors' previous siblings, walking up toward <body>. */
function nearestHeadingText($: CheerioAPI, el: Element): string {
  let node = $(el);
  let hops = 0;
  while (node.length && hops < 40) {
    let sib = node.prev();
    while (sib.length) {
      const tag = (sib.prop("tagName") as string | undefined) ?? "";
      if (/^h[1-4]$/i.test(tag)) return sib.text().trim();
      const inside = sib.find("h1, h2, h3, h4").last();
      if (inside.length) return inside.text().trim();
      sib = sib.prev();
      hops++;
    }
    node = node.parent();
    hops++;
    if (!node.length || node.is("body") || node.is("html")) break;
  }
  return "";
}

/** The nearest figcaption, else the nearest card-ish ancestor's own text. */
function nearestCardText($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const figcaption = $el.closest("figure").find("figcaption").first().text().trim();
  if (figcaption) return figcaption;
  let node = $el.parent();
  let hops = 0;
  while (node.length && hops < 10) {
    const cls = (node.attr("class") || "").toLowerCase();
    if (/\bcard\b/.test(cls)) return node.text().replace(/\s+/g, " ").trim();
    node = node.parent();
    hops++;
  }
  return "";
}

/** Every content image on the pages — rendered <img> plus CSS background
 *  images in inline styles — paired with the text around it to match a
 *  service or person's name against (lib/booking/matchImages.ts). */
export function serviceImageCandidates(pages: Page[]): { src: string; text: string }[] {
  const seen = new Set<string>();
  const out: { src: string; text: string }[] = [];
  const push = (raw: string, pageUrl: string, text: string) => {
    const abs = absoluteImageUrl(raw, pageUrl);
    if (!abs || NOISE_RE.test(raw) || seen.has(abs)) return;
    seen.add(abs);
    out.push({ src: abs, text: text.replace(/\s+/g, " ").trim().slice(0, 300) });
  };

  for (const page of pages) {
    page.$("img").each((_, el) => {
      const $el = page.$(el);
      const src = $el.attr("src") || $el.attr("data-src") || $el.attr("data-crawl-src") || "";
      if (!src) return;
      const hint = `${src} ${$el.attr("class") || ""}`;
      if (NOISE_RE.test(hint)) return;
      const w = Number($el.attr("width") || 0);
      const h = Number($el.attr("height") || 0);
      if ((w && w < 80) || (h && h < 80)) return; // stated-tiny: an icon
      const alt = $el.attr("alt") || "";
      const title = $el.attr("title") || "";
      const heading = nearestHeadingText(page.$, el);
      const card = nearestCardText(page.$, el);
      push(src, page.url, [alt, title, heading, card].filter(Boolean).join(" "));
    });
    page.$("[style]").each((_, el) => {
      const $el = page.$(el);
      const style = $el.attr("style") || "";
      if (!/background-image/i.test(style)) return;
      const m = style.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
      if (!m) return;
      push(m[2], page.url, $el.text());
    });
  }
  return out;
}

// ── Downloading a matched image ──────────────────────────────────────────────

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** The type the BYTES say they are — the images.ts sniffImageType precedent,
 *  kept local and small since it isn't exported there. */
function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e) return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/** Fetch one matched image and store it through the app's upload store.
 *  10s timeout, jpeg/png/webp/gif only, ≤ 3.5 MB. Null on any failure. */
export async function downloadImage(url: string): Promise<{ filename: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok) return null;
    const declared = (res.headers.get("content-type") || "").split(";")[0].trim();
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    const type = ALLOWED_TYPES.has(declared) ? declared : sniffImageType(buf);
    if (!type || !ALLOWED_TYPES.has(type)) return null;
    const filename = await saveBytes(buf, type);
    return { filename };
  } catch {
    return null;
  }
}

type Downloader = typeof downloadImage;

/** Resolve (and cache by url) the stored filename for a name matched against
 *  the page's image candidates. At most `MAX_DOWNLOADS_PER_RUN` fetches; every
 *  further match past the cap is skipped, not queued. */
async function resolveImage(
  name: string,
  candidates: { src: string; text: string }[],
  cache: Map<string, string | null>,
  downloads: { count: number },
  download: Downloader,
): Promise<string | null> {
  if (!candidates.length) return null;
  const match = bestImageFor(name, candidates);
  if (!match) return null;
  if (cache.has(match)) return cache.get(match) ?? null;
  if (downloads.count >= MAX_DOWNLOADS_PER_RUN) return null;
  downloads.count++;
  const got = await download(match);
  const filename = got?.filename ?? null;
  cache.set(match, filename);
  return filename;
}

// ── Services ──────────────────────────────────────────────────────────────

/** A MenuService plus the long-tail facts the services prompt may also report
 *  for a service: add-ons, a deposit, a cancellation policy, prep notes. Every
 *  one of these stays absent when the text doesn't state it — never invented. */
export type ExtractedService = MenuService & {
  addons?: { name: string; price?: string }[];
  deposit?: string;
  cancellationPolicy?: string;
  preparation?: string;
};

/** The first amount a short text names ("$20 deposit", "50%"), as a number. */
function amountFromText(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d[\d,]*(?:\.\d{1,2})?)/);
  if (!m) return undefined;
  const n = Number.parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/** "$20 deposit" → fixed; "50% deposit" → percent; anything else → none. */
function depositFromText(raw: string | undefined): Deposit | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  const amount = amountFromText(s);
  if (amount === undefined) return undefined;
  return /%/.test(s) ? { kind: "percent", amount } : { kind: "fixed", amount };
}

/**
 * Seed `Service` rows from the extracted menu, only when the tenant has none.
 * Each service gets its pricing and duration read from the text, and — when
 * the site's own pages carry a matching photo — a downloaded image. Never
 * throws: a service that fails to save is logged and skipped, and the loop
 * continues with the rest of the menu.
 */
export async function seedServices(
  userId: string,
  services: ExtractedService[],
  pages: Page[],
  log: (m: string) => void,
  deps: { download?: Downloader } = {},
): Promise<{ seeded: number; imaged: number }> {
  const download = deps.download ?? downloadImage;
  const result = { seeded: 0, imaged: 0 };
  if (!services.length) return result;

  try {
    if ((await listServices(userId)).length > 0) return result;
  } catch (err) {
    log(`Booking: couldn't check for existing services — ${errMsg(err)}`);
    return result;
  }

  let fallbackDuration = 60;
  try {
    fallbackDuration = (await getBookingSettings(userId)).defaultDurationMinutes;
  } catch {
    // Keep the built-in fallback — settings aren't required to seed services.
  }

  const candidates = serviceImageCandidates(pages);
  const cache = new Map<string, string | null>();
  const downloads = { count: 0 };

  for (const s of services) {
    try {
      const pricing = pricingFromService(s);
      const svcDuration = durationFromService(s, fallbackDuration);
      const imageFilename = await resolveImage(s.name, candidates, cache, downloads, download);
      if (imageFilename) result.imaged++;

      const addons = s.addons?.length
        ? sanitizeAddons(s.addons.map((a) => ({ name: a.name, price: amountFromText(a.price) })))
        : undefined;
      const deposit = depositFromText(s.deposit);

      const patch: Partial<ServiceRow> & { name: string; imageFilename?: string | null } = {
        name: s.name,
        category: s.category?.trim() || "",
        description: s.description || "",
        pricing,
        durationMinutes: svcDuration,
        imageFilename,
      };
      if (addons?.length) patch.addons = addons;
      if (deposit) patch.deposit = deposit;
      if (s.preparation) patch.preparation = s.preparation;
      if (s.cancellationPolicy) patch.cancellationPolicy = s.cancellationPolicy;

      const saved = await saveService(userId, patch);
      if (saved.ok) result.seeded++;
      else log(`Booking: couldn't save service "${s.name}" — ${saved.error}`);
    } catch (err) {
      log(`Booking: couldn't seed service "${s.name}" — ${errMsg(err)}`);
    }
  }
  return result;
}

// ── Staff ─────────────────────────────────────────────────────────────────

/** The bio's own opening title, when it reads as one ("Senior Stylist — ten
 *  years..." / "Owner, master barber."). "" when the bio doesn't open that way. */
function roleFromBio(bio: string): string {
  const text = (bio ?? "").trim();
  if (!text) return "";
  const m = text.match(/^([A-Z][A-Za-z&'.]+(?:\s+[A-Za-z&'.]+){0,4})\s*(?:[—–-]|,)/);
  return m ? m[1].trim() : "";
}

/**
 * Seed `StaffMember` rows from the team bios, only when the tenant has none.
 * A photo is matched the same way a service's is — by name against the
 * team/about pages' images. Never throws.
 */
export async function seedStaff(
  userId: string,
  people: { name: string; role?: string; bio: string }[],
  pages: Page[],
  log: (m: string) => void,
  deps: { download?: Downloader } = {},
): Promise<{ seeded: number; imaged: number }> {
  const download = deps.download ?? downloadImage;
  const result = { seeded: 0, imaged: 0 };
  if (!people.length) return result;

  try {
    if ((await listStaff(userId)).length > 0) return result;
  } catch (err) {
    log(`Booking: couldn't check for existing staff — ${errMsg(err)}`);
    return result;
  }

  const candidates = serviceImageCandidates(pages);
  const cache = new Map<string, string | null>();
  const downloads = { count: 0 };

  for (const p of people) {
    try {
      const photoFilename = await resolveImage(p.name, candidates, cache, downloads, download);
      if (photoFilename) result.imaged++;
      const role = (p.role ?? "").trim() || roleFromBio(p.bio);

      const saved = await saveStaff(userId, { name: p.name, role, bio: p.bio || "", photoFilename });
      if (saved.ok) result.seeded++;
      else log(`Booking: couldn't save staff member "${p.name}" — ${saved.error}`);
    } catch (err) {
      log(`Booking: couldn't seed staff member "${p.name}" — ${errMsg(err)}`);
    }
  }
  return result;
}

// ── Locations ─────────────────────────────────────────────────────────────

/** "123 Main St, Austin, TX 78701" → "Austin" — the city segment when the
 *  address is comma-separated, else its first line whole. */
function cityFromAddress(address: string): string {
  const firstLine = (address ?? "").split("\n")[0].trim();
  const parts = firstLine.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[1] : (parts[0] ?? "");
}

/**
 * Seed `BookingLocation` rows from the locations stage's result, only when
 * the tenant has none. One row per location; a single location just carries
 * the business name, several are told apart by city. Never throws.
 */
export async function seedLocations(
  userId: string,
  locations: Location[],
  businessName: string,
  log: (m: string) => void,
): Promise<{ seeded: number }> {
  const result = { seeded: 0 };
  if (!locations.length) return result;

  try {
    if ((await listLocations(userId)).length > 0) return result;
  } catch (err) {
    log(`Booking: couldn't check for existing locations — ${errMsg(err)}`);
    return result;
  }

  const name = businessName.trim() || "Business";
  for (const loc of locations) {
    try {
      const suffix = locations.length > 1 ? cityFromAddress(loc.address) : "";
      const saved = await saveLocation(userId, {
        name: suffix ? `${name} — ${suffix}` : name,
        kind: "business",
        address: loc.address,
        phone: loc.phone || "",
        hours: weeklyHoursFrom(loc.hours),
      });
      if (saved.ok) result.seeded++;
      else log(`Booking: couldn't save location "${loc.address}" — ${saved.error}`);
    } catch (err) {
      log(`Booking: couldn't seed location "${loc.address}" — ${errMsg(err)}`);
    }
  }
  return result;
}

// ── Settings ──────────────────────────────────────────────────────────────

/**
 * Seed the tenant's `BookingSettings` row, only when it doesn't exist yet:
 * the timezone from the (first) location's address, the hours from that same
 * location, each falling back to the app's defaults. Never throws.
 */
export async function seedSettings(
  userId: string,
  opts: { address: string; hours?: Record<string, string> },
  log: (m: string) => void,
): Promise<{ seeded: boolean }> {
  try {
    const existing = await prisma.bookingSettings.findUnique({ where: { userId } });
    if (existing) return { seeded: false };
  } catch (err) {
    log(`Booking: couldn't check booking settings — ${errMsg(err)}`);
    return { seeded: false };
  }

  try {
    const timezone = timezoneFromAddress(opts.address || "") ?? DEFAULT_TIMEZONE;
    const hours = (opts.hours ? weeklyHoursFrom(opts.hours) : null) ?? defaultWeeklyHours();
    await saveBookingSettings(userId, { timezone, hours });
    log(`Booking: timezone set to ${timezone}`);
    return { seeded: true };
  } catch (err) {
    log(`Booking: couldn't set up booking settings — ${errMsg(err)}`);
    return { seeded: false };
  }
}

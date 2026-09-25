import { str as strMax } from "@/lib/util/text";
import { prisma } from "@/lib/db";
import { writeFormSpec } from "@/lib/booking/formSpec";
import { replaceMenu } from "@/lib/menu";
import { sanitizeMenuItem, type MenuItemData } from "@/lib/menuTypes";
import { onboardingIngestKind } from "@/lib/ingestionSources";
import { SERVICES_SOURCE_TITLE, formatServiceCatalog } from "@/lib/serviceCatalog";
import type { Crawler, Page } from "./crawl";
import { bookingCorpus, findBookingFrames, findBookingLink, findSiblingSubdomain } from "./bookingPage";
import { llmCorpus, llmExtract } from "./knowledgeLlm";
import { saveKnowledgeRecord } from "./knowledge";
import { applyBookingChannels, seedServices, type ExtractedService } from "./bookingSeed";
import { readBookingForm, snapshotStatic, type FormSnapshot } from "./formReader";
import { transcribeForm, type FormSpec, type LlmFn as FormLlmFn } from "./formTranscribe";
import { BOOKING_CHANNELS, type BookingChannel } from "@/lib/booking/types";

/**
 * The services-and-booking extractor: one read of the pages most likely to
 * describe what the business sells and how it takes bookings. Services become
 * knowledge (the sibling extractors' Source+Chunk path) and Service rows; then
 * the business's own booking form is read as it renders (formReader.ts),
 * transcribed verbatim (formTranscribe.ts) and written into the tenant's form
 * (lib/booking/formSpec.ts) — the same steps, the same questions, the same
 * words. The booking page is read even when it is an offsite widget — that is
 * where the full menu and the real questions are.
 *
 * Booking itself is on by default (Profile.bookingEnabled), so this stage is
 * configuring a live capability, not staging one behind a toggle. It rewrites
 * a form nobody has edited; one the tenant has touched is theirs.
 */

export const SERVICES_SYSTEM_PROMPT = `You read text from a business's website and report (1) the services it offers and (2) how it takes bookings. The text contains multiple pages, each preceded by "=== <url>". A page preceded by "=== BOOKING PAGE <url>" is the business's own online booking page: when it lists services, take names, prices and headings from it, and list a service once even if another page names it too.

Rules:
- A service is something the business actually offers customers: a treatment, a package, a job type, a menu category. "name" is the site's own name for it; "description" is what the text says about it (what's included, price, duration). Copy from the text; never invent or embellish.
- "price" and "duration" are that service's own price and length exactly as the text writes them ("$35", "$40+", "from £25", "45 min"); "category" is the menu heading the text lists it under ("Manicures", "Add-ons"). Each is "" when the text does not state it. Never estimate, convert, or fill one in from a similar service.
- "addons" are extra items or upsells the text lists FOR THIS SERVICE specifically (e.g. "add gel top coat +$10"): one entry per add-on with its own "name" and "price" exactly as stated, [] when the text lists none for this service.
- "deposit" is what the text says THIS SERVICE requires as a deposit or prepayment, copied as written ("$20 deposit", "50% deposit due at booking"); "" when not stated for it.
- "cancellationPolicy" and "preparation" are this service's own cancellation/rescheduling rule and any prep or eligibility instructions the text states for it, copied as written; "" when not stated. Never copy the business's general policy onto a specific service unless the text itself ties it there.
- "menu" holds the rest of what the text states about the item, for a menu the customer can order from. Every field is optional: leave it "", [], false or omit it when the text does not state it — never fill one in from what such an item usually has. Fields: subcategory; shortDescription (one line); fullDescription (the text's longer description); image (a URL from the IMAGES list whose alt or position clearly matches this item, else ""); gallery (more matching image URLs); priceType (fixed | starting_at | market | varies | free); originalPrice and salePrice (only when the text shows a struck-through or reduced price); currency (code like USD, only when stated); unit (each | person | lb | hour …); availability (available | unavailable | limited | unknown); availabilityWindow ("breakfast only", "after 4 PM"); locations (branches it is available at); modifiers: the choices the text offers for this item — sizes, sides, temperature, add-ons — each {"name":"Size","choices":[{"label":"Large","price":"+$2"}],"required":true,"min":1,"max":1,"defaults":["Medium"]} with min/max as the text states ("choose 1–2 toppings") and price only when the text prices that choice; quantityMin/quantityMax when the text limits how many; ingredients; dietaryTags (vegan, vegetarian, gluten-free, keto …, as written); allergens; warnings ("contains raw or undercooked …"); customization (true when the text invites requests like "no onions" or "sauce on the side"); nutrition ("720 cal"); servingSize ("serves 2"); popularity (popular | bestseller | new | staff_pick, only when the text marks it); rating and reviewCount as written; estimatedTime ("15–20 min"); inventory ("4 remaining"); fulfillment (pickup | delivery | dine_in | appointment | shipping — how the text says this item is had); related, upsells, pairings (names of other listed items the text pairs or suggests with it).
- "takesAppointments" is true ONLY if the text says customers can book, schedule, or make an appointment/reservation with this business.
- "channels" lists every way the text says a customer can book: "online" (a booking page, widget or form), "phone" ("call to book", a number beside "book"), "email", "walk_in" ("walk-ins welcome"). [] when the text says nothing about how to book.
- Nothing qualifying? Return empty lists and false. Never guess.

Respond with ONLY this JSON, no other text:
{"services":[{"name":"","description":"","price":"","duration":"","category":"","addons":[{"name":"","price":""}],"deposit":"","cancellationPolicy":"","preparation":"","menu":{"subcategory":"","shortDescription":"","fullDescription":"","image":"","gallery":[],"priceType":"","originalPrice":"","salePrice":"","currency":"","unit":"","availability":"","availabilityWindow":"","locations":[],"modifiers":[],"quantityMin":0,"quantityMax":0,"ingredients":[],"dietaryTags":[],"allergens":[],"warnings":[],"customization":false,"nutrition":"","servingSize":"","popularity":"","rating":"","reviewCount":"","estimatedTime":"","inventory":"","fulfillment":[],"related":[],"upsells":[],"pairings":[]}}],"booking":{"takesAppointments":false,"channels":[]}}`;

export type ServicesExtract = {
  /** A ServiceItem plus the menu facts (price, duration, category) and the
   *  long tail (addons, deposit, policy) the booking seeder
   *  (lib/onboarding/bookingSeed.ts) reads. */
  services: ExtractedService[];
  /** The same items with everything the site states about them (lib/menuTypes.ts). */
  menu: MenuItemData[];
  takesAppointments: boolean;
  /** How the site says one books: online, by phone, by email, walking in. */
  channels: BookingChannel[];
};

/** Services read per business. */
const MAX_SERVICES = 60;

const str = (v: unknown, max = 2000): string => strMax(v, max);

/** Model output → typed, capped, whitelist-enforced data. Never throws. */
export function sanitizeServices(raw: Record<string, unknown> | null): ServicesExtract {
  const out: ServicesExtract = {
    services: [],
    menu: [],
    takesAppointments: false,
    channels: [],
  };
  if (!raw || typeof raw !== "object") return out;

  if (Array.isArray(raw.services)) {
    for (const s of raw.services.slice(0, MAX_SERVICES)) {
      const item = (s ?? {}) as Record<string, unknown>;
      const name = str(item.name, 200);
      if (!name) continue;
      const service: ExtractedService = { name, description: str(item.description) };
      const price = str(item.price, 40);
      const duration = str(item.duration, 40);
      const category = str(item.category, 60);
      if (price) service.price = price;
      if (duration) service.duration = duration;
      if (category) service.category = category;

      const addons = Array.isArray(item.addons)
        ? item.addons
            .slice(0, 20)
            .map((a) => {
              const ai = (a ?? {}) as Record<string, unknown>;
              const aName = str(ai.name, 80);
              if (!aName) return null;
              const aPrice = str(ai.price, 40);
              return aPrice ? { name: aName, price: aPrice } : { name: aName };
            })
            .filter((a): a is { name: string; price?: string } => a !== null)
        : [];
      if (addons.length) service.addons = addons;
      const deposit = str(item.deposit, 60);
      if (deposit) service.deposit = deposit;
      const cancellationPolicy = str(item.cancellationPolicy, 300);
      if (cancellationPolicy) service.cancellationPolicy = cancellationPolicy;
      const preparation = str(item.preparation, 300);
      if (preparation) service.preparation = preparation;

      out.services.push(service);
      // The menu item: the service's own facts, plus whatever the model put
      // under "menu"; the sanitizer keeps only the closed vocabulary.
      const extra = item.menu && typeof item.menu === "object" && !Array.isArray(item.menu) ? (item.menu as Record<string, unknown>) : {};
      const menuItem = sanitizeMenuItem({
        ...extra,
        name,
        category,
        shortDescription: typeof extra.shortDescription === "string" && extra.shortDescription.trim() ? extra.shortDescription : service.description.length <= 200 ? service.description : "",
        fullDescription: typeof extra.fullDescription === "string" && extra.fullDescription.trim() ? extra.fullDescription : service.description.length > 200 ? service.description : "",
        price: price || (typeof extra.price === "string" ? extra.price : ""),
        estimatedTime: typeof extra.estimatedTime === "string" && extra.estimatedTime.trim() ? extra.estimatedTime : duration,
      });
      if (menuItem) out.menu.push(menuItem);
    }
  }

  const booking =
    raw.booking && typeof raw.booking === "object" && !Array.isArray(raw.booking)
      ? (raw.booking as Record<string, unknown>)
      : null;
  if (booking) {
    out.takesAppointments = booking.takesAppointments === true;
    if (Array.isArray(booking.channels)) {
      out.channels = [...new Set(booking.channels.map((c) => String(c)))].filter((c): c is BookingChannel =>
        (BOOKING_CHANNELS as readonly string[]).includes(c),
      );
    }
  }
  return out;
}

/** The pages likely to describe services and booking, homepage included. */
export async function discoverServicePages(
  crawler: Crawler,
  home: Page,
  preloaded: Page[],
): Promise<Page[]> {
  const seen = new Set<string>([home.url, ...preloaded.map((p) => p.url)]);
  const pages: Page[] = [home, ...preloaded];

  const candidates = crawler
    .navLinks(home)
    .filter((l) => /services?|treatments?|pricing|prices|menu|packages?|book|appointments?|schedule|reservations?|quote|estimate/i.test(l.text))
    .map((l) => l.url);
  for (const p of ["/services", "/service", "/pricing", "/menu", "/book", "/booking", "/appointments"]) {
    const abs = crawler.resolve(p);
    if (abs) candidates.push(abs);
  }

  // Loaded together (the crawler caps the open tabs), kept in candidate order.
  const urls = [...new Set(candidates)].slice(0, 8).filter((u) => !seen.has(u));
  for (const page of await Promise.all(urls.map((u) => crawler.load(u)))) {
    if (page) pages.push(page);
  }
  // The booking page itself — a booking link on any page read so far, offsite
  // included — and the widgets embedded in it or in those pages, where the
  // questions are.
  let link = findBookingLink(pages);
  if (!link) {
    // No booking link anywhere yet: some storefronts split off into their own
    // subdomain ("shop.", "book.") a hop the homepage's own nav doesn't name
    // in booking words — worth one more load, on the business's own domain,
    // before concluding there is nothing to book through.
    const sibling = findSiblingSubdomain(home);
    const siblingPage = sibling ? await crawler.loadExternal(sibling) : null;
    if (siblingPage) {
      pages.push(siblingPage);
      link = findBookingLink([siblingPage]);
    }
  }
  const booking = link ? await (crawler.resolve(link) ? crawler.load(link) : crawler.loadExternal(link)) : null;
  const frames = [...new Set([...pages, booking].flatMap((p) => (p ? findBookingFrames(p) : [])))].slice(0, MAX_FRAMES);
  for (const page of [booking, ...(await Promise.all(frames.map((f) => crawler.loadExternal(f))))]) {
    if (page && !pages.some((p) => p.url === page.url)) pages.push(page);
  }
  return pages;
}

/** Widgets read per business: the booking form, and one more for a second form on the page. */
const MAX_FRAMES = 2;

/** Images per page: what the extractor may name as an item's picture. */
const MAX_IMAGES_PER_PAGE = 40;

/** The pages' images (absolute src, alt) so an item's picture can be matched to it. */
export function imagesBlock(pages: Page[]): string {
  const lines: string[] = [];
  for (const p of pages) {
    const seen = new Set<string>();
    p.$("img").each((_, el) => {
      if (seen.size >= MAX_IMAGES_PER_PAGE) return;
      const raw = p.$(el).attr("src") ?? p.$(el).attr("data-src") ?? "";
      let src = "";
      try {
        src = raw && !raw.startsWith("data:") ? new URL(raw, p.url).toString() : "";
      } catch {
        src = "";
      }
      if (!src || !/^https?:/.test(src) || seen.has(src)) return;
      seen.add(src);
      const alt = (p.$(el).attr("alt") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
      lines.push(`${src}${alt ? ` — ${alt}` : ""}`);
    });
  }
  return lines.length ? `=== IMAGES (url — alt; name one as an item's "image" only when it clearly shows that item)\n${lines.join("\n")}` : "";
}

/** On-site pages as usual; an offsite booking page labelled, with room for its menu; then the images. */
function servicesCorpus(pages: Page[]): string {
  const origin = new URL(pages[0].url).origin;
  const offsite = (p: Page) => new URL(p.url).origin !== origin;
  return [llmCorpus(pages.filter((p) => !offsite(p))), ...pages.filter(offsite).map(bookingCorpus), imagesBlock(pages)]
    .filter(Boolean)
    .join("\n\n");
}

export type ServicesReport = {
  services: number;
  takesAppointments: boolean;
  /** Menu items written for the menu card. */
  menuItems: number;
  /** Questions copied from the site's booking form into the tenant's (0 when
   *  no form was found, or the tenant's form is their own). */
  seededFields: number;
  /** A booking form was found on the site and transcribed. */
  formFound: boolean;
  /** Screens the copied form walks (its `questions` steps). */
  formScreens: number;
  /** How the form was read: driven in the browser, from the loaded page's
   *  HTML, or not at all (no booking link, no reader). */
  formHow: "playwright" | "static" | "none";
  pagesChecked: string[];
  /** How many Service rows the booking seeder wrote (0 when the tenant
   *  already had services, or nothing was extracted). */
  seededServices: number;
  /** Of those, how many got a photo matched from the site's own pages. */
  imagedServices: number;
};

type LlmFn = typeof llmExtract;

export type ServicesDeps = {
  /** The services model call; the production extractor when left out. */
  llm?: LlmFn;
  /** Reads the booking form at a url as it renders; null = fall back to the
   *  loaded page's HTML. Left out, the crawler's browser reads it. */
  readForm?: (url: string) => Promise<FormSnapshot | null>;
  /** The transcriber's model call; the production one when left out. */
  formLlm?: FormLlmFn;
  /** The job's browser, for driving the booking form. */
  crawler?: Crawler;
};

/**
 * Extract from already-loaded pages and persist. `deps.llm` and
 * `deps.formLlm` are the injectable model boundaries (the lib/customIngest
 * precedent) so proofs run offline, `deps.readForm` the browser's; everything
 * downstream — sanitizing, the knowledge write, the form write — is the real
 * path.
 */
export async function extractServicesAndBooking(
  pages: Page[],
  userId: string,
  onEvent: (m: string) => void,
  deps: ServicesDeps = {},
): Promise<{ report: ServicesReport; chunks: number; extract: ServicesExtract; form: FormSpec | null }> {
  const llm = deps.llm ?? llmExtract;
  const report: ServicesReport = {
    services: 0,
    takesAppointments: false,
    menuItems: 0,
    seededFields: 0,
    formFound: false,
    formScreens: 0,
    formHow: "none",
    pagesChecked: pages.map((p) => p.url),
    seededServices: 0,
    imagedServices: 0,
  };
  if (!pages.length) return { report, chunks: 0, extract: sanitizeServices(null), form: null };

  const corpus = servicesCorpus(pages);
  const raw = await llm(SERVICES_SYSTEM_PROMPT, corpus, 16000, onEvent);
  const clean = sanitizeServices(raw);
  report.services = clean.services.length;
  report.menuItems = clean.menu.length;
  report.takesAppointments = clean.takesAppointments;

  let chunks = 0;
  if (clean.services.length) {
    // One source for the whole catalog, keyed on the page that carried it, so
    // a re-onboard refreshes in place instead of stacking duplicates.
    const url = pages.find((p) => /services?|treatments?|menu|pricing/i.test(p.url))?.url ?? pages[0].url;
    // Each piece carries the menu facts too, so the agent can answer "is it
    // vegan?" or "how much?" in words from the same knowledge the card draws.
    const pieces = clean.services.map((s, i) => {
      const m = clean.menu[i];
      const facts = m
        ? [
            m.price && !s.description.includes(m.price) ? `Price: ${m.price}.` : "",
            m.dietaryTags.length ? `${m.dietaryTags.join(", ")}.` : "",
            m.allergens.length ? `Contains ${m.allergens.join(", ")}.` : "",
          ].filter(Boolean)
        : [];
      return [s.description ? `${s.name}. ${s.description}` : `${s.name}.`, ...facts].join(" ");
    });
    // rawText is the catalog the services card reads back (lib/serviceCatalog.ts);
    // the pieces stay sentence-shaped, which is what retrieval embeds well.
    const saved = await saveKnowledgeRecord(
      userId,
      {
        url,
        title: SERVICES_SOURCE_TITLE,
        kind: onboardingIngestKind("services"),
        rawText: formatServiceCatalog(clean.services),
      },
      pieces,
    );
    chunks = saved.chunks;
    // The structured menu the menu card draws from and the cart orders
    // against. Best-effort: the knowledge above is already saved.
    try {
      await replaceMenu(userId, clean.menu);
    } catch {
      report.menuItems = 0;
    }
  }

  // How the business takes bookings decides how the card words its own:
  // a phone-only business gets a request the owner confirms, and a phone
  // number is asked for. Best-effort; an owner's own choice is kept.
  try {
    await applyBookingChannels(userId, clean.channels, onEvent);
  } catch {
    // Left as-is; Hours & rules still has the switch.
  }

  // The Service table (lib/booking/): same empty-catalog gate, same
  // best-effort rule — a failure here must never cost the knowledge saved
  // above.
  try {
    const seeded = await seedServices(userId, clean.services, pages, onEvent);
    report.seededServices = seeded.seeded;
    report.imagedServices = seeded.imaged;
  } catch {
    // Left as-is; the tenant can still build the booking menu by hand.
  }

  // The business's own booking form, copied verbatim. A form somebody has
  // edited is the only gate (writeFormSpec). Best-effort: a read or write
  // that fails costs the pre-filled form, never the knowledge or services.
  let form: FormSpec | null = null;
  try {
    form = await runFormRead(pages, userId, onEvent, deps, report);
  } catch (err) {
    onEvent(`Booking form: couldn't copy it — ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
  }
  return { report, chunks, extract: clean, form };
}

/**
 * The booking form's url: the homepage's booking link first (offsite widgets
 * included), else the first booking or form widget framed in the homepage or
 * any loaded page. Null when the site shows none.
 */
export function bookingFormUrl(pages: Page[]): string | null {
  if (!pages.length) return null;
  const link = findBookingLink(pages);
  if (link) return link;
  for (const p of pages) {
    const frames = findBookingFrames(p);
    if (frames.length) return frames[0];
  }
  return null;
}

/**
 * Read → transcribe → write, filling the report. The browser reads the form
 * as it renders (`readForm`, or the crawler's own browser); when it can't, a
 * page already loaded for that url is read statically; with neither there is
 * no form to copy.
 */
async function runFormRead(
  pages: Page[],
  userId: string,
  onEvent: (m: string) => void,
  deps: ServicesDeps,
  report: ServicesReport,
): Promise<FormSpec | null> {
  const url = bookingFormUrl(pages);
  if (!url) {
    onEvent("Booking form: no booking link or widget on the site");
    return null;
  }
  // A real visitor reaches this page by clicking through from the site, so it
  // carries a referrer; a cold direct navigation with none is a signal some
  // booking widgets use to refuse rendering. pages[0] is the homepage.
  const referer = pages[0]?.url;
  const readForm =
    deps.readForm ??
    ((u: string) =>
      deps.crawler ? readBookingForm(deps.crawler, u, onEvent, referer) : Promise.resolve<FormSnapshot | null>(null));
  let snapshot = await readForm(url);
  if (!snapshot) {
    const loaded = pages.find((p) => p.url === url);
    if (!loaded) {
      onEvent("Booking form: the booking page couldn't be read");
      return null;
    }
    snapshot = snapshotStatic(loaded);
  }
  report.formHow = snapshot.how;
  const spec = await transcribeForm(snapshot, { llm: deps.formLlm }, onEvent);
  report.formFound = spec.found;
  if (!spec.found) {
    onEvent("Booking form: the booking page has no form to copy");
    return spec;
  }
  const written = await writeFormSpec(userId, spec, onEvent);
  report.seededFields = written.fields;
  report.formScreens = spec.steps.filter((s) => s.kind === "questions").length;
  return spec;
}

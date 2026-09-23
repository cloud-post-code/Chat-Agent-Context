import { prisma } from "@/lib/db";
import { FIELD_TYPES, rebuildUntouchedForm } from "@/lib/appointments";
import { isChoiceType } from "@/lib/appointmentTypes";
import { BOOKING_KINDS, planBookingForm, type BookingKind, type ContactNeed } from "@/lib/bookingFormPlan";
import { replaceMenu } from "@/lib/menu";
import { sanitizeMenuItem, type MenuItemData } from "@/lib/menuTypes";
import { onboardingIngestKind } from "@/lib/ingestionSources";
import { SERVICES_SOURCE_TITLE, formatServiceCatalog } from "@/lib/serviceCatalog";
import type { Crawler, Page } from "./crawl";
import { bookingCorpus, findBookingFrames, findBookingLink } from "./bookingPage";
import { llmCorpus, llmExtract } from "./knowledgeLlm";
import { saveKnowledgeRecord } from "./knowledge";
import { seedServices, type ExtractedService } from "./bookingSeed";

/**
 * The services-and-booking extractor: one read of the pages most likely to
 * describe what the business sells and how it takes bookings. Services become
 * knowledge (the sibling extractors' Source+Chunk path), and they also seed the
 * appointment-question catalog: the stage always leaves a usable form, asking
 * what this business asks when it takes a booking (lib/bookingFormPlan.ts).
 * The business's own booking page is read too, even when it is an offsite
 * widget — that is where the full menu and the real questions are.
 *
 * Booking itself is on by default (Profile.bookingEnabled), so this stage is
 * configuring a live capability, not staging one behind a toggle. It rebuilds
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
- "requirements" are the concrete pieces of information the text says a customer provides when booking (e.g. a phone number, party size, a preferred stylist). One entry per piece. Do NOT list the choice of service itself — services are already reported above — nor the date and time, which every booking asks. "required" is true when the text presents it as needed.
- A requirement's "type" is one of: short_text, long_text, email, phone, number (a count: party size, guests, pets), yes_no, select (the customer picks ONE of choices the text lists), multi_select (picks ANY of them). "options" holds those listed choices, copied from the text, and is [] for every other type. Use select/multi_select only when the text itself lists at least two choices; otherwise short_text.
- "kind" is what a customer books, judged from what the business is: personal_service (a person's time at the business: salon, spa, barber, clinic, studio), table (restaurant, bar, café), home_service (the business comes to the customer: trades, cleaning, repair), class (places in a class, tour or event), consultation (a conversation: agency, adviser, coach), other (anything else, or unclear).
- "staff" are the names of people the text says a customer can choose or ask for when booking (technicians, stylists, practitioners). Copy the names; [] when the text names nobody. Never the owner's name just because it appears.
- "phone" and "email" say whether the text shows the booking asking for each: "required", "optional", or "unknown" when the text doesn't show it. "notes" is true when the booking takes a free-text note or special request.
- Nothing qualifying? Return empty lists, false, "other" and "unknown". Never guess.

Respond with ONLY this JSON, no other text:
{"services":[{"name":"","description":"","price":"","duration":"","category":"","addons":[{"name":"","price":""}],"deposit":"","cancellationPolicy":"","preparation":"","menu":{"subcategory":"","shortDescription":"","fullDescription":"","image":"","gallery":[],"priceType":"","originalPrice":"","salePrice":"","currency":"","unit":"","availability":"","availabilityWindow":"","locations":[],"modifiers":[],"quantityMin":0,"quantityMax":0,"ingredients":[],"dietaryTags":[],"allergens":[],"warnings":[],"customization":false,"nutrition":"","servingSize":"","popularity":"","rating":"","reviewCount":"","estimatedTime":"","inventory":"","fulfillment":[],"related":[],"upsells":[],"pairings":[]}}],"booking":{"takesAppointments":false,"kind":"other","staff":[],"phone":"unknown","email":"unknown","notes":false,"requirements":[{"label":"","type":"short_text","required":false,"options":[]}]}}`;

export type { ServiceItem } from "@/lib/serviceCatalog";
export type BookingRequirement = {
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
  /** The choices the site lists, for select / multi_select; empty otherwise. */
  options: string[];
};
export type ServicesExtract = {
  /** A ServiceItem plus the menu facts (price, duration, category) the form's
   *  picker shows, and the long tail (addons, deposit, policy) the booking
   *  seeder (lib/onboarding/bookingSeed.ts) reads. */
  services: ExtractedService[];
  /** The same items with everything the site states about them (lib/menuTypes.ts). */
  menu: MenuItemData[];
  takesAppointments: boolean;
  kind: BookingKind;
  /** People a customer can ask for. Unverified here; see `namedInText`. */
  staff: string[];
  phone: ContactNeed;
  email: ContactNeed;
  notes: boolean;
  requirements: BookingRequirement[];
};

/** The menu cap: what one choice question can hold (appointmentTypes MAX_OPTIONS). */
const MAX_SERVICES = 60;
const contactNeed = (v: unknown): ContactNeed => (v === "required" || v === "optional" ? v : "unknown");

const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Model output → typed, capped, whitelist-enforced data. Never throws. */
export function sanitizeServices(raw: Record<string, unknown> | null): ServicesExtract {
  const out: ServicesExtract = {
    services: [],
    menu: [],
    takesAppointments: false,
    kind: "other",
    staff: [],
    phone: "unknown",
    email: "unknown",
    notes: false,
    requirements: [],
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
    if ((BOOKING_KINDS as readonly string[]).includes(String(booking.kind))) out.kind = booking.kind as BookingKind;
    if (Array.isArray(booking.staff)) {
      out.staff = [...new Set(booking.staff.map((n) => str(n, 60)).filter(Boolean))].slice(0, 12);
    }
    out.phone = contactNeed(booking.phone);
    out.email = contactNeed(booking.email);
    out.notes = booking.notes === true;
    if (Array.isArray(booking.requirements)) {
      for (const r of booking.requirements.slice(0, 10)) {
        if (!r || typeof r !== "object") continue;
        const item = r as Record<string, unknown>;
        const label = str(item.label, 120);
        if (!label) continue;
        let type = (FIELD_TYPES as readonly string[]).includes(String(item.type))
          ? (String(item.type) as BookingRequirement["type"])
          : "short_text";
        const options = isChoiceType(type) && Array.isArray(item.options)
          ? [...new Set(item.options.map((o) => str(o, 120)).filter(Boolean))].slice(0, 30)
          : [];
        // A pick-from-a-list question with nothing to pick from is a text question.
        if (isChoiceType(type) && options.length < 2) type = "short_text";
        out.requirements.push({
          label,
          type,
          required: item.required === true,
          options: isChoiceType(type) ? options : [],
        });
      }
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
  // The booking page itself — the homepage's booking link, offsite included —
  // and the widgets embedded in it or in the homepage, where the questions are.
  const link = findBookingLink(home);
  const booking = link ? await (crawler.resolve(link) ? crawler.load(link) : crawler.loadExternal(link)) : null;
  const frames = [...new Set([home, booking].flatMap((p) => (p ? findBookingFrames(p) : [])))].slice(0, MAX_FRAMES);
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

/** Keep a name only when the text read actually contains it. */
const namedInText = (names: string[], corpus: string) => {
  const text = corpus.toLowerCase();
  return names.filter((n) => text.includes(n.toLowerCase()));
};

export type ServicesReport = {
  services: number;
  takesAppointments: boolean;
  /** What kind of booking the form was planned for. */
  kind: BookingKind;
  /** Menu items written for the menu card. */
  menuItems: number;
  seededFields: number;
  pagesChecked: string[];
  /** How many Service rows the booking seeder wrote (0 when the tenant
   *  already had services, or nothing was extracted). */
  seededServices: number;
  /** Of those, how many got a photo matched from the site's own pages. */
  imagedServices: number;
};

type LlmFn = typeof llmExtract;

/**
 * Extract from already-loaded pages and persist. `deps.llm` is the one
 * injectable boundary (the lib/customIngest precedent) so proofs run offline;
 * everything downstream — sanitizing, the knowledge write, field seeding —
 * is the real path.
 */
export async function extractServicesAndBooking(
  pages: Page[],
  userId: string,
  onEvent: (m: string) => void,
  deps: { llm?: LlmFn } = {},
): Promise<{ report: ServicesReport; chunks: number }> {
  const llm = deps.llm ?? llmExtract;
  const report: ServicesReport = {
    services: 0,
    takesAppointments: false,
    kind: "other",
    menuItems: 0,
    seededFields: 0,
    pagesChecked: pages.map((p) => p.url),
    seededServices: 0,
    imagedServices: 0,
  };
  if (!pages.length) return { report, chunks: 0 };

  const corpus = servicesCorpus(pages);
  const raw = await llm(SERVICES_SYSTEM_PROMPT, corpus, 16000, onEvent);
  const clean = sanitizeServices(raw);
  clean.staff = namedInText(clean.staff, corpus);
  report.services = clean.services.length;
  report.menuItems = clean.menu.length;
  report.takesAppointments = clean.takesAppointments;
  report.kind = clean.kind;

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

  // One rule: after this stage the tenant has the form this business would
  // have built. A form somebody has edited is the only gate — that one is
  // theirs, never ours. Best-effort, so a field write that fails never costs
  // the knowledge saved above.
  try {
    report.seededFields = await rebuildUntouchedForm(userId, planBookingForm(clean));
  } catch {
    // Left as-is; the tenant can still build the form by hand.
  }

  // The Service table (lib/booking/): same empty-catalog gate, same
  // best-effort rule — a failure here must never cost the knowledge or the
  // intake form seeded above.
  try {
    const seeded = await seedServices(userId, clean.services, pages, onEvent);
    report.seededServices = seeded.seeded;
    report.imagedServices = seeded.imaged;
  } catch {
    // Left as-is; the tenant can still build the booking menu by hand.
  }
  return { report, chunks };
}

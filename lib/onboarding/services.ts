import { prisma } from "@/lib/db";
import {
  DEFAULT_APPOINTMENT_FIELDS,
  FIELD_TYPES,
  keyFromLabel,
  saveAppointmentField,
} from "@/lib/appointments";
import { isChoiceType, type FieldConfig } from "@/lib/appointmentTypes";
import { servicePickerField, type MenuService } from "@/lib/bookingMenu";
import { onboardingIngestKind } from "@/lib/ingestionSources";
import { SERVICES_SOURCE_TITLE, formatServiceCatalog } from "@/lib/serviceCatalog";
import type { Crawler, Page } from "./crawl";
import { llmCorpus, llmExtract } from "./knowledgeLlm";
import { saveKnowledgeRecord } from "./knowledge";

/**
 * The services-and-booking extractor: one read of the pages most likely to
 * describe what the business sells and how it takes bookings. Services become
 * knowledge (the sibling extractors' Source+Chunk path), and they also seed the
 * appointment-question catalog: the stage always leaves a usable form, asking
 * in the tenant's own words about the services the crawl actually found.
 *
 * Booking itself is on by default (Profile.bookingEnabled), so this stage is
 * configuring a live capability, not staging one behind a toggle. It never
 * touches a catalog that already has questions — that one is the tenant's.
 */

export const SERVICES_SYSTEM_PROMPT = `You read text from a business's website and report (1) the services it offers and (2) how it takes bookings. The text contains multiple pages, each preceded by "=== <url>".

Rules:
- A service is something the business actually offers customers: a treatment, a package, a job type, a menu category. "name" is the site's own name for it; "description" is what the text says about it (what's included, price, duration). Copy from the text; never invent or embellish.
- "price" and "duration" are that service's own price and length exactly as the text writes them ("$35", "$40+", "from £25", "45 min"); "category" is the menu heading the text lists it under ("Manicures", "Add-ons"). Each is "" when the text does not state it. Never estimate, convert, or fill one in from a similar service.
- "takesAppointments" is true ONLY if the text says customers can book, schedule, or make an appointment/reservation with this business.
- "requirements" are the concrete pieces of information the text says a customer provides when booking (e.g. a phone number, party size, a preferred stylist). One entry per piece. Do NOT list the choice of service itself — services are already reported above. "required" is true when the text presents it as needed.
- A requirement's "type" is one of: short_text, long_text, email, phone, number (a count: party size, guests, pets), yes_no, select (the customer picks ONE of choices the text lists), multi_select (picks ANY of them). "options" holds those listed choices, copied from the text, and is [] for every other type. Use select/multi_select only when the text itself lists at least two choices; otherwise short_text.
- Nothing qualifying? Return empty lists and false. Never guess.

Respond with ONLY this JSON, no other text:
{"services":[{"name":"","description":"","price":"","duration":"","category":""}],"booking":{"takesAppointments":false,"requirements":[{"label":"","type":"short_text","required":false,"options":[]}]}}`;

export type { ServiceItem } from "@/lib/serviceCatalog";
export type BookingRequirement = {
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
  /** The choices the site lists, for select / multi_select; empty otherwise. */
  options: string[];
};
export type ServicesExtract = {
  /** A ServiceItem plus the menu facts (price, duration, category) the form's picker shows. */
  services: MenuService[];
  takesAppointments: boolean;
  requirements: BookingRequirement[];
};

const str = (v: unknown, max = 2000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/** Model output → typed, capped, whitelist-enforced data. Never throws. */
export function sanitizeServices(raw: Record<string, unknown> | null): ServicesExtract {
  const out: ServicesExtract = { services: [], takesAppointments: false, requirements: [] };
  if (!raw || typeof raw !== "object") return out;

  if (Array.isArray(raw.services)) {
    for (const s of raw.services.slice(0, 40)) {
      const item = (s ?? {}) as Record<string, unknown>;
      const name = str(item.name, 200);
      if (!name) continue;
      const service: MenuService = { name, description: str(item.description) };
      const price = str(item.price, 40);
      const duration = str(item.duration, 40);
      const category = str(item.category, 60);
      if (price) service.price = price;
      if (duration) service.duration = duration;
      if (category) service.category = category;
      out.services.push(service);
    }
  }

  const booking =
    raw.booking && typeof raw.booking === "object" && !Array.isArray(raw.booking)
      ? (raw.booking as Record<string, unknown>)
      : null;
  if (booking) {
    out.takesAppointments = booking.takesAppointments === true;
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
    .filter((l) => /services?|treatments?|pricing|prices|menu|packages?|book|appointments?|schedule|reservations?/i.test(l.text))
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
  return pages;
}

export type ServicesReport = {
  services: number;
  takesAppointments: boolean;
  seededFields: number;
  pagesChecked: string[];
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
    seededFields: 0,
    pagesChecked: pages.map((p) => p.url),
  };
  if (!pages.length) return { report, chunks: 0 };

  const raw = await llm(SERVICES_SYSTEM_PROMPT, llmCorpus(pages), 3000, onEvent);
  const clean = sanitizeServices(raw);
  report.services = clean.services.length;
  report.takesAppointments = clean.takesAppointments;

  let chunks = 0;
  if (clean.services.length) {
    // One source for the whole catalog, keyed on the page that carried it, so
    // a re-onboard refreshes in place instead of stacking duplicates.
    const url = pages.find((p) => /services?|treatments?|menu|pricing/i.test(p.url))?.url ?? pages[0].url;
    const pieces = clean.services.map((s) =>
      s.description ? `${s.name}. ${s.description}` : `${s.name}.`,
    );
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
  }

  // One rule: after this stage the tenant has a usable form. An empty catalog
  // is the only gate — an existing one is theirs, never ours. Best-effort, so
  // a field write that fails never costs the knowledge saved above.
  try {
    report.seededFields = await seedBookingForm(userId, clean);
  } catch {
    // Left as-is; the tenant can still build the form by hand.
  }
  return { report, chunks };
}

/**
 * Seed the question catalog when it is empty. Returns how many questions were
 * written. The order is defaults → service picker → extracted requirements:
 * who they are, what they want, then the specifics the site asks for.
 */
async function seedBookingForm(userId: string, clean: ServicesExtract): Promise<number> {
  if ((await prisma.appointmentField.count({ where: { userId } })) > 0) return 0;

  // The services as a menu to pick from — every option with the price and
  // duration the site states — not a text box that names a few of them.
  const picker = servicePickerField(clean.services);
  // "reason" is the generic catch-all; keep it only when nothing more specific
  // takes its place, so the fallback form still asks something useful.
  const replaced = Boolean(picker) || clean.requirements.length > 0;
  const defaults = DEFAULT_APPOINTMENT_FIELDS.filter((d) => !(replaced && d.key === "reason"));

  // saveAppointmentField upserts on key, and keys derive from labels — so an
  // extracted "Name" would silently overwrite the "Your name" default, and an
  // extracted "Service" would replace the generated picker with a bare word.
  // Seeding is additive: the first question to claim a key keeps it.
  const taken = new Set<string>();
  let seeded = 0;
  const write = async (f: {
    key?: string;
    label: string;
    type: string;
    required: boolean;
    config?: FieldConfig;
  }) => {
    // Mirror saveAppointmentField's own truncation before deriving the key.
    const key = f.key ?? keyFromLabel(f.label.trim().slice(0, 120));
    if (taken.has(key)) return;
    taken.add(key);
    if ((await saveAppointmentField(userId, { ...f, key })) === null) seeded++;
  };

  for (const f of defaults) await write(f);
  if (picker) await write(picker);
  for (const { options, ...r } of clean.requirements) {
    // The site's list is what it happened to name, not a closed set, so a
    // seeded choice question always leaves room for an answer that isn't on it.
    await write({ ...r, config: { options: options.map((label) => ({ label })), allowOther: true } });
  }
  return seeded;
}


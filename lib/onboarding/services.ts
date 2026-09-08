import { prisma } from "@/lib/db";
import {
  DEFAULT_APPOINTMENT_FIELDS,
  FIELD_TYPES,
  keyFromLabel,
  saveAppointmentField,
} from "@/lib/appointments";
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
- "takesAppointments" is true ONLY if the text says customers can book, schedule, or make an appointment/reservation with this business.
- "requirements" are the concrete pieces of information the text says a customer provides when booking (e.g. a phone number, the treatment they want, party size). One entry per piece. "type" is one of: short_text, long_text, email, phone. "required" is true when the text presents it as needed.
- Nothing qualifying? Return empty lists and false. Never guess.

Respond with ONLY this JSON, no other text:
{"services":[{"name":"","description":""}],"booking":{"takesAppointments":false,"requirements":[{"label":"","type":"short_text","required":false}]}}`;

export type ServiceItem = { name: string; description: string };
export type BookingRequirement = {
  label: string;
  type: (typeof FIELD_TYPES)[number];
  required: boolean;
};
export type ServicesExtract = {
  services: ServiceItem[];
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
      if (name) out.services.push({ name, description: str(item.description) });
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
        const type = (FIELD_TYPES as readonly string[]).includes(String(item.type))
          ? (String(item.type) as BookingRequirement["type"])
          : "short_text";
        out.requirements.push({ label, type, required: item.required === true });
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

  for (const url of [...new Set(candidates)].slice(0, 8)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const page = await crawler.load(url);
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
    const saved = await saveKnowledgeRecord(
      userId,
      { url, title: "Services", kind: "services", rawText: pieces.join("\n\n") },
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

/** `saveAppointmentField` caps labels at 120; keep the picker under it. */
const PICKER_LABEL_CAP = 120;

/**
 * The generated service-picker question. Names the tenant's own services so
 * the wizard asks in their words, and drops whole names — never a fragment —
 * to stay inside the label cap.
 */
export function servicePickerLabel(services: ServiceItem[]): string {
  const names = services.map((s) => s.name).filter(Boolean);
  if (!names.length) return "";
  const head = "Which service are you booking? ";
  const kept: string[] = [];
  for (const n of names) {
    const next = [...kept, n].join(", ");
    // "…, or more" is appended when anything is left out, so budget for it.
    const suffix = kept.length + 1 < names.length ? ", or something else" : "";
    if ((head + next + suffix).length > PICKER_LABEL_CAP) break;
    kept.push(n);
  }
  // Not even one name fits: ask the plain question rather than a truncated one.
  if (!kept.length) return "Which service are you booking?";
  const tail = kept.length < names.length ? ", or something else" : "";
  return `${head}${kept.join(", ")}${tail}`;
}

/**
 * Seed the question catalog when it is empty. Returns how many questions were
 * written. The order is defaults → service picker → extracted requirements:
 * who they are, what they want, then the specifics the site asks for.
 */
async function seedBookingForm(userId: string, clean: ServicesExtract): Promise<number> {
  if ((await prisma.appointmentField.count({ where: { userId } })) > 0) return 0;

  const picker = servicePickerLabel(clean.services);
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
  const write = async (f: { key?: string; label: string; type: string; required: boolean }) => {
    // Mirror saveAppointmentField's own truncation before deriving the key.
    const key = f.key ?? keyFromLabel(f.label.trim().slice(0, 120));
    if (taken.has(key)) return;
    taken.add(key);
    if ((await saveAppointmentField(userId, { ...f, key })) === null) seeded++;
  };

  for (const f of defaults) await write(f);
  if (picker) await write({ key: "service", label: picker, type: "short_text", required: true });
  for (const r of clean.requirements) await write(r);
  return seeded;
}


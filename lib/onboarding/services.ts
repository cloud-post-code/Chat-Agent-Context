import { prisma } from "@/lib/db";
import { DEFAULT_APPOINTMENT_FIELDS, FIELD_TYPES, saveAppointmentField } from "@/lib/appointments";
import type { Crawler, Page } from "./crawl";
import { llmCorpus, llmExtract } from "./knowledgeLlm";
import { saveKnowledgeRecord } from "./knowledge";

/**
 * The services-and-booking extractor: one read of the pages most likely to
 * describe what the business sells and how it takes bookings. Services become
 * knowledge (the sibling extractors' Source+Chunk path); booking requirements
 * pre-seed the appointment-question catalog so the tenant's first flip of the
 * Appointments toggle already asks the right things.
 *
 * Extraction never enables booking and never touches a catalog that already
 * has questions — it configures, the tenant decides.
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

  // Seed the question catalog only when booking info exists and the tenant
  // has no questions yet — an existing catalog is theirs, never ours.
  if (clean.takesAppointments && clean.requirements.length) {
    const existing = await prisma.appointmentField.count({ where: { userId } });
    if (existing === 0) {
      for (const f of DEFAULT_APPOINTMENT_FIELDS.filter((d) => d.key !== "reason")) {
        await saveAppointmentField(userId, f);
        report.seededFields++;
      }
      for (const r of clean.requirements) {
        const err = await saveAppointmentField(userId, r);
        if (err === null) report.seededFields++;
      }
    }
  }
  return { report, chunks };
}

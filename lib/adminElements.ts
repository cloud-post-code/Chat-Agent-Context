import { formatMoney, type LocationRow, type ServiceRow, type StaffRow } from "@/lib/booking/types";
import type { AppointmentDetail } from "@/lib/booking/store";
import type { OrderRow } from "@/lib/orders";
import type { DirectiveRow } from "@/lib/directives";
import type { CalendarAppointment } from "@/app/admin/CalendarPanel";
import type { CalendarOrder } from "@/app/admin/OrdersPanel";

/**
 * The element registry behind the copilot's show_elements tool: each list
 * panel of the dashboard is split into addressable elements (one booking, one
 * order, one goal, …) that carry flat, filterable facets. Everything here is
 * pure — the brain filters the index it loads, the panel side renders one node
 * per element from the same rows, and both agree because both call the same
 * builders on the same rows. Imports only type-level or pure modules so
 * offline proofs can exercise it.
 */

export type FacetValue = string | number;

export type ElementMeta = {
  /** The underlying row's id — the same key the panel side renders under. */
  id: string;
  panel: string;
  /** Short human label, as the chat bubble names it. */
  label: string;
  facets: Record<string, FacetValue>;
};

export type FilterOp = "is" | "contains" | "before" | "after" | "gte" | "lte";
export const FILTER_OPS: readonly FilterOp[] = ["is", "contains", "before", "after", "gte", "lte"];

export type ElementFilter = { facet: string; op: FilterOp; value: string };

export type ElementSelection = {
  panel: string;
  /** Explicit picks from the index; kept in index order, unknown ids dropped. */
  ids?: string[];
  /** ANDed together. */
  where?: ElementFilter[];
  limit?: number;
};

/** The panels that have elements this pass, with the facets each carries. */
export const ELEMENT_PANELS: Readonly<Record<string, readonly string[]>> = {
  appointments: ["date", "weekday", "time", "status", "service", "provider", "location", "customer", "email", "phone", "price", "duration"],
  orders: ["date", "weekday", "time", "customer", "email", "phone", "fulfillment", "status", "subtotal", "items", "for_date", "for_weekday"],
  goals: ["text", "live"],
  rules: ["text", "live"],
  answers: ["question", "label", "live", "served", "draft", "answered"],
  "booking-services": ["name", "category", "price", "duration", "enabled", "pricing"],
  "booking-providers": ["name", "role", "enabled", "specialties", "languages"],
  "booking-locations": ["name", "kind", "address", "enabled", "timezone"],
};

/** What the element panels are built from — the rows the dashboard already loads. */
export type CannedLike = {
  id: string;
  question: string;
  label: string;
  answer: string;
  cardTool: string | null;
  cardInput: string | null;
  enabled: boolean;
  hits: number;
  order: number;
  aiDraft: boolean;
};

export type ElementData = {
  /** IANA zone the business keeps time in; dates and weekdays resolve in it. */
  timeZone: string;
  currency: string;
  appointments: AppointmentDetail[];
  orders: OrderRow[];
  goals: DirectiveRow[];
  rules: DirectiveRow[];
  canned: CannedLike[];
  services: ServiceRow[];
  staff: StaffRow[];
  locations: LocationRow[];
};

// ── Dates ───────────────────────────────────────────────────────────────────

function inZone(d: Date, timeZone: string, opts: Intl.DateTimeFormatOptions, locale: string): string {
  try {
    return d.toLocaleDateString(locale, { ...opts, timeZone });
  } catch {
    return d.toLocaleDateString(locale, opts);
  }
}

/** `date` YYYY-MM-DD, `weekday` lowercase English, `time` HH:MM — all in the zone. */
export function dateFacets(when: string | Date, timeZone: string): { date: string; weekday: string; time: string } {
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return { date: "", weekday: "", time: "" };
  const date = inZone(d, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");
  const weekday = inZone(d, timeZone, { weekday: "long" }, "en-US").toLowerCase();
  let time: string;
  try {
    time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  } catch {
    time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  return { date, weekday, time };
}

/** The TODAY line the copilot reasons about relative days from. */
export function todayLine(now: Date, timeZone: string): string {
  const { date, weekday } = dateFacets(now, timeZone);
  return `TODAY is ${date} (${weekday}) in the ${timeZone} timezone.`;
}

/** The server's own zone, when the business has not set one. */
export function fallbackTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ── Row → panel shapes (shared with panels.tsx so both sides agree) ─────────

export function toCalendarAppointment(a: AppointmentDetail): CalendarAppointment {
  return {
    id: a.id,
    startsAt: a.startsAt,
    status: a.status,
    serviceName: a.serviceName,
    staffName: a.staffName,
    locationName: a.locationName,
    customerName: [a.customer.firstName, a.customer.lastName].filter(Boolean).join(" "),
    customerEmail: a.customer.email ?? "",
    customerPhone: a.customer.phone ?? "",
    durationMinutes: a.durationMinutes,
    priceDisplay: a.pricing?.total !== undefined ? formatMoney(a.pricing.total, a.pricing.currency) : "",
    answers: a.answers,
  };
}

export function toCalendarOrder(o: OrderRow): CalendarOrder {
  return {
    id: o.id,
    createdAt: o.createdAt.toISOString(),
    startsAt: o.startsAt ? o.startsAt.toISOString() : null,
    lines: o.lines.map((l) => ({
      name: l.name,
      quantity: l.quantity,
      choices: l.choices.flatMap((c) => c.picks).join(", "),
      note: l.note,
      lineTotal: l.lineTotal,
    })),
    contact: o.contact,
    fulfillment: o.fulfillment,
    notes: o.notes,
    subtotal: o.subtotal,
  };
}

// ── Builders ────────────────────────────────────────────────────────────────

const low = (s: string) => s.trim().toLowerCase();
const yn = (b: boolean) => (b ? "yes" : "no");
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** "$45" / "From $45" / "1,200.50" → 45 / 45 / 1200.5; NaN when there is no number. */
const money = (s: string) => Number(s.replace(/[^0-9.]/g, "")) || NaN;

export function appointmentElement(a: AppointmentDetail, timeZone: string): ElementMeta {
  const c = toCalendarAppointment(a);
  const { date, weekday, time } = dateFacets(a.startsAt, timeZone);
  const facets: Record<string, FacetValue> = {
    date,
    weekday,
    time,
    status: low(a.status),
    service: low(a.serviceName),
    provider: low(a.staffName),
    location: low(a.locationName),
    customer: low(c.customerName),
    email: low(c.customerEmail),
    phone: low(c.customerPhone),
    duration: a.durationMinutes,
  };
  if (a.pricing && typeof a.pricing.total === "number") facets.price = a.pricing.total;
  const label = [`${date} ${time}`, c.customerName, a.serviceName].filter(Boolean).join(" · ");
  return { id: a.id, panel: "appointments", label, facets };
}

export function orderElement(o: OrderRow, timeZone: string): ElementMeta {
  const placed = dateFacets(o.createdAt, timeZone);
  const facets: Record<string, FacetValue> = {
    date: placed.date,
    weekday: placed.weekday,
    time: placed.time,
    customer: low(o.contact.name),
    email: low(o.contact.email),
    phone: low(o.contact.phone),
    fulfillment: low(o.fulfillment),
    status: low(o.status),
    items: low(o.lines.map((l) => l.name).join(", ")),
  };
  const sub = money(o.subtotal);
  if (!Number.isNaN(sub)) facets.subtotal = sub;
  if (o.startsAt) {
    const f = dateFacets(o.startsAt, timeZone);
    facets.for_date = f.date;
    facets.for_weekday = f.weekday;
  }
  const label = [placed.date, o.contact.name || "Order", o.subtotal].filter(Boolean).join(" · ");
  return { id: o.id, panel: "orders", label, facets };
}

export function directiveElement(r: DirectiveRow, panel: "goals" | "rules"): ElementMeta {
  return { id: r.id, panel, label: clip(r.text), facets: { text: low(r.text), live: yn(r.enabled) } };
}

export function cannedElement(r: CannedLike): ElementMeta {
  return {
    id: r.id,
    panel: "answers",
    label: clip(r.question),
    facets: {
      question: low(r.question),
      label: low(r.label),
      live: yn(r.enabled),
      served: r.hits,
      draft: yn(r.aiDraft && r.answer.trim().length > 0),
      answered: yn(r.answer.trim().length > 0),
    },
  };
}

export function serviceElement(s: ServiceRow, currency: string): ElementMeta {
  const facets: Record<string, FacetValue> = {
    name: low(s.name),
    category: low(s.category),
    duration: s.durationMinutes,
    enabled: yn(s.enabled),
    pricing: s.pricing.kind,
  };
  if (typeof s.pricing.amount === "number") facets.price = s.pricing.amount;
  const price = typeof s.pricing.amount === "number" ? formatMoney(s.pricing.amount, currency) : s.pricing.kind;
  return { id: s.id, panel: "booking-services", label: `${s.name} · ${price}`, facets };
}

export function staffElement(s: StaffRow): ElementMeta {
  return {
    id: s.id,
    panel: "booking-providers",
    label: [s.name, s.role].filter(Boolean).join(" · "),
    facets: {
      name: low(s.name),
      role: low(s.role),
      enabled: yn(s.enabled),
      specialties: low(s.specialties.join(", ")),
      languages: low(s.languages.join(", ")),
    },
  };
}

export function locationElement(l: LocationRow): ElementMeta {
  return {
    id: l.id,
    panel: "booking-locations",
    label: [l.name, l.kind].filter(Boolean).join(" · "),
    facets: {
      name: low(l.name),
      kind: low(l.kind),
      address: low(l.address),
      enabled: yn(l.enabled),
      timezone: low(l.timezone),
    },
  };
}

/** The whole index for one tenant, panel by panel, in each panel's own row order. */
export function buildElementIndex(d: ElementData): ElementMeta[] {
  return [
    ...d.appointments.map((a) => appointmentElement(a, d.timeZone)),
    ...d.orders.map((o) => orderElement(o, d.timeZone)),
    ...d.goals.map((r) => directiveElement(r, "goals")),
    ...d.rules.map((r) => directiveElement(r, "rules")),
    ...d.canned.map(cannedElement),
    ...d.services.map((s) => serviceElement(s, d.currency)),
    ...d.staff.map(staffElement),
    ...d.locations.map(locationElement),
  ];
}

// ── Selection ───────────────────────────────────────────────────────────────

function matches(v: FacetValue | undefined, f: ElementFilter): boolean {
  if (v === undefined) return false;
  const want = f.value.trim().toLowerCase();
  const have = String(v).trim().toLowerCase();
  const bothNumeric = typeof v === "number" && want !== "" && !Number.isNaN(Number(want));
  switch (f.op) {
    case "is":
      return bothNumeric ? v === Number(want) : have === want;
    case "contains":
      return have.includes(want);
    case "before":
      return bothNumeric ? v < Number(want) : have < want;
    case "after":
      return bothNumeric ? v > Number(want) : have > want;
    case "gte":
      return bothNumeric ? v >= Number(want) : have >= want;
    case "lte":
      return bothNumeric ? v <= Number(want) : have <= want;
    default:
      return false;
  }
}

/** Deterministic filtering of the index: panel, then ids, then every filter, then limit. */
export function selectElements(index: ElementMeta[], sel: ElementSelection): ElementMeta[] {
  const ids = sel.ids?.length ? new Set(sel.ids) : null;
  const where = sel.where ?? [];
  const picked = index.filter(
    (e) => e.panel === sel.panel && (!ids || ids.has(e.id)) && where.every((f) => matches(e.facets[f.facet], f)),
  );
  const limit = sel.limit && sel.limit > 0 ? Math.floor(sel.limit) : undefined;
  return limit ? picked.slice(0, limit) : picked;
}

/** Bubble title for a selection: the panel label plus what was asked for. */
export function selectionTitle(panelLabel: string, sel: ElementSelection, count: number): string {
  const parts = (sel.where ?? []).map((f) => `${f.facet} ${f.op} ${f.value}`);
  const what = parts.length ? parts.join(", ") : sel.ids?.length ? "selected" : "all";
  return `${panelLabel} · ${what} · ${count} ${count === 1 ? "match" : "matches"}`;
}

/** The ELEMENTS section of the copilot's prompt: every element with its facets, capped per panel. */
export function elementIndexLines(index: ElementMeta[], cap = 40): string {
  const byPanel = new Map<string, ElementMeta[]>();
  for (const e of index) byPanel.set(e.panel, [...(byPanel.get(e.panel) ?? []), e]);
  const out: string[] = [];
  for (const panel of Object.keys(ELEMENT_PANELS)) {
    const rows = byPanel.get(panel) ?? [];
    out.push(`${panel} (facets: ${ELEMENT_PANELS[panel].join(", ")}) — ${rows.length} element${rows.length === 1 ? "" : "s"}`);
    for (const e of rows.slice(0, cap)) {
      const facets = Object.entries(e.facets)
        .filter(([, v]) => v !== "" && v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === "string" ? clip(v, 40) : v}`)
        .join(" ");
      out.push(`  - ${e.id} | ${clip(e.label, 60)} | ${facets}`);
    }
    if (rows.length > cap) out.push(`  … ${rows.length - cap} more; use where filters to reach them`);
  }
  return out.join("\n");
}

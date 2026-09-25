/**
 * Typed fetch helpers for the booking API (see docs/features/booking-flow/DESIGN.md
 * "API"). Every helper resolves to a result — never throws — so a network
 * hiccup degrades one step of the card instead of crashing the whole thing.
 */

import type { BookingFlow, BookingSelection, DayAvailability, PriceBreakdown, Slot } from "@/lib/booking/types";
import type { BookingField } from "../BookingQuestion";

export type ApiResult<T> = ({ ok: true } & T) | { ok: false; error: string };

async function call<T>(input: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(input, init);
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    if (!res.ok || obj.ok !== true) {
      const error = typeof obj.error === "string" ? obj.error : `Request failed (${res.status})`;
      return { ok: false, error };
    }
    return data as ApiResult<T>;
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

/** GET /api/booking?slug=…[&service=<id>] */
export function getBookingFlow(slug: string, serviceId?: string | null) {
  const qs = new URLSearchParams({ slug });
  if (serviceId) qs.set("service", serviceId);
  return call<{ enabled: boolean; fields: BookingField[]; flow: BookingFlow | null }>(`/api/booking?${qs.toString()}`);
}

export type AvailabilityQuery = {
  slug: string;
  serviceId?: string | null;
  variantId?: string | null;
  addonIds?: string[];
  staffId?: string | null;
  locationId?: string | null;
};

function availabilityParams(q: AvailabilityQuery, extra: Record<string, string>): string {
  const qs = new URLSearchParams({ slug: q.slug });
  if (q.serviceId) qs.set("serviceId", q.serviceId);
  if (q.variantId) qs.set("variantId", q.variantId);
  if (q.addonIds && q.addonIds.length) qs.set("addonIds", q.addonIds.join(","));
  if (q.staffId) qs.set("staffId", q.staffId);
  if (q.locationId) qs.set("locationId", q.locationId);
  for (const [k, v] of Object.entries(extra)) qs.set(k, v);
  return qs.toString();
}

/** GET /api/booking/availability with &month=YYYY-MM → the calendar view. */
export function getAvailabilityMonth(q: AvailabilityQuery & { month: string }) {
  return call<{ timezone: string; days: DayAvailability[]; earliest: Slot | null }>(
    `/api/booking/availability?${availabilityParams(q, { month: q.month })}`,
  );
}

/** GET /api/booking/availability with &date=YYYY-MM-DD → one day's slots. */
export function getAvailabilityDay(q: AvailabilityQuery & { date: string }) {
  return call<{ timezone: string; slots: Slot[]; full: boolean; earliest: Slot | null; dayStart?: string }>(
    `/api/booking/availability?${availabilityParams(q, { date: q.date })}`,
  );
}

/** POST /api/booking/quote — the review screen's figures. */
export function quoteBooking(slug: string, selection: BookingSelection) {
  return call<{ breakdown: PriceBreakdown }>("/api/booking/quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, ...selection }),
  });
}

export type CreateBookingResult = {
  id: string;
  status: "confirmed" | "waitlisted";
  startsAt: string;
  endsAt: string;
  breakdown: PriceBreakdown;
  staffName: string;
  locationName: string;
  serviceName: string;
  ids: string[];
};

/** POST /api/booking with the full BookingSelection. */
export function createBooking(slug: string, selection: BookingSelection) {
  return call<CreateBookingResult>("/api/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, ...selection }),
  });
}

/** POST /api/booking/upload (multipart) — images and PDF, ≤ 8 MB. */
export async function uploadBookingFile(slug: string, file: File): Promise<ApiResult<{ path: string }>> {
  try {
    const form = new FormData();
    form.append("slug", slug);
    form.append("file", file);
    const res = await fetch("/api/booking/upload", { method: "POST", body: form });
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    if (!res.ok || obj.ok !== true || typeof obj.path !== "string") {
      const error = typeof obj.error === "string" ? obj.error : `Upload failed (${res.status})`;
      return { ok: false, error };
    }
    return { ok: true, path: obj.path };
  } catch {
    return { ok: false, error: "Network error. Try again." };
  }
}

import { getProfile } from "@/lib/db";
import { setBookingEnabled } from "@/lib/appointments";
import {
  deleteService,
  deleteStaff,
  getBookingSettings,
  listServices,
  listStaff,
  saveBookingSettings,
  saveService,
  saveStaff,
} from "@/lib/booking/store";
import { PRICING_KINDS, type Pricing, type PricingKind } from "@/lib/booking/types";

/**
 * The booking review the onboarding chat runs once extraction is done: the
 * services and providers the seeder wrote, as the few facts a first look
 * needs (name, price, length, on/off; name, role, on/off), plus the rules
 * that shape the visitor's flow — whether booking is on and whether a
 * visitor picks a person. Reading is a projection of the store; writing goes
 * through the same saveService / saveStaff / saveBookingSettings the Booking
 * tab uses, as PARTIAL patches, so everything the seeder found that this
 * card does not show (photos, add-ons, policies, hours) is untouched.
 */

export type ReviewService = {
  id: string;
  name: string;
  category: string;
  pricingKind: PricingKind;
  amount: string;
  maxAmount: string;
  durationMinutes: number;
  enabled: boolean;
  imageUrl: string | null;
};

export type ReviewStaff = {
  id: string;
  name: string;
  role: string;
  enabled: boolean;
  photoUrl: string | null;
};

export type BookingReview = {
  bookingEnabled: boolean;
  currency: string;
  staffSelection: "hidden" | "optional" | "required";
  services: ReviewService[];
  staff: ReviewStaff[];
};

export async function readBookingReview(userId: string): Promise<BookingReview> {
  const [profile, settings, services, staff] = await Promise.all([
    getProfile(userId),
    getBookingSettings(userId),
    listServices(userId),
    listStaff(userId),
  ]);
  return {
    bookingEnabled: profile.bookingEnabled,
    currency: settings.currency,
    staffSelection: settings.staffSelection,
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      pricingKind: s.pricing.kind,
      amount: s.pricing.amount !== undefined ? String(s.pricing.amount) : "",
      maxAmount: s.pricing.maxAmount !== undefined ? String(s.pricing.maxAmount) : "",
      durationMinutes: s.durationMinutes,
      enabled: s.enabled,
      imageUrl: s.imageUrl,
    })),
    staff: staff.map((p) => ({ id: p.id, name: p.name, role: p.role, enabled: p.enabled, photoUrl: p.photoUrl })),
  };
}

/** What the card posts back. `id` empty = a row the owner added in the chat. */
export type BookingReviewSave = {
  bookingEnabled?: boolean;
  staffSelection?: string;
  services?: { id?: string; name: string; pricingKind: string; amount?: string; maxAmount?: string; durationMinutes?: number | string; enabled?: boolean }[];
  /** Rows the owner removed in the chat. */
  removedServiceIds?: string[];
  staff?: { id?: string; name: string; role?: string; enabled?: boolean }[];
  removedStaffIds?: string[];
};

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function pricingOf(kind: unknown, amount: unknown, maxAmount: unknown): Pricing {
  const k = (PRICING_KINDS as readonly string[]).includes(String(kind)) ? (kind as PricingKind) : "variable";
  const p: Pricing = { kind: k };
  const a = num(amount);
  if (a !== undefined) p.amount = a;
  const m = num(maxAmount);
  if (k === "range" && m !== undefined) p.maxAmount = m;
  return p;
}

export async function saveBookingReview(userId: string, body: BookingReviewSave): Promise<{ services: number; staff: number }> {
  const out = { services: 0, staff: 0 };
  const own = (ids: unknown, have: Set<string>) =>
    (Array.isArray(ids) ? ids.map(String) : []).filter((id) => have.has(id));

  if (Array.isArray(body.services) || Array.isArray(body.removedServiceIds)) {
    const have = new Set((await listServices(userId)).map((s) => s.id));
    for (const id of own(body.removedServiceIds, have)) await deleteService(userId, id);
    for (const s of body.services ?? []) {
      const name = str(s?.name);
      if (!name) continue;
      const id = str(s.id);
      if (id && !have.has(id)) continue;
      const saved = await saveService(userId, {
        ...(id ? { id } : {}),
        name,
        pricing: pricingOf(s.pricingKind, s.amount, s.maxAmount),
        ...(num(s.durationMinutes) !== undefined ? { durationMinutes: num(s.durationMinutes) } : {}),
        ...(typeof s.enabled === "boolean" ? { enabled: s.enabled } : {}),
      });
      if (saved.ok) out.services++;
    }
  }

  if (Array.isArray(body.staff) || Array.isArray(body.removedStaffIds)) {
    const have = new Set((await listStaff(userId)).map((p) => p.id));
    for (const id of own(body.removedStaffIds, have)) await deleteStaff(userId, id);
    for (const p of body.staff ?? []) {
      const name = str(p?.name, 120);
      if (!name) continue;
      const id = str(p.id);
      if (id && !have.has(id)) continue;
      const saved = await saveStaff(userId, {
        ...(id ? { id } : {}),
        name,
        ...(typeof p.role === "string" ? { role: p.role } : {}),
        ...(typeof p.enabled === "boolean" ? { enabled: p.enabled } : {}),
      });
      if (saved.ok) out.staff++;
    }
  }

  if (body.staffSelection === "hidden" || body.staffSelection === "optional" || body.staffSelection === "required") {
    await saveBookingSettings(userId, { staffSelection: body.staffSelection });
  }
  if (typeof body.bookingEnabled === "boolean") await setBookingEnabled(userId, body.bookingEnabled);
  return out;
}

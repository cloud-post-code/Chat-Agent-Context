import { listCannedAnswers } from "@/lib/canned";
import { listDirectives } from "@/lib/directives";
import { listOrders } from "@/lib/orders";
import {
  getBookingSettings,
  listBookings,
  listLocations,
  listServices,
  listStaff,
} from "@/lib/booking/store";
import {
  buildElementIndex,
  fallbackTimeZone,
  type ElementData,
  type ElementMeta,
} from "@/lib/adminElements";

/**
 * Loads the rows the element panels are built from — the same stores the
 * dashboard reads — so the brain's index and the panel's nodes come from one
 * shape of data. Server-only; the pure builders live in lib/adminElements.ts.
 */
export async function loadElementData(userId: string): Promise<ElementData> {
  const [settings, appointments, orders, goals, rules, canned, services, staff, locations] =
    await Promise.all([
      getBookingSettings(userId),
      listBookings(userId),
      listOrders(userId).catch(() => []),
      listDirectives(userId, "goal"),
      listDirectives(userId, "rule"),
      listCannedAnswers(userId),
      listServices(userId),
      listStaff(userId),
      listLocations(userId),
    ]);
  return {
    timeZone: settings.timezone || fallbackTimeZone(),
    currency: settings.currency,
    appointments,
    orders,
    goals,
    rules,
    canned,
    services,
    staff,
    locations,
  };
}

export async function loadElementIndex(
  userId: string,
): Promise<{ index: ElementMeta[]; timeZone: string }> {
  const data = await loadElementData(userId);
  return { index: buildElementIndex(data), timeZone: data.timeZone };
}

/**
 * The pricing engine, pure, with no imports beyond ./types.
 *
 * Turns a visitor's selection (service, variant, add-ons, quantity, provider,
 * location, mode, promo, membership, tip) into the line-by-line breakdown the
 * review screen shows and the server re-derives to check a submitted total.
 * Every number is rounded to cents and nothing here ever produces NaN — a
 * missing amount becomes 0 (free) or null (unpriced), never a broken figure.
 */

import type {
  BookingSettings,
  LocationRow,
  Membership,
  PriceBreakdown,
  PriceLine,
  PriceLineKind,
  Pricing,
  PromoCode,
  ServiceAddon,
  ServiceMode,
  ServiceRow,
  ServiceVariant,
  StaffRow,
} from "./types";
import { baseDuration, effectivePricing, formatMoney, pricingLabel } from "./types";

export type PriceInput = {
  service: ServiceRow | null;
  variant: ServiceVariant | null;
  addons: ServiceAddon[];
  quantity: number;
  staff: StaffRow | null;
  location: LocationRow | null;
  mode: ServiceMode;
  settings: BookingSettings;
  promo: PromoCode | null;
  membership: Membership | null;
  tipPercent: number | null;
  tipAmount: number | null;
};

function round2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function qtyOf(n: number | undefined): number {
  const v = Math.round(n ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Minutes the appointment occupies: the base (staff override beats variant
 * beats service, else the tenant's default), scaled by quantity for an
 * hourly service (quantity = hours, so the calendar has to hold that many
 * hours), plus every add-on's own minutes.
 *
 * DEVIATION from the literal DESIGN.md signature: `quantity` is added as an
 * optional field on top of the documented Pick so hourly durations can scale
 * without widening the required inputs — a caller passing the full
 * `PriceInput` (which already carries `quantity`) satisfies this type
 * unchanged, and one that passes only the five documented fields still works
 * (quantity defaults to 1).
 */
export function durationFor(
  i: Pick<PriceInput, "service" | "variant" | "addons" | "staff" | "settings"> & { quantity?: number },
): number {
  const base = baseDuration(i.service, i.variant, i.staff, i.settings.defaultDurationMinutes);
  const pricing = i.service ? effectivePricing(i.service, i.variant) : null;
  const quantity = qtyOf(i.quantity);
  const scaledBase = pricing?.kind === "hourly" ? base * quantity : base;
  const addonMinutes = (i.addons ?? []).reduce((sum, a) => sum + (a.durationMinutes ?? 0), 0);
  const total = Math.round(scaledBase + addonMinutes);
  return Number.isFinite(total) && total > 0 ? total : i.settings.defaultDurationMinutes;
}

/** One pricing kind's dollar figure and whether it's a floor, before quantity or overrides are folded in. */
function amountFor(pricing: Pricing, quantity: number): { amount: number | null; estimate: boolean; note?: string } {
  switch (pricing.kind) {
    case "free":
      return { amount: 0, estimate: false };
    case "fixed":
      return { amount: round2(pricing.amount ?? 0), estimate: false };
    case "starting_at":
      return { amount: round2(pricing.amount ?? 0), estimate: true };
    case "range":
      // The low end stands in for a single number; `estimate` says it's a floor.
      return { amount: round2(pricing.amount ?? 0), estimate: true };
    case "hourly":
    case "per_person":
    case "per_unit":
      return { amount: round2((pricing.amount ?? 0) * quantity), estimate: false };
    case "quote":
      return { amount: null, estimate: false, note: pricing.note };
    case "variable":
      return { amount: null, estimate: true, note: pricing.note };
  }
}

function depositFor(service: ServiceRow | null, total: number, quoteRequired: boolean): number | null {
  if (!service) return null;
  const d = service.deposit;
  if (d.kind === "fixed" && d.amount) return round2(d.amount);
  if (d.kind === "percent" && d.amount && !quoteRequired) return round2((total * d.amount) / 100);
  return null;
}

/**
 * The full price breakdown for a selection: service/variant, add-ons, travel
 * fee, promo, membership, service fee, tax, tip — in that order, each a
 * `PriceLine`. See the module doc for rounding and never-NaN guarantees.
 */
export function priceBreakdown(i: PriceInput): PriceBreakdown {
  const currency = i.settings.currency;
  const quantity = qtyOf(i.quantity);
  const lines: PriceLine[] = [];
  let quoteRequired = false;
  let servicePricing: Pricing | null = null;

  if (i.service) {
    const variant = i.variant;
    // DEVIATION (documented, per the task brief): a staff or location price
    // override only applies when the variant itself carries no pricing — a
    // variant's own price is more specific than a flat override for the base
    // service, so it wins. DESIGN.md's prose order ("staff override beats
    // variant beats service pricing", "a provider's own [override] wins over"
    // the location's) is honored for the *service* case (no variant picked):
    // staff override, then location override, then the service's own price.
    // Once a variant is picked its own pricing, when it has one, is what the
    // visitor was shown and must be charged.
    const staffOverride = i.staff ? i.staff.priceOverrides[i.service.id] : undefined;
    const locationOverride = i.location ? i.location.priceOverrides[i.service.id] : undefined;
    const overrideAmount = staffOverride ?? locationOverride;
    const pricing: Pricing = variant?.pricing
      ? variant.pricing
      : overrideAmount !== undefined
        ? { kind: "fixed", amount: overrideAmount }
        : i.service.pricing;
    servicePricing = pricing;
    quoteRequired = pricing.kind === "quote";
    const { amount, estimate, note } = amountFor(pricing, quantity);
    const baseName = variant ? variant.name : i.service.name;
    const label = pricing.kind === "per_person" || pricing.kind === "per_unit" ? `${baseName} × ${quantity}` : baseName;
    const line: PriceLine = { kind: (variant ? "variant" : "service") as PriceLineKind, label, amount, estimate };
    if (note) line.note = note;
    lines.push(line);
  }

  for (const a of i.addons ?? []) {
    lines.push({ kind: "addon", label: a.name, amount: round2(a.price ?? 0), estimate: false });
  }

  if (i.mode === "mobile" && i.location && i.location.serviceArea.travelFee) {
    lines.push({ kind: "travel", label: "Travel fee", amount: round2(i.location.serviceArea.travelFee), estimate: false });
  }

  let hasUnpriced = false;
  let subtotal = 0;
  for (const l of lines) {
    if (l.amount === null) hasUnpriced = true;
    else subtotal += l.amount;
  }
  subtotal = round2(subtotal);

  if (quoteRequired) {
    // "total = priced add-ons only" — the service itself can't be totaled.
    const addonTotal = round2(
      lines.filter((l) => l.kind === "addon" && l.amount !== null).reduce((s, l) => s + (l.amount as number), 0),
    );
    const deposit = depositFor(i.service, addonTotal, true);
    return {
      currency,
      lines,
      subtotal: addonTotal,
      total: addonTotal,
      estimate: true,
      quoteRequired: true,
      deposit,
      balance: deposit !== null ? round2(addonTotal - deposit) : null,
      durationMinutes: durationFor(i),
      display: "Quote",
    };
  }

  // Promo — negative, off the subtotal (service + add-ons + travel), and
  // re-checked here (not just trusted from the caller) against the service.
  let promoAmount = 0;
  if (i.promo && (i.promo.serviceIds.length === 0 || (i.service && i.promo.serviceIds.includes(i.service.id)))) {
    const raw = i.promo.kind === "percent" ? (subtotal * i.promo.amount) / 100 : Math.min(i.promo.amount, subtotal);
    promoAmount = round2(-raw);
    lines.push({ kind: "promo", label: i.promo.note || `Promo ${i.promo.code}`, amount: promoAmount });
  }
  const subtotalAfterPromo = round2(subtotal + promoAmount);

  // Membership — negative, a percent of the subtotal after the promo.
  let membershipAmount = 0;
  if (i.membership && i.membership.discountPercent > 0) {
    membershipAmount = round2(-((subtotalAfterPromo * i.membership.discountPercent) / 100));
    lines.push({ kind: "membership", label: i.membership.name, amount: membershipAmount });
  }
  const subtotalAfterDiscounts = round2(subtotalAfterPromo + membershipAmount);

  // Fee — fixed, or a percent of the subtotal after discounts.
  let feeAmount = 0;
  const fee = i.settings.serviceFee;
  if (fee.kind !== "none" && fee.amount) {
    feeAmount = round2(fee.kind === "fixed" ? fee.amount : (subtotalAfterDiscounts * fee.amount) / 100);
    lines.push({ kind: "fee", label: fee.label || "Service fee", amount: feeAmount });
  }
  const taxBase = round2(subtotalAfterDiscounts + feeAmount);

  // Tax — a percent of the subtotal after discounts, plus the fee.
  let taxAmount = 0;
  if (i.settings.taxRate > 0) {
    taxAmount = round2((taxBase * i.settings.taxRate) / 100);
    lines.push({ kind: "tax", label: i.settings.taxLabel || "Tax", amount: taxAmount });
  }
  const totalBeforeTip = round2(taxBase + taxAmount);

  // Tip — percent of the pre-tax, post-discount subtotal, or a flat amount;
  // at most one of the two ever applies (the selection guarantees this, but
  // we still prefer tipPercent when somehow both arrive).
  let tipAmount = 0;
  if (i.tipPercent !== null && i.tipPercent !== undefined && i.tipPercent > 0) {
    tipAmount = round2((subtotalAfterDiscounts * i.tipPercent) / 100);
    lines.push({ kind: "tip", label: `Tip (${i.tipPercent}%)`, amount: tipAmount });
  } else if (i.tipAmount !== null && i.tipAmount !== undefined && i.tipAmount > 0) {
    tipAmount = round2(i.tipAmount);
    lines.push({ kind: "tip", label: "Tip", amount: tipAmount });
  }

  const total = round2(totalBeforeTip + tipAmount);
  const estimate = hasUnpriced || lines.some((l) => l.estimate);
  const deposit = depositFor(i.service, total, false);
  const balance = deposit !== null ? round2(total - deposit) : null;
  const durationMinutes = durationFor(i);

  let display: string;
  // "Nothing else" means nothing the visitor added — add-ons, a travel fee, a
  // promo, a membership or a tip — not the tenant's own always-on fee/tax,
  // which would otherwise make pricingLabel() nearly unreachable for any
  // tenant that charges tax.
  const hasVisitorLines = lines.some(
    (l) => l.kind === "addon" || l.kind === "travel" || l.kind === "promo" || l.kind === "membership" || l.kind === "tip",
  );
  const nothingElse = !hasVisitorLines && quantity === 1;
  if (i.service && nothingElse && servicePricing) {
    display = pricingLabel(servicePricing, currency);
  } else {
    display = estimate ? `From ${formatMoney(total, currency)}` : formatMoney(total, currency);
  }

  return { currency, lines, subtotal, total, estimate, quoteRequired: false, deposit, balance, durationMinutes, display };
}

/**
 * A promo code by its text, case-insensitively, restricted to a service when
 * the promo lists any and not yet expired (`expiresOn` itself is still a
 * valid day to use it — only strictly-past dates are rejected).
 */
export function findPromo(
  settings: BookingSettings,
  code: string,
  serviceId: string | null,
  today: string,
): PromoCode | null {
  const norm = (code ?? "").trim().toUpperCase();
  if (!norm) return null;
  for (const p of settings.promoCodes) {
    if (p.code.toUpperCase() !== norm) continue;
    if (p.expiresOn && p.expiresOn < today) continue;
    if (p.serviceIds.length && (!serviceId || !p.serviceIds.includes(serviceId))) continue;
    return p;
  }
  return null;
}

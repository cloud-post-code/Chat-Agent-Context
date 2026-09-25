"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { deleteAppointmentField, getBookingConfig, moveAppointmentField, renumberScreens, saveAppointmentField, setBookingEnabled, setFieldScreen } from "@/lib/appointments";
import { isFieldRole, parseOptionLines } from "@/lib/appointmentTypes";
import { saveService, deleteService, moveService, saveStaff, deleteStaff, moveStaff, saveLocation, deleteLocation, moveLocation, getBookingSettings, saveBookingSettings, setBookingStatus } from "@/lib/booking/store";
import { sanitizeFlow, type Pricing, type Deposit, type ServiceMode, type LocationKind } from "@/lib/booking/types";
import { flowFromIds, insertScreenAfter, remapFlowScreens, screenRenumbering, stepFromId } from "@/lib/booking/flowEdit";
import { parseVariantLines, parseAddonLines, parseHolidayLines, parseTimeOffLines, parsePromoLines, parseMembershipLines } from "../booking/lines";
import { hoursFromForm, numOrUndef, intOrUndef, intOr, strOrUndef, listOf } from "../booking/forms";
import { refreshServicesFromSite } from "@/lib/onboarding/refreshServices";
import { isPublicTarget } from "@/lib/onboarding/netGuard";
import { saveUpload } from "@/lib/uploads";
import { requireUser, isUpload, revalidateAll } from "./_shared";

// ── Appointments ──

export async function setBookingEnabledAction(formData: FormData) {
  const user = await requireUser();
  await setBookingEnabled(user.id, formData.get("enabled") === "on");
  revalidateAll();
}

export async function saveAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  // The form only renders the inputs its type uses, so every part of the
  // config is read as "absent unless posted"; saveAppointmentField keeps the
  // parts the type can use and drops the rest.
  const int = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw && Number.isInteger(Number(raw)) ? Number(raw) : undefined;
  };
  // "Only ask when…": a condition on another question's key, with optional
  // values — empty values means "whenever that question has any answer".
  const showIfKey = String(formData.get("showIfKey") ?? "").trim();
  const showIfValues = String(formData.get("showIfValues") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const role = formData.get("role");
  await saveAppointmentField(user.id, {
    key: String(formData.get("key") ?? "") || undefined,
    label: String(formData.get("label") ?? ""),
    type: String(formData.get("type") ?? "short_text"),
    required: formData.get("required") === "on",
    role: isFieldRole(role) ? role : undefined,
    screen: int("screen"),
    config: {
      options: parseOptionLines(String(formData.get("options") ?? "")),
      allowOther: formData.get("allowOther") === "on",
      min: int("min"),
      max: int("max"),
      text: String(formData.get("waiverText") ?? "") || undefined,
      showIf: showIfKey ? { key: showIfKey, values: showIfValues } : undefined,
      placeholder: String(formData.get("placeholder") ?? "").trim() || undefined,
      help: String(formData.get("help") ?? "").trim() || undefined,
    },
  });
  revalidateAll();
}

export async function deleteAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  await deleteAppointmentField(user.id, String(formData.get("key") ?? ""));
  revalidateAll();
}

export async function moveAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveAppointmentField(user.id, String(formData.get("key") ?? ""), dir);
  revalidateAll();
}

/**
 * The Form panel's step order, posted whole. Form data: `steps` — a JSON
 * array of step ids (`service|provider|location|time|screen:<n>|review`) in
 * the order to ask them — or, without it, one `step` input per id in order;
 * plus `title:<id>` inputs (`title:screen:2`, `title:review`) for the heading
 * a step shows. A title left out keeps the stored one; posted empty, it is
 * cleared. `sanitizeFlow` settles the rest: one review, last; a screen the
 * post forgets is asked before review.
 */
export async function saveBookingFlowAction(formData: FormData) {
  const user = await requireUser();
  const [settings, config] = await Promise.all([getBookingSettings(user.id), getBookingConfig(user.id)]);
  let ids: string[] = [];
  const raw = String(formData.get("steps") ?? "").trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
    } catch {
      ids = [];
    }
  } else {
    ids = formData.getAll("step").map((v) => String(v));
  }
  const titles: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("title:") || typeof value !== "string") continue;
    const id = name.slice("title:".length);
    if (stepFromId(id)) titles[id] = value;
  }
  const previous = sanitizeFlow(settings.flow, config.fields);
  // Nothing posted but titles: keep the order as it is.
  const order = ids.length ? ids : previous.map((s) => (s.kind === "questions" ? `screen:${s.screen}` : s.kind));
  const flow = sanitizeFlow(flowFromIds(order, titles, previous), config.fields);
  await saveBookingSettings(user.id, { flow });
  revalidateAll();
}

/**
 * Put a question on another screen. Form data: `key` and `mode` — `new`
 * starts a screen at this question (it and every later question on its
 * screen move to a fresh screen, asked right after the one they left);
 * `previous` joins the screen of the question just before it in order; a
 * number is that screen. Screens are renumbered 1..m by first appearance
 * afterwards, and the flow's screen references follow the renumbering so no
 * step ends up asking the wrong screen.
 */
export async function setFieldScreenAction(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  const mode = String(formData.get("mode") ?? "").trim();
  const [settings, config] = await Promise.all([getBookingSettings(user.id), getBookingConfig(user.id)]);
  const fields = config.fields;
  const i = fields.findIndex((f) => f.key === key);
  if (i < 0) return;
  let flow = sanitizeFlow(settings.flow, fields);
  const from = fields[i].screen;

  if (mode === "new") {
    const top = Math.max(0, ...fields.map((f) => f.screen));
    const target = top + 1;
    const moving = fields.slice(i).filter((f) => f.screen === from);
    for (const f of moving) await setFieldScreen(user.id, f.key, target);
    flow = insertScreenAfter(flow, from, target);
  } else if (mode === "previous") {
    if (i === 0) return;
    await setFieldScreen(user.id, key, fields[i - 1].screen);
  } else {
    const screen = Number(mode);
    if (!Number.isInteger(screen) || screen < 1) return;
    await setFieldScreen(user.id, key, screen);
  }

  // The stored flow names screens by number; renumbering changes the
  // numbers, so the flow is rewritten to match before the rows are.
  const after = await prisma.appointmentField.findMany({
    where: { userId: user.id },
    orderBy: { order: "asc" },
    select: { screen: true, order: true },
  });
  const mapping = screenRenumbering(after);
  await saveBookingSettings(user.id, { flow: remapFlowScreens(flow, mapping) });
  await renumberScreens(user.id);
  revalidateAll();
}

export async function deleteOrderAction(formData: FormData) {
  const user = await requireUser();
  const { deleteOrder } = await import("@/lib/orders");
  await deleteOrder(user.id, String(formData.get("id") ?? ""));
  revalidateAll();
}

// ── Booking (app/admin/booking/): services, providers, locations, settings,
// and the richer Calendar's status actions. Thin auth wrappers around
// lib/booking/store, same idiom as every action above — the parsing helpers
// live in ./booking/forms.ts and ./booking/lines.ts so they stay testable
// without a request context.

/** Only assign a key when its parsed value is defined, so a blank/invalid
 *  number field never overwrites a stored setting with `undefined` when the
 *  patch is merged over it. */
function setDefined(obj: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) obj[key] = value;
}

export async function saveServiceAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  // imageFilename left out (undefined) keeps the stored image; "" from a
  // removed image, and the store's own saveUpload-derived name from a new one.
  let imageFilename: string | null | undefined;
  const file = formData.get("image");
  if (isUpload(file) && file.size > 0) {
    imageFilename = await saveUpload(file);
  } else if (formData.get("removeImage") === "on") {
    imageFilename = null;
  }

  const pricing: Pricing = {
    kind: (String(formData.get("pricingKind") ?? "fixed")) as Pricing["kind"],
    amount: numOrUndef(formData.get("pricingAmount")),
    maxAmount: numOrUndef(formData.get("pricingMaxAmount")),
    unitLabel: strOrUndef(formData.get("pricingUnitLabel")),
    note: strOrUndef(formData.get("pricingNote")),
  };
  const deposit: Deposit = {
    kind: (String(formData.get("depositKind") ?? "none")) as Deposit["kind"],
    amount: numOrUndef(formData.get("depositAmount")),
  };

  await saveService(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    category: String(formData.get("category") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    imageFilename,
    pricing,
    durationMinutes: intOr(formData.get("durationMinutes"), 30),
    bufferBeforeMinutes: intOr(formData.get("bufferBeforeMinutes"), 0),
    bufferAfterMinutes: intOr(formData.get("bufferAfterMinutes"), 0),
    deposit,
    modes: formData.getAll("modes").map(String) as ServiceMode[],
    staffIds: formData.getAll("staffIds").map(String),
    locationIds: formData.getAll("locationIds").map(String),
    eligibility: String(formData.get("eligibility") ?? ""),
    preparation: String(formData.get("preparation") ?? ""),
    cancellationPolicy: String(formData.get("cancellationPolicy") ?? ""),
    maxQuantity: numOrUndef(formData.get("maxQuantity")),
    variants: parseVariantLines(String(formData.get("variants") ?? "")),
    addons: parseAddonLines(String(formData.get("addons") ?? "")),
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteServiceAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteService(user.id, id);
  revalidateAll();
}

export async function moveServiceAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveService(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

export async function saveStaffAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  let photoFilename: string | null | undefined;
  const file = formData.get("photo");
  if (isUpload(file) && file.size > 0) {
    photoFilename = await saveUpload(file);
  } else if (formData.get("removePhoto") === "on") {
    photoFilename = null;
  }

  // Per-service price/duration overrides post as "priceOverride.<serviceId>"
  // / "durationOverride.<serviceId>" rows, one per service on file.
  const priceOverrides: Record<string, number> = {};
  const durationOverrides: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("priceOverride.")) {
      const n = numOrUndef(value);
      if (n !== undefined) priceOverrides[key.slice("priceOverride.".length)] = n;
    } else if (key.startsWith("durationOverride.")) {
      const n = intOrUndef(value);
      if (n !== undefined) durationOverrides[key.slice("durationOverride.".length)] = n;
    }
  }

  await saveStaff(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    role: String(formData.get("role") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    photoFilename,
    specialties: listOf(formData.get("specialties")),
    languages: listOf(formData.get("languages")),
    credentials: listOf(formData.get("credentials")),
    genderLabel: String(formData.get("genderLabel") ?? ""),
    // An all-closed WeeklyHours (every day empty — either "Use business
    // hours" was checked, or every day really was marked Closed)
    // sanitizes to null via sanitizeOptionalHours, so this needs no branch.
    hours: hoursFromForm(formData, "hours"),
    timeOff: parseTimeOffLines(String(formData.get("timeOff") ?? "")),
    priceOverrides,
    durationOverrides,
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteStaffAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteStaff(user.id, id);
  revalidateAll();
}

export async function moveStaffAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveStaff(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

export async function saveLocationAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const kind = String(formData.get("kind") ?? "business");

  // Per-service price overrides post as "priceOverride.<serviceId>" rows, one
  // per service on file — same idiom as the provider form's overrides.
  const priceOverrides: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("priceOverride.")) {
      const n = numOrUndef(value);
      if (n !== undefined) priceOverrides[key.slice("priceOverride.".length)] = n;
    }
  }

  await saveLocation(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    kind: (["business", "virtual", "mobile"].includes(kind) ? kind : "business") as LocationKind,
    address: String(formData.get("address") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    hours: hoursFromForm(formData, "hours"),
    serviceArea: {
      postalCodes: String(formData.get("postalCodes") ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      radiusMiles: numOrUndef(formData.get("radiusMiles")),
      travelFee: numOrUndef(formData.get("travelFee")),
      description: strOrUndef(formData.get("serviceAreaDescription")),
    },
    meetingLink: String(formData.get("meetingLink") ?? ""),
    note: String(formData.get("note") ?? ""),
    capacity: intOr(formData.get("capacity"), 1),
    priceOverrides,
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteLocationAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteLocation(user.id, id);
  revalidateAll();
}

export async function moveLocationAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveLocation(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

/**
 * One action for the three BookingSettings sub-panels (Hours & rules,
 * Customer details, Pricing & policies) — a hidden "section" field says which
 * slice of the form posted, so each builds only the patch its own fields
 * cover. saveBookingSettings merges the patch over the stored config, so a
 * field this call leaves out keeps its current value.
 */
export async function saveBookingSettingsAction(formData: FormData) {
  const user = await requireUser();
  const section = String(formData.get("section") ?? "");
  const patch: Record<string, unknown> = {};

  if (section === "hours") {
    patch.timezone = String(formData.get("timezone") ?? "");
    patch.hours = hoursFromForm(formData, "hours");
    patch.holidays = parseHolidayLines(String(formData.get("holidays") ?? ""));
    setDefined(patch, "slotIntervalMinutes", intOrUndef(formData.get("slotIntervalMinutes")));
    setDefined(patch, "leadTimeMinutes", intOrUndef(formData.get("leadTimeMinutes")));
    patch.dailyCutoff = String(formData.get("dailyCutoff") ?? "");
    patch.sameDayBooking = formData.get("sameDayBooking") === "on";
    setDefined(patch, "maxAdvanceDays", intOrUndef(formData.get("maxAdvanceDays")));
    setDefined(patch, "bufferBeforeMinutes", intOrUndef(formData.get("bufferBeforeMinutes")));
    setDefined(patch, "bufferAfterMinutes", intOrUndef(formData.get("bufferAfterMinutes")));
    setDefined(patch, "defaultDurationMinutes", intOrUndef(formData.get("defaultDurationMinutes")));
    patch.waitlist = formData.get("waitlist") === "on";
    patch.recurring = formData.get("recurring") === "on";
    patch.staffSelection = String(formData.get("staffSelection") ?? "optional");
    patch.genderPreference = formData.get("genderPreference") === "on";
    // The owner's word on confirmation outlives any later site read.
    patch.confirmation = formData.get("confirmation") === "request" ? "request" : "instant";
    patch.confirmationOwner = true;
  } else if (section === "pricing") {
    const currencySelect = String(formData.get("currency") ?? "").trim().toUpperCase();
    const currencyOther = String(formData.get("currencyOther") ?? "").trim().toUpperCase();
    const currency = currencySelect || currencyOther;
    if (currency) patch.currency = currency;
    setDefined(patch, "taxRate", numOrUndef(formData.get("taxRate")));
    patch.taxLabel = String(formData.get("taxLabel") ?? "");
    patch.serviceFee = {
      kind: String(formData.get("serviceFeeKind") ?? "none"),
      amount: numOrUndef(formData.get("serviceFeeAmount")),
      label: String(formData.get("serviceFeeLabel") ?? ""),
    };
    patch.tips = {
      enabled: formData.get("tipsEnabled") === "on",
      presets: listOf(formData.get("tipsPresets"))
        .map((s) => Number.parseFloat(s))
        .filter((n) => Number.isFinite(n)),
    };
    patch.promoCodes = parsePromoLines(String(formData.get("promoCodes") ?? ""));
    patch.memberships = parseMembershipLines(String(formData.get("memberships") ?? ""));
    patch.cancellationPolicy = String(formData.get("cancellationPolicy") ?? "");
    patch.depositPolicy = String(formData.get("depositPolicy") ?? "");
    patch.confirmationNote = String(formData.get("confirmationNote") ?? "");
  }

  await saveBookingSettings(user.id, patch);
  revalidateAll();
}

/** Cancel a booking: the row keeps its status history (lib/booking/store.ts). */
export async function cancelBookingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setBookingStatus(user.id, id, "cancelled");
  revalidateAll();
}

/**
 * Re-read the site for the services' prices, durations, add-ons, policies
 * and photos, filling only what is blank (lib/onboarding/refreshServices.ts).
 * Runs inline — a site read takes tens of seconds, which the pending button
 * shows — and lands back on the Services tab with a one-line result.
 */
export async function refreshServicesFromSiteAction(formData: FormData) {
  const user = await requireUser();
  const site = String(formData.get("site") ?? "").trim();
  // A typed address the crawler will open: public internet only (netGuard.ts).
  if (site && !(await isPublicTarget(site))) {
    redirect(`/admin/dashboard?tab=booking-services&booking=${encodeURIComponent("That address isn't a public website.")}`);
  }
  const result = await refreshServicesFromSite(user.id, () => {}, site || undefined);
  revalidateAll();
  const notice = result.ok
    ? `Read ${result.site}: ${result.services} service${result.services === 1 ? "" : "s"} found, ${result.added} added, ${result.updated} updated, ${result.imaged} photo${result.imaged === 1 ? "" : "s"} attached.`
    : result.error;
  redirect(`/admin/dashboard?tab=booking-services&booking=${encodeURIComponent(notice)}`);
}

/** Confirm a waitlisted booking. */
export async function confirmBookingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setBookingStatus(user.id, id, "confirmed");
  revalidateAll();
}

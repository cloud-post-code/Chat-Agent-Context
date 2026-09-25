import { randomUUID } from "node:crypto";
import { prisma, getProfile } from "../db";
import { getBookingConfig, safeAnswers } from "../appointments";
import type { AppointmentFieldRow } from "../appointmentTypes";
import { isFieldShown, resolveAnswer, durationMinutes as parseDurationMinutes } from "../appointmentTypes";
import { SERVICE_PICKER_KEY, serviceOptions } from "../bookingMenu";
import { onboardingIngestKind } from "../ingestionSources";
import { SERVICES_SOURCE_TITLE, parseServiceCatalog } from "../serviceCatalog";
import { sanitizeMenuItem, type MenuItemData } from "../menuTypes";
import { indexAppointment } from "../retrieval/origins";
import { dropOrigin } from "../retrieval/indexer";
import { bestImageFor, type GalleryPhoto } from "./matchImages";
import { addMinutes, shiftDays, ymd, zonedParts, zonedToUtc } from "./time";
import { availableDays, availableSlots, checkSlot, earliestSlot, type AvailabilityInput, type Booked } from "./availability";
import { durationFor, findPromo, priceBreakdown } from "./pricing";
import {
  CUSTOMER_FIELD_LABELS,
  LOCATION_KINDS,
  SERVICE_MODES,
  flat,
  isValidTimezone,
  pricingFromText,
  publicRules,
  sanitizeBookingSettings,
  sanitizeFlow,
  sanitizeLocationConfig,
  sanitizePricing,
  sanitizeServiceConfig,
  sanitizeStaffConfig,
  slugId,
  text,
  type BookingFlow,
  type BookingRules,
  type BookingSelection,
  type BookingSettings,
  type Customer,
  type CustomerFieldKey,
  type DayAvailability,
  type LocationKind,
  type LocationRow,
  type PriceBreakdown,
  type Recurrence,
  type ServiceAddon,
  type ServiceMode,
  type ServiceRow,
  type ServiceVariant,
  type Slot,
  type StaffRow,
} from "./types";

/**
 * The booking store: Prisma reads and writes for services, staff, locations,
 * tenant-wide settings, and the booking transaction itself. Everything the
 * visitor-facing flow needs server-side lives here — lib/cards.ts and the
 * API routes under app/api/booking/ are thin callers of this module.
 *
 * Fail closed throughout: an unknown id, a disabled row, or booking being off
 * is a rejection with a reason, never a throw the caller has to guess at.
 */

// ── JSON helpers ─────────────────────────────────────────────────────────

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = numOrUndef(v);
  return n === undefined ? fallback : Math.min(max, Math.max(min, Math.round(n)));
}

// ── Row mappers: a Prisma row + its JSON config → the shape everything else reads ──

type ServiceDbRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  imageFilename: string | null;
  pricing: string;
  durationMinutes: number;
  config: string;
  order: number;
  enabled: boolean;
};

function toServiceRow(r: ServiceDbRow): ServiceRow {
  const config = sanitizeServiceConfig(safeJson(r.config));
  // The lead image is the uploaded file when there is one; failing that, an
  // https URL a tenant pasted into the gallery can stand in (isImageRef lets
  // both kinds through, so config.images[0] is already one or the other).
  const fallback = config.images[0] && /^https:\/\//i.test(config.images[0]) ? config.images[0] : null;
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    description: r.description,
    imageUrl: r.imageFilename ? `/api/uploads/${r.imageFilename}` : fallback,
    images: config.images,
    pricing: sanitizePricing(safeJson(r.pricing)),
    durationMinutes: r.durationMinutes,
    addons: config.addons,
    variants: config.variants,
    deposit: config.deposit,
    modes: config.modes,
    staffIds: config.staffIds,
    locationIds: config.locationIds,
    eligibility: config.eligibility,
    preparation: config.preparation,
    cancellationPolicy: config.cancellationPolicy,
    bufferBeforeMinutes: config.bufferBeforeMinutes,
    bufferAfterMinutes: config.bufferAfterMinutes,
    maxQuantity: config.maxQuantity,
    order: r.order,
    enabled: r.enabled,
  };
}

type StaffDbRow = {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoFilename: string | null;
  config: string;
  order: number;
  enabled: boolean;
};

function toStaffRow(r: StaffDbRow): StaffRow {
  const config = sanitizeStaffConfig(safeJson(r.config));
  return {
    id: r.id,
    name: r.name,
    role: r.role,
    bio: r.bio,
    photoUrl: r.photoFilename ? `/api/uploads/${r.photoFilename}` : null,
    specialties: config.specialties,
    languages: config.languages,
    credentials: config.credentials,
    genderLabel: config.genderLabel,
    hours: config.hours,
    timeOff: config.timeOff,
    priceOverrides: config.priceOverrides,
    durationOverrides: config.durationOverrides,
    order: r.order,
    enabled: r.enabled,
  };
}

type LocationDbRow = {
  id: string;
  name: string;
  kind: string;
  address: string;
  phone: string;
  timezone: string;
  config: string;
  order: number;
  enabled: boolean;
};

function toLocationRow(r: LocationDbRow): LocationRow {
  const config = sanitizeLocationConfig(safeJson(r.config));
  const kind = (LOCATION_KINDS as readonly string[]).includes(r.kind) ? (r.kind as LocationKind) : "business";
  return {
    id: r.id,
    name: r.name,
    kind,
    address: r.address,
    phone: r.phone,
    timezone: r.timezone,
    hours: config.hours,
    serviceArea: config.serviceArea,
    meetingLink: config.meetingLink,
    note: config.note,
    capacity: config.capacity,
    priceOverrides: config.priceOverrides,
    order: r.order,
    enabled: r.enabled,
  };
}

// ── Services ─────────────────────────────────────────────────────────────

export async function listServices(userId: string): Promise<ServiceRow[]> {
  const rows = await prisma.service.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return rows.map(toServiceRow);
}

export async function saveService(
  userId: string,
  input: Partial<ServiceRow> & { name: string; id?: string; imageFilename?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = flat(input.name, 200);
  if (!name) return { ok: false, error: "A service needs a name." };
  if (input.id) {
    // A partial update: what the caller left out keeps its stored value, so
    // renaming a service (or ticking who performs it) never wipes its menu.
    const existing = await prisma.service.findFirst({ where: { id: input.id, userId } });
    if (!existing) return { ok: false, error: "That service could not be found." };
    const stored = toServiceRow(existing);
    await prisma.service.update({
      where: { id: input.id },
      data: {
        name,
        category: input.category !== undefined ? flat(input.category, 60) : stored.category,
        description: input.description !== undefined ? text(input.description, 2000) : stored.description,
        pricing: JSON.stringify(sanitizePricing(input.pricing ?? stored.pricing)),
        durationMinutes: clampInt(input.durationMinutes ?? stored.durationMinutes, 5, 24 * 60, 60),
        config: JSON.stringify(sanitizeServiceConfig({ ...stored, ...input })),
        imageFilename: input.imageFilename !== undefined ? input.imageFilename : existing.imageFilename,
        enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      },
    });
    return { ok: true, id: input.id };
  }
  const data = {
    name,
    category: flat(input.category, 60),
    description: text(input.description, 2000),
    pricing: JSON.stringify(sanitizePricing(input.pricing)),
    durationMinutes: clampInt(input.durationMinutes, 5, 24 * 60, 60),
    config: JSON.stringify(sanitizeServiceConfig(input)),
  };
  const last = await prisma.service.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  const row = await prisma.service.create({
    data: { ...data, userId, imageFilename: input.imageFilename ?? null, order: (last?.order ?? -1) + 1, enabled: input.enabled ?? true },
  });
  return { ok: true, id: row.id };
}

export async function deleteService(userId: string, id: string): Promise<void> {
  await prisma.service.deleteMany({ where: { id, userId } });
}

export async function moveService(userId: string, id: string, dir: "up" | "down"): Promise<void> {
  const rows = await prisma.service.findMany({ where: { userId }, orderBy: { order: "asc" } });
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await prisma.$transaction([
    prisma.service.update({ where: { id: rows[i].id }, data: { order: rows[j].order } }),
    prisma.service.update({ where: { id: rows[j].id }, data: { order: rows[i].order } }),
  ]);
}

// ── Staff ────────────────────────────────────────────────────────────────

export async function listStaff(userId: string): Promise<StaffRow[]> {
  const rows = await prisma.staffMember.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return rows.map(toStaffRow);
}

export async function saveStaff(
  userId: string,
  input: Partial<StaffRow> & { name: string; id?: string; photoFilename?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = flat(input.name, 120);
  if (!name) return { ok: false, error: "A provider needs a name." };
  if (input.id) {
    // Partial update: what the caller left out keeps its stored value.
    const existing = await prisma.staffMember.findFirst({ where: { id: input.id, userId } });
    if (!existing) return { ok: false, error: "That provider could not be found." };
    const stored = toStaffRow(existing);
    await prisma.staffMember.update({
      where: { id: input.id },
      data: {
        name,
        role: input.role !== undefined ? flat(input.role, 80) : stored.role,
        bio: input.bio !== undefined ? text(input.bio, 2000) : stored.bio,
        config: JSON.stringify(sanitizeStaffConfig({ ...stored, ...input })),
        photoFilename: input.photoFilename !== undefined ? input.photoFilename : existing.photoFilename,
        enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      },
    });
    return { ok: true, id: input.id };
  }
  const data = {
    name,
    role: flat(input.role, 80),
    bio: text(input.bio, 2000),
    config: JSON.stringify(sanitizeStaffConfig(input)),
  };
  const last = await prisma.staffMember.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  const row = await prisma.staffMember.create({
    data: { ...data, userId, photoFilename: input.photoFilename ?? null, order: (last?.order ?? -1) + 1, enabled: input.enabled ?? true },
  });
  return { ok: true, id: row.id };
}

export async function deleteStaff(userId: string, id: string): Promise<void> {
  await prisma.staffMember.deleteMany({ where: { id, userId } });
}

export async function moveStaff(userId: string, id: string, dir: "up" | "down"): Promise<void> {
  const rows = await prisma.staffMember.findMany({ where: { userId }, orderBy: { order: "asc" } });
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await prisma.$transaction([
    prisma.staffMember.update({ where: { id: rows[i].id }, data: { order: rows[j].order } }),
    prisma.staffMember.update({ where: { id: rows[j].id }, data: { order: rows[i].order } }),
  ]);
}

// ── Locations ────────────────────────────────────────────────────────────

export async function listLocations(userId: string): Promise<LocationRow[]> {
  const rows = await prisma.bookingLocation.findMany({ where: { userId }, orderBy: { order: "asc" } });
  return rows.map(toLocationRow);
}

export async function saveLocation(
  userId: string,
  input: Partial<LocationRow> & { name: string; id?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const name = flat(input.name, 120);
  if (!name) return { ok: false, error: "A location needs a name." };
  const kindOf = (v: unknown, fallback: LocationKind): LocationKind =>
    (LOCATION_KINDS as readonly string[]).includes(String(v)) ? (v as LocationKind) : fallback;
  if (input.id) {
    // Partial update: what the caller left out keeps its stored value.
    const existing = await prisma.bookingLocation.findFirst({ where: { id: input.id, userId } });
    if (!existing) return { ok: false, error: "That location could not be found." };
    const stored = toLocationRow(existing);
    await prisma.bookingLocation.update({
      where: { id: input.id },
      data: {
        name,
        kind: input.kind !== undefined ? kindOf(input.kind, stored.kind) : stored.kind,
        address: input.address !== undefined ? flat(input.address, 300) : stored.address,
        phone: input.phone !== undefined ? flat(input.phone, 40) : stored.phone,
        timezone:
          input.timezone !== undefined ? (isValidTimezone(input.timezone) ? input.timezone : "") : stored.timezone,
        config: JSON.stringify(sanitizeLocationConfig({ ...stored, ...input })),
        enabled: input.enabled !== undefined ? input.enabled : existing.enabled,
      },
    });
    return { ok: true, id: input.id };
  }
  const data = {
    name,
    kind: kindOf(input.kind, "business"),
    address: flat(input.address, 300),
    phone: flat(input.phone, 40),
    timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : "",
    config: JSON.stringify(sanitizeLocationConfig(input)),
  };
  const last = await prisma.bookingLocation.findFirst({ where: { userId }, orderBy: { order: "desc" } });
  const row = await prisma.bookingLocation.create({
    data: { ...data, userId, order: (last?.order ?? -1) + 1, enabled: input.enabled ?? true },
  });
  return { ok: true, id: row.id };
}

export async function deleteLocation(userId: string, id: string): Promise<void> {
  await prisma.bookingLocation.deleteMany({ where: { id, userId } });
}

export async function moveLocation(userId: string, id: string, dir: "up" | "down"): Promise<void> {
  const rows = await prisma.bookingLocation.findMany({ where: { userId }, orderBy: { order: "asc" } });
  const i = rows.findIndex((r) => r.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  await prisma.$transaction([
    prisma.bookingLocation.update({ where: { id: rows[i].id }, data: { order: rows[j].order } }),
    prisma.bookingLocation.update({ where: { id: rows[j].id }, data: { order: rows[i].order } }),
  ]);
}

// ── Settings ─────────────────────────────────────────────────────────────

export async function getBookingSettings(userId: string): Promise<BookingSettings> {
  const row = await prisma.bookingSettings.findUnique({ where: { userId } });
  return sanitizeBookingSettings(row ? safeJson(row.config) : {});
}

/** Merges the patch over what's stored, then re-sanitizes the whole thing —
 *  a caller sending one changed field never wipes the rest of the settings. */
export async function saveBookingSettings(userId: string, patch: Partial<BookingSettings> | unknown): Promise<void> {
  const current = await getBookingSettings(userId);
  const merged = sanitizeBookingSettings({ ...current, ...(patch && typeof patch === "object" ? patch : {}) });
  await prisma.bookingSettings.upsert({
    where: { userId },
    update: { config: JSON.stringify(merged) },
    create: { userId, config: JSON.stringify(merged) },
  });
}

// ── The legacy bridge ────────────────────────────────────────────────────

/**
 * Services derived from the intake catalog's service picker, for a tenant
 * with no Service rows of its own. `getBookingConfig` already upgrades an old
 * generated text box into a priced multi_select menu (lib/appointments.ts),
 * so this just reads that menu's options as services — one legacy ServiceRow
 * each, an image matched from the gallery by caption word overlap.
 */
async function legacyServices(userId: string, settings: BookingSettings): Promise<ServiceRow[]> {
  const { fields } = await getBookingConfig(userId);
  const picker = fields.find(
    (f) => f.key === SERVICE_PICKER_KEY && (f.config.options?.length ?? 0) > 0,
  );
  if (!picker) return [];
  const photos = await prisma.photo.findMany({
    where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
    select: { filename: true, caption: true, description: true },
  });
  const gallery: GalleryPhoto[] = photos.map((p) => ({
    src: `/api/uploads/${p.filename}`,
    text: [p.caption, p.description].filter(Boolean).join(" "),
  }));
  const seen = new Set<string>();
  return (picker.config.options ?? []).map((opt, i) => {
    let id = `legacy:${slugId(opt.label)}`;
    while (seen.has(id)) id = `legacy:${slugId(opt.label)}-${i}`;
    seen.add(id);
    return {
      id,
      name: opt.label,
      category: opt.group ?? "",
      description: opt.description ?? "",
      imageUrl: bestImageFor(opt.label, gallery),
      images: [],
      pricing: pricingFromText(opt.price ?? ""),
      durationMinutes: parseDurationMinutes(opt.duration) ?? settings.defaultDurationMinutes,
      addons: [],
      variants: [],
      deposit: { kind: "none" },
      modes: [],
      staffIds: [],
      locationIds: [],
      eligibility: "",
      preparation: "",
      cancellationPolicy: "",
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      order: i,
      enabled: true,
    };
  });
}

/** The services a booking may pick from: real rows when there are any
 *  (enabled only — a disabled service is not offered), else the legacy
 *  bridge's derived list. Shared by getBookingFlow and everything that
 *  resolves a selection, so both sides always agree on what "the service
 *  catalog" is. */
async function resolveServices(userId: string, settings: BookingSettings): Promise<ServiceRow[]> {
  const rows = await listServices(userId);
  if (rows.length) return rows.filter((r) => r.enabled);
  // A tenant from before the Service table: write real rows once from what
  // they already have, so the admin can edit them and photos can attach.
  if (await materializeServices(userId, settings)) {
    return (await listServices(userId)).filter((r) => r.enabled);
  }
  return legacyServices(userId, settings);
}

/** A row of the tenant's gallery: what a caption says, and the file it names. */
async function galleryPhotos(userId: string): Promise<(GalleryPhoto & { filename: string })[]> {
  const photos = await prisma.photo.findMany({
    where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
    select: { filename: true, caption: true, description: true },
  });
  return photos.map((p) => ({
    filename: p.filename,
    src: `/api/uploads/${p.filename}`,
    text: [p.caption, p.description].filter(Boolean).join(" "),
  }));
}

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * What a tenant onboarded before the Service table already knows about its
 * services, merged by name from three places: the structured menu items the
 * services extractor now writes (price, category, description, a matched
 * image on the site), the intake catalog's service picker (price and duration
 * as text), and the services knowledge record (prices and durations read out
 * of each description). Nothing is invented: a service with no stated price
 * is "varies" until the owner types one or refreshes from the site.
 */
async function knownServices(
  userId: string,
): Promise<{ name: string; category: string; description: string; price: string; duration: string; image: string }[]> {
  const byName = new Map<string, { name: string; category: string; description: string; price: string; duration: string; image: string }>();
  const take = (name: string, patch: Partial<{ category: string; description: string; price: string; duration: string; image: string }>) => {
    const key = nameKey(name);
    if (!key) return;
    const cur = byName.get(key) ?? { name: name.trim(), category: "", description: "", price: "", duration: "", image: "" };
    for (const [k, v] of Object.entries(patch) as [keyof typeof patch, string | undefined][]) {
      if (v && !cur[k]) cur[k] = v;
    }
    byName.set(key, cur);
  };

  const menuRows = await prisma.menuItem.findMany({ where: { userId }, orderBy: { order: "asc" } });
  for (const r of menuRows) {
    let item: MenuItemData | null = null;
    try {
      item = sanitizeMenuItem({ ...JSON.parse(r.data), key: r.key, name: r.name, category: r.category });
    } catch {
      item = sanitizeMenuItem({ key: r.key, name: r.name, category: r.category });
    }
    if (!item) continue;
    take(item.name, {
      category: item.category,
      description: item.shortDescription || item.fullDescription,
      price: item.salePrice || item.price,
      duration: item.estimatedTime,
      image: /^https:\/\/\S+$/i.test(item.image) ? item.image : "",
    });
  }

  const { fields } = await getBookingConfig(userId);
  const picker = fields.find((f) => f.key === SERVICE_PICKER_KEY && (f.config.options?.length ?? 0) > 0);
  for (const o of picker?.config.options ?? []) {
    take(o.label, { category: o.group, description: o.description, price: o.price, duration: o.duration });
  }

  const source = await prisma.source.findFirst({
    where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    orderBy: { updatedAt: "desc" },
    select: { rawText: true },
  });
  for (const o of serviceOptions(parseServiceCatalog(source?.rawText))) {
    take(o.label, { category: o.group, description: o.description, price: o.price, duration: o.duration });
  }
  return [...byName.values()];
}

/**
 * Write Service rows for a tenant who has none, from what is already on file.
 * Once: after this the rows are the owner's. True when anything was written;
 * false (never a throw) leaves the read-time bridge to carry on.
 */
async function materializeServices(userId: string, settings: BookingSettings): Promise<boolean> {
  try {
    const known = await knownServices(userId);
    if (!known.length) return false;
    const gallery = await galleryPhotos(userId);
    let written = 0;
    for (const k of known) {
      const fromGallery = k.image ? null : bestImageFor(k.name, gallery);
      const photo = fromGallery ? gallery.find((g) => g.src === fromGallery) : null;
      const saved = await saveService(userId, {
        name: k.name,
        category: k.category,
        description: k.description,
        pricing: pricingFromText(k.price),
        durationMinutes: parseDurationMinutes(k.duration) ?? settings.defaultDurationMinutes,
        images: k.image ? [k.image] : [],
        imageFilename: photo?.filename ?? null,
      });
      if (saved.ok) written++;
    }
    return written > 0;
  } catch {
    return false;
  }
}

/** Folds a legacy name/email/phone question's `required` onto the matching
 *  customer field, so a tenant who required a phone number in the old wizard
 *  doesn't silently stop requiring it once the new flow reads settings instead. */
function foldLegacyRequired(rules: BookingRules, fields: AppointmentFieldRow[]): BookingRules {
  const required = new Map<CustomerFieldKey, boolean>();
  for (const f of fields) {
    if (f.key === "name") required.set("firstName", f.required);
    else if (f.key === "email") required.set("email", f.required);
    else if (f.key === "phone") required.set("phone", f.required);
  }
  if (!required.size) return rules;
  return {
    ...rules,
    customerFields: rules.customerFields.map((cf) => (required.get(cf.key) ? { ...cf, required: true } : cf)),
  };
}

/** The catalog minus the keys the flow now asks elsewhere: name/email/phone
 *  (the customer step) and the legacy service picker once a real service
 *  step exists to replace it. */
function trimIntake(fields: AppointmentFieldRow[], hasServiceStep: boolean): AppointmentFieldRow[] {
  return fields.filter((f) => {
    if (f.key === "name" || f.key === "email" || f.key === "phone") return false;
    if (f.key === SERVICE_PICKER_KEY && hasServiceStep) return false;
    return true;
  });
}

/** The block the card is handed. Null when booking is off. */
export async function getBookingFlow(
  userId: string,
  opts: { preselectServiceId?: string | null } = {},
): Promise<{ flow: BookingFlow; intake: AppointmentFieldRow[]; fields: AppointmentFieldRow[] } | null> {
  const profile = await getProfile(userId);
  if (!profile.bookingEnabled) return null;

  const settings = await getBookingSettings(userId);
  const [services, staffRows, locationRows, { fields }] = await Promise.all([
    resolveServices(userId, settings),
    listStaff(userId),
    listLocations(userId),
    getBookingConfig(userId),
  ]);
  const staff = staffRows.filter((s) => s.enabled);
  const locations = locationRows.filter((l) => l.enabled);
  const categories = [...new Set(services.map((s) => s.category).filter(Boolean))];
  const rules: BookingRules = {
    ...foldLegacyRequired(publicRules(settings), fields),
    // The business's own step order, resolved against its form.
    flow: sanitizeFlow(settings.flow, fields),
  };

  const wanted = opts.preselectServiceId ?? null;
  const preselect = { serviceId: wanted && services.some((s) => s.id === wanted) ? wanted : null };

  return {
    flow: {
      business: {
        name: profile.company_name || profile.owner_name || "",
        timezone: settings.timezone,
        currency: settings.currency,
        phone: profile.company_phone_number.trim(),
      },
      services,
      categories,
      staff,
      locations,
      rules,
      preselect,
    },
    intake: trimIntake(fields, services.length > 0),
    /** Every field, role-tagged and screen-grouped — what the flow-driven card asks. */
    fields,
  };
}

// ── Resolving a selection against the live catalog ──────────────────────

type SelectionCore = Pick<BookingSelection, "serviceId" | "variantId" | "addonIds" | "staffId" | "locationId" | "mode" | "postalCode">;

type Resolved = {
  service: ServiceRow | null;
  variant: ServiceVariant | null;
  addons: ServiceAddon[];
  location: LocationRow | null;
  mode: ServiceMode;
  /** Everyone eligible for the service (or every enabled provider, when the
   *  service doesn't restrict), for assignment when no staffId was given. */
  staffPool: StaffRow[];
  /** Set only when the visitor named a provider. */
  chosenStaff: StaffRow | null;
};

type ResolveResult = ({ ok: true } & Resolved) | { ok: false; error: string };

/** Turns raw ids into real rows, rejecting anything unknown, disabled, or
 *  not actually offered for this combination — never trusts what the client sent. */
async function resolveSelection(userId: string, settings: BookingSettings, sel: SelectionCore): Promise<ResolveResult> {
  const [services, staffAll, locations] = await Promise.all([
    resolveServices(userId, settings),
    listStaff(userId).then((rows) => rows.filter((r) => r.enabled)),
    listLocations(userId).then((rows) => rows.filter((r) => r.enabled)),
  ]);

  let service: ServiceRow | null = null;
  if (sel.serviceId) {
    service = services.find((s) => s.id === sel.serviceId) ?? null;
    if (!service) return { ok: false, error: "That service isn't available." };
  }

  let variant: ServiceVariant | null = null;
  if (sel.variantId) {
    variant = service?.variants.find((v) => v.id === sel.variantId) ?? null;
    if (!variant) return { ok: false, error: "That option isn't available." };
  }

  const addons: ServiceAddon[] = [];
  for (const id of sel.addonIds) {
    const found = service?.addons.find((a) => a.id === id);
    if (!found) return { ok: false, error: "That add-on isn't available." };
    addons.push(found);
  }

  const allowedModes = service ? (service.modes.length ? service.modes : (["in_person"] as ServiceMode[])) : [...SERVICE_MODES];
  if (!allowedModes.includes(sel.mode)) return { ok: false, error: "That appointment type isn't available for this service." };

  let location: LocationRow | null = null;
  if (sel.locationId) {
    location = locations.find((l) => l.id === sel.locationId) ?? null;
    if (!location) return { ok: false, error: "That location isn't available." };
    if (service && service.locationIds.length && !service.locationIds.includes(location.id)) {
      return { ok: false, error: "That service isn't offered at this location." };
    }
    if (location.kind === "mobile" && location.serviceArea.postalCodes.length) {
      if (!sel.postalCode || !location.serviceArea.postalCodes.includes(sel.postalCode)) {
        return { ok: false, error: "That address is outside our service area." };
      }
    }
  }

  let staffPool = staffAll;
  if (service && service.staffIds.length) staffPool = staffPool.filter((s) => service!.staffIds.includes(s.id));
  let chosenStaff: StaffRow | null = null;
  if (sel.staffId) {
    chosenStaff = staffPool.find((s) => s.id === sel.staffId) ?? null;
    if (!chosenStaff) return { ok: false, error: "That provider isn't available for this service." };
  }

  return { ok: true, service, variant, addons, location, mode: sel.mode, staffPool, chosenStaff };
}

// ── Quote ────────────────────────────────────────────────────────────────

export async function quoteBooking(
  userId: string,
  selection: BookingSelection,
): Promise<{ ok: true; breakdown: PriceBreakdown } | { ok: false; error: string }> {
  const settings = await getBookingSettings(userId);
  const resolved = await resolveSelection(userId, settings, selection);
  if (!resolved.ok) return resolved;
  const { service, variant, addons, location, mode, chosenStaff } = resolved;

  const today = ymd(new Date(), settings.timezone);
  const promo = selection.promoCode ? findPromo(settings, selection.promoCode, service?.id ?? null, today) : null;
  const membership = selection.membershipId ? (settings.memberships.find((m) => m.id === selection.membershipId) ?? null) : null;

  const breakdown = priceBreakdown({
    service,
    variant,
    addons,
    quantity: selection.quantity,
    staff: chosenStaff,
    location,
    mode,
    settings,
    promo,
    membership,
    tipPercent: selection.tipPercent,
    tipAmount: selection.tipAmount,
  });
  return { ok: true, breakdown };
}

// ── Availability ─────────────────────────────────────────────────────────

/** Confirmed bookings overlapping [start, end) — widened a day earlier so a
 *  booking that started before the window but runs into it isn't missed. */
async function bookedInRange(userId: string, start: Date, end: Date): Promise<Booked[]> {
  const rows = await prisma.appointment.findMany({
    where: { userId, status: "confirmed", startsAt: { lt: end, gte: addMinutes(start, -24 * 60) } },
    select: { startsAt: true, endsAt: true, staffId: true, locationId: true, status: true },
  });
  return rows
    .map((r) => ({ startsAt: r.startsAt, endsAt: r.endsAt ?? r.startsAt, staffId: r.staffId, locationId: r.locationId, status: r.status }))
    .filter((b) => b.endsAt > start);
}

function monthBounds(month: string): [string, string] {
  const [y, m] = month.split("-").map((s) => Number.parseInt(s, 10));
  const first = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [first, next];
}

export type AvailabilityQuery = {
  serviceId?: string | null;
  variantId?: string | null;
  addonIds?: string[];
  staffId?: string | null;
  locationId?: string | null;
  month?: string;
  date?: string;
};

/** When the business (or the location) opens on a date, or null when closed. */
function openingInstant(settings: BookingSettings, location: LocationRow | null, date: string): Date | null {
  if (settings.holidays.some((h) => h.date === date)) return null;
  const tz = location?.timezone || settings.timezone;
  const hours = location?.hours ?? settings.hours;
  const weekday = zonedParts(zonedToUtc(date, "12:00", tz), tz).weekday;
  const first = hours[weekday]?.[0];
  return first ? zonedToUtc(date, first.start, tz) : null;
}

export async function availability(
  userId: string,
  q: AvailabilityQuery,
): Promise<{
  timezone: string;
  days?: DayAvailability[];
  slots?: Slot[];
  earliest: Slot | null;
  full?: boolean;
  dayStart?: string | null;
}> {
  const settings = await getBookingSettings(userId);
  const resolved = await resolveSelection(userId, settings, {
    serviceId: q.serviceId ?? null,
    variantId: q.variantId ?? null,
    addonIds: q.addonIds ?? [],
    staffId: q.staffId ?? null,
    locationId: q.locationId ?? null,
    mode: "in_person",
    postalCode: "",
  });
  // Fail closed: an unknown id draws nothing bookable rather than throwing.
  if (!resolved.ok) {
    return { timezone: settings.timezone, days: q.month ? [] : undefined, slots: q.date ? [] : undefined, earliest: null, full: q.date ? true : undefined };
  }
  const { service, variant, addons, location, chosenStaff, staffPool } = resolved;
  const durationMinutes = durationFor({ service, variant, addons, staff: chosenStaff, settings });
  const staff = chosenStaff ? [chosenStaff] : staffPool;
  const now = new Date();

  if (q.month) {
    const [first, next] = monthBounds(q.month);
    const start = zonedToUtc(first, "00:00", settings.timezone);
    const end = zonedToUtc(next, "00:00", settings.timezone);
    const booked = await bookedInRange(userId, start, end);
    const input: AvailabilityInput = { settings, service, durationMinutes, staff, location, booked, now };
    return { timezone: settings.timezone, days: availableDays(input, q.month), earliest: earliestSlot(input) };
  }
  if (q.date) {
    const start = zonedToUtc(q.date, "00:00", settings.timezone);
    const end = zonedToUtc(shiftDays(q.date, 1), "00:00", settings.timezone);
    const booked = await bookedInRange(userId, start, end);
    const input: AvailabilityInput = { settings, service, durationMinutes, staff, location, booked, now };
    const slots = availableSlots(input, q.date);
    // A day with hours but no slot is "full" (waitlist-eligible); a closed day
    // or holiday is not. dayStart is the day's opening instant, which is what
    // a waitlist entry for that day is filed under.
    const dayStart = openingInstant(settings, location, q.date);
    return {
      timezone: settings.timezone,
      slots,
      full: slots.length === 0 && dayStart !== null,
      dayStart: dayStart?.toISOString() ?? null,
      earliest: earliestSlot(input),
    };
  }
  // Neither month nor date: just the next open slot, scanning the whole
  // advance window the way earliestSlot itself does.
  const end = zonedToUtc(shiftDays(ymd(now, settings.timezone), settings.maxAdvanceDays + 1), "00:00", settings.timezone);
  const booked = await bookedInRange(userId, now, end);
  const input: AvailabilityInput = { settings, service, durationMinutes, staff, location, booked, now };
  return { timezone: settings.timezone, earliest: earliestSlot(input) };
}

// ── Booking ──────────────────────────────────────────────────────────────

/** Thrown inside the transaction to force a rollback — a partial recurrence
 *  is never left half-booked. */
class BookingRejected extends Error {
  full?: boolean;
  constructor(message: string, full?: boolean) {
    super(message);
    this.full = full;
  }
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

/** Every date an occurrence of `rec` falls on, starting at `start`, in the
 *  business zone (monthly keeps the same wall-clock day and time next month). */
function recurrenceDates(start: Date, rec: Recurrence | null, tz: string): Date[] {
  if (!rec) return [start];
  const out: Date[] = [start];
  for (let i = 1; i < rec.count; i++) {
    const prev = out[i - 1];
    if (rec.frequency === "weekly") out.push(addMinutes(prev, 7 * 24 * 60));
    else if (rec.frequency === "biweekly") out.push(addMinutes(prev, 14 * 24 * 60));
    else {
      const p = zonedParts(prev, tz);
      const nextMonth = p.m === 12 ? 1 : p.m + 1;
      const nextYear = p.m === 12 ? p.y + 1 : p.y;
      const date = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
      const time = `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
      out.push(zonedToUtc(date, time, tz));
    }
  }
  return out;
}

/** required present, email shaped like an email, phone has enough digits. */
function validateCustomer(customer: Customer, fields: BookingSettings["customerFields"]): string | null {
  for (const cf of fields) {
    if (!cf.enabled) continue;
    const v = (customer[cf.key] ?? "").trim();
    const label = cf.label || CUSTOMER_FIELD_LABELS[cf.key];
    if (cf.required && !v) return `${label} is required.`;
    if (!v) continue;
    if (cf.key === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return "That email doesn't look right.";
    if (cf.key === "phone" && (v.match(/\d/g)?.length ?? 0) < 7) return "That phone number doesn't look right.";
  }
  return null;
}

type OccurrenceRow = { id: string; status: "confirmed" | "waitlisted"; startsAt: Date; endsAt: Date; staffName: string };

export async function createBooking(
  userId: string,
  selection: BookingSelection,
): Promise<
  | {
      ok: true;
      id: string;
      status: "confirmed" | "waitlisted";
      startsAt: string;
      endsAt: string;
      breakdown: PriceBreakdown;
      staffName: string;
      locationName: string;
      serviceName: string;
      ids: string[];
    }
  | { ok: false; error: string; full?: boolean }
> {
  const profile = await getProfile(userId);
  if (!profile.bookingEnabled) return { ok: false, error: "Booking isn't available right now." };

  const startsAt = new Date(selection.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "That date doesn't look right." };
  if (startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a time in the future." };

  const settings = await getBookingSettings(userId);
  const resolved = await resolveSelection(userId, settings, selection);
  if (!resolved.ok) return resolved;
  const { service, variant, addons, location, mode, chosenStaff, staffPool } = resolved;

  const customerErr = validateCustomer(selection.customer, settings.customerFields);
  if (customerErr) return { ok: false, error: customerErr };
  const customer: Customer = { ...selection.customer };
  if (customer.smsConsent) customer.smsConsent = /^(yes|true|on|1)$/i.test(customer.smsConsent) ? "yes" : "no";

  // Intake: every catalog question the flow doesn't ask elsewhere. The
  // legacy service picker is the one exception — when the chosen service came
  // from it, the visitor's pick is fed back in so it still validates and the
  // old Calendar readers (which key off answers.service) keep working.
  const { fields } = await getBookingConfig(userId);
  const picker = fields.find((f) => f.key === SERVICE_PICKER_KEY);
  // The pick is written back only when the picker will accept it — its own
  // option, or "something else" allowed — so a menu the owner has since
  // edited can never turn a valid booking into a validation error.
  const pickerTakes =
    !!picker && !!service &&
    (picker.config.allowOther === true ||
      (picker.config.options ?? []).some((o) => o.label.toLowerCase() === service.name.toLowerCase()));
  const rawAnswers: Record<string, unknown> = { ...selection.answers };
  if (pickerTakes && service) rawAnswers[SERVICE_PICKER_KEY] = [service.name];

  const answers: Record<string, string> = {};
  for (const f of fields) {
    if (f.key === "name" || f.key === "email" || f.key === "phone") continue;
    if (f.key === SERVICE_PICKER_KEY && service && !pickerTakes) continue; // asked in the new Service step instead
    if (!isFieldShown(f, rawAnswers, fields.map((x) => x.key))) continue;
    const resolvedAns = resolveAnswer(f, rawAnswers[f.key]);
    if (!resolvedAns.ok) return { ok: false, error: resolvedAns.error };
    if (f.required && !resolvedAns.value) return { ok: false, error: `"${f.label}" is required.` };
    if (resolvedAns.value) answers[f.key] = resolvedAns.value;
  }

  const durationMinutes = durationFor({ service, variant, addons, staff: chosenStaff, settings, quantity: selection.quantity });
  const today = ymd(new Date(), settings.timezone);
  const promo = selection.promoCode ? findPromo(settings, selection.promoCode, service?.id ?? null, today) : null;
  const membership = selection.membershipId ? (settings.memberships.find((m) => m.id === selection.membershipId) ?? null) : null;
  const breakdown = priceBreakdown({
    service, variant, addons, quantity: selection.quantity, staff: chosenStaff, location, mode,
    settings, promo, membership, tipPercent: selection.tipPercent, tipAmount: selection.tipAmount,
  });

  const groupId = selection.recurrence ? randomUUID() : null;
  const dates = recurrenceDates(startsAt, selection.recurrence, settings.timezone);

  try {
    const rows = await prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
      // $queryRaw's row deserializer can't handle.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;

      const windowStart = new Date(Math.min(...dates.map((d) => d.getTime())));
      const windowEnd = addMinutes(new Date(Math.max(...dates.map((d) => d.getTime()))), durationMinutes + 1);
      const existing = await tx.appointment.findMany({
        where: { userId, status: "confirmed", startsAt: { lt: windowEnd, gte: addMinutes(windowStart, -24 * 60) } },
        select: { startsAt: true, endsAt: true, staffId: true, locationId: true, status: true },
      });
      const booked: Booked[] = existing.map((r) => ({
        startsAt: r.startsAt, endsAt: r.endsAt ?? r.startsAt, staffId: r.staffId, locationId: r.locationId, status: r.status,
      }));

      const out: OccurrenceRow[] = [];
      for (let i = 0; i < dates.length; i++) {
        const occStart = dates[i];
        const input: AvailabilityInput = {
          settings, service, durationMinutes, staff: chosenStaff ? [chosenStaff] : staffPool, location, booked, now: new Date(),
        };
        const check = checkSlot(input, occStart);
        let status: "confirmed" | "waitlisted";
        let staffId: string | null;
        let occEnd: Date;
        if (check.ok) {
          status = "confirmed";
          staffId = check.staffId;
          occEnd = check.endsAt;
        } else if (check.full && selection.waitlist && settings.waitlist) {
          status = "waitlisted";
          staffId = chosenStaff?.id ?? null;
          occEnd = addMinutes(occStart, durationMinutes);
        } else {
          throw new BookingRejected(
            i === 0 ? check.reason : `Sorry, the ${ordinal(i + 1)} occurrence isn't available.`,
            check.full,
          );
        }
        const staffName = staffId ? (staffPool.find((s) => s.id === staffId)?.name ?? chosenStaff?.name ?? "") : "";
        const row = await tx.appointment.create({
          data: {
            userId,
            startsAt: occStart,
            endsAt: occEnd,
            durationMinutes,
            status,
            // A virtual (bridge) service has no row to point at.
            serviceId: service && !service.id.startsWith("legacy:") ? service.id : null,
            serviceName: service?.name ?? "",
            variantName: variant?.name ?? "",
            addons: JSON.stringify(addons.map((a) => a.name)),
            staffId,
            staffName,
            locationId: location?.id ?? null,
            locationName: location?.name ?? "",
            mode,
            customer: JSON.stringify(customer),
            pricing: JSON.stringify(breakdown),
            recurrence: selection.recurrence
              ? JSON.stringify({ frequency: selection.recurrence.frequency, count: selection.recurrence.count, index: i, groupId })
              : "",
            answers: JSON.stringify(answers),
          },
        });
        if (status === "confirmed") booked.push({ startsAt: occStart, endsAt: occEnd, staffId, locationId: location?.id ?? null, status: "confirmed" });
        out.push({ id: row.id, status: status as "confirmed" | "waitlisted", startsAt: occStart, endsAt: occEnd, staffName });
      }
      return out;
    });

    for (const r of rows) {
      if (r.status === "confirmed") await indexAppointment(userId, r.id).catch(() => {});
    }
    const first = rows[0];
    return {
      ok: true,
      id: first.id,
      status: first.status,
      startsAt: first.startsAt.toISOString(),
      endsAt: first.endsAt.toISOString(),
      breakdown,
      staffName: first.staffName,
      locationName: location?.name ?? "",
      serviceName: service?.name ?? "",
      ids: rows.map((r) => r.id),
    };
  } catch (e) {
    if (e instanceof BookingRejected) return { ok: false, error: e.message, ...(e.full ? { full: true } : {}) };
    throw e;
  }
}

// ── Listing and status ──────────────────────────────────────────────────

export type AppointmentDetail = {
  id: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  serviceName: string;
  variantName: string;
  addons: string[];
  staffName: string;
  locationName: string;
  mode: string;
  customer: Customer;
  pricing: PriceBreakdown | null;
  answers: Record<string, string>;
  createdAt: string;
  recurrence: string;
};

function safeCustomer(raw: string): Customer {
  const v = safeJson(raw);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Customer) : {};
}

function safeStringArray(raw: string): string[] {
  const v = safeJson(raw);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function safePricing(raw: string): PriceBreakdown | null {
  const v = safeJson(raw);
  return v && typeof v === "object" && Array.isArray((v as { lines?: unknown }).lines) ? (v as PriceBreakdown) : null;
}

/** Everything booked or waitlisted; a cancelled appointment leaves the calendar. */
export async function listBookings(userId: string): Promise<AppointmentDetail[]> {
  const rows = await prisma.appointment.findMany({
    where: { userId, status: { not: "cancelled" } },
    orderBy: { startsAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt.toISOString(),
    endsAt: (r.endsAt ?? r.startsAt).toISOString(),
    durationMinutes: r.durationMinutes,
    status: r.status,
    serviceName: r.serviceName,
    variantName: r.variantName,
    addons: safeStringArray(r.addons),
    staffName: r.staffName,
    locationName: r.locationName,
    mode: r.mode,
    customer: safeCustomer(r.customer),
    pricing: safePricing(r.pricing),
    answers: safeAnswers(r.answers),
    createdAt: r.createdAt.toISOString(),
    recurrence: r.recurrence,
  }));
}

export async function setBookingStatus(userId: string, id: string, status: "confirmed" | "cancelled"): Promise<void> {
  const row = await prisma.appointment.findFirst({ where: { id, userId } });
  if (!row) return;
  await prisma.appointment.update({ where: { id }, data: { status } });
  if (status === "cancelled") await dropOrigin(userId, "appointment", id).catch(() => {});
  else await indexAppointment(userId, id).catch(() => {});
}

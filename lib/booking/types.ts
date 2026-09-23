/**
 * The booking flow's shapes and pure rules, with no imports.
 *
 * Everything the visitor-facing card, the server that validates a booking,
 * the admin editors and the onboarding seeder must agree on lives here: what
 * a service is, how a price is written, what a provider and a location carry,
 * the tenant's booking rules, and what a submitted booking looks like. Import-
 * free so the client bundle can reach it without dragging Prisma or the model
 * SDK along (the lib/appointmentTypes.ts precedent).
 *
 * Money is a number in the currency's major unit (45 = $45.00). Times cross
 * layers only as ISO-8601 instants; wall-clock strings ("09:00") appear only
 * inside WeeklyHours, always in the business's own timezone.
 */

// ── Pricing ────────────────────────────────────────────────────────────────

export const PRICING_KINDS = [
  "free",
  "fixed",
  "starting_at",
  "range",
  "hourly",
  "per_person",
  "per_unit",
  "quote",
  "variable",
] as const;
export type PricingKind = (typeof PRICING_KINDS)[number];

export type Pricing = {
  kind: PricingKind;
  /** The amount (fixed, starting_at, hourly, per_person, per_unit) or the low end of a range. */
  amount?: number;
  /** High end of a range. */
  maxAmount?: number;
  /** per_unit only: what one unit is called ("room", "window", "pet"). */
  unitLabel?: string;
  /** The business's own words when a number can't say it ("call for a quote", "varies by length"). */
  note?: string;
};

export type ServiceAddon = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  durationMinutes?: number;
};

export type ServiceVariant = {
  id: string;
  name: string;
  description?: string;
  /** Replaces the service's pricing when set. */
  pricing?: Pricing;
  /** Replaces the service's duration when set. */
  durationMinutes?: number;
};

export const SERVICE_MODES = ["in_person", "online", "mobile"] as const;
/** in_person: at a business location. online: virtual. mobile: at the customer's address. */
export type ServiceMode = (typeof SERVICE_MODES)[number];

export type Deposit = { kind: "none" | "fixed" | "percent"; amount?: number };

export type ServiceRow = {
  id: string;
  name: string;
  category: string;
  description: string;
  /** Site-relative (/api/uploads/…) or absolute URL; null draws a placeholder. */
  imageUrl: string | null;
  /** Further images, same shape as imageUrl. */
  images: string[];
  pricing: Pricing;
  durationMinutes: number;
  addons: ServiceAddon[];
  variants: ServiceVariant[];
  deposit: Deposit;
  /** Where the service can happen; empty means in_person. */
  modes: ServiceMode[];
  /** Providers who perform it; empty means anyone on the team. */
  staffIds: string[];
  /** Locations that offer it; empty means every location. */
  locationIds: string[];
  eligibility: string;
  preparation: string;
  /** Overrides the tenant-wide policy when set. */
  cancellationPolicy: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** per_person pricing: the largest party bookable. */
  maxQuantity?: number;
  order: number;
  enabled: boolean;
};

// ── Hours ──────────────────────────────────────────────────────────────────

export const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayKey = (typeof DAY_KEYS)[number];
/** "HH:MM" 24h. */
export type HoursRange = { start: string; end: string };
/** Empty array = closed that day. */
export type WeeklyHours = Record<DayKey, HoursRange[]>;

export type Holiday = { date: string; label?: string };
/** Half-open [start, end) instants, ISO-8601. */
export type TimeOff = { start: string; end: string; label?: string };

// ── Providers ──────────────────────────────────────────────────────────────

export type StaffRow = {
  id: string;
  name: string;
  role: string;
  bio: string;
  photoUrl: string | null;
  specialties: string[];
  languages: string[];
  credentials: string[];
  /** Shown only when the tenant turned gender preference on; free text ("Female", "Male", "Non-binary"). */
  genderLabel: string;
  /** Null = the business hours. */
  hours: WeeklyHours | null;
  timeOff: TimeOff[];
  /** serviceId → this provider's price for it (fixed). */
  priceOverrides: Record<string, number>;
  /** serviceId → this provider's duration for it. */
  durationOverrides: Record<string, number>;
  order: number;
  enabled: boolean;
};

// ── Locations ──────────────────────────────────────────────────────────────

export const LOCATION_KINDS = ["business", "virtual", "mobile"] as const;
/** business: a branch. virtual: online. mobile: we come to you (a service area). */
export type LocationKind = (typeof LOCATION_KINDS)[number];

export type ServiceArea = {
  /** Postal codes served, exact match after trimming/uppercasing. */
  postalCodes: string[];
  /** Travel radius in miles from the location's address. */
  radiusMiles?: number;
  travelFee?: number;
  /** Flat text for the visitor: "Within 20 miles of downtown". */
  description?: string;
};

export type LocationRow = {
  id: string;
  name: string;
  kind: LocationKind;
  address: string;
  phone: string;
  /** IANA zone; empty = the business's. */
  timezone: string;
  /** Null = the business hours. */
  hours: WeeklyHours | null;
  serviceArea: ServiceArea;
  /** virtual: the standing meeting link, if any. */
  meetingLink: string;
  note: string;
  /**
   * How many bookings may overlap here when no providers are tracked (chairs,
   * bays, rooms — the resource); 1 is a single room. With providers, each
   * provider is the resource and this is ignored.
   */
  capacity: number;
  /** serviceId → this location's price for it (fixed); a provider's own price wins over it. */
  priceOverrides: Record<string, number>;
  order: number;
  enabled: boolean;
};

// ── Customer information ───────────────────────────────────────────────────

export const CUSTOMER_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "smsConsent",
  "address",
  "company",
  "birthday",
  "preferredContact",
  "customerStatus",
  "referralSource",
  "notes",
] as const;
export type CustomerFieldKey = (typeof CUSTOMER_FIELD_KEYS)[number];
/** The universal core: always asked. */
export const CORE_CUSTOMER_KEYS: readonly CustomerFieldKey[] = ["firstName", "lastName", "email", "phone", "smsConsent"];

export type CustomerFieldConfig = {
  key: CustomerFieldKey;
  enabled: boolean;
  required: boolean;
  /** Tenant's wording; empty = the default label. */
  label: string;
};

export const CUSTOMER_FIELD_LABELS: Record<CustomerFieldKey, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  smsConsent: "Text me appointment reminders",
  address: "Address",
  company: "Company",
  birthday: "Birthday",
  preferredContact: "Preferred contact method",
  customerStatus: "Have you visited us before?",
  referralSource: "How did you hear about us?",
  notes: "Anything else we should know?",
};

/** What a visitor filled in; smsConsent is "yes" | "no". */
export type Customer = Partial<Record<CustomerFieldKey, string>>;

// ── Tenant-wide rules ──────────────────────────────────────────────────────

export type PromoCode = {
  code: string;
  kind: "percent" | "fixed";
  amount: number;
  /** Empty = every service. */
  serviceIds: string[];
  /** "YYYY-MM-DD"; empty = never. */
  expiresOn: string;
  note: string;
};

export type Membership = { id: string; name: string; discountPercent: number };

export type ServiceFee = { kind: "none" | "fixed" | "percent"; amount?: number; label?: string };

export type BookingSettings = {
  /** IANA zone the business keeps its hours in. */
  timezone: string;
  /** ISO 4217. */
  currency: string;
  hours: WeeklyHours;
  holidays: Holiday[];
  slotIntervalMinutes: number;
  /** Minimum notice before a slot. */
  leadTimeMinutes: number;
  /** After this wall-clock time no slot for the following day may be booked; empty = no cutoff. */
  dailyCutoff: string;
  sameDayBooking: boolean;
  maxAdvanceDays: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  /** Fallback appointment length when a booking names no service. */
  defaultDurationMinutes: number;
  waitlist: boolean;
  recurring: boolean;
  /** hidden: never asked. optional: "Anyone available" first. required: must pick a person. */
  staffSelection: "hidden" | "optional" | "required";
  genderPreference: boolean;
  customerFields: CustomerFieldConfig[];
  /** Percent. */
  taxRate: number;
  taxLabel: string;
  serviceFee: ServiceFee;
  tips: { enabled: boolean; presets: number[] };
  promoCodes: PromoCode[];
  memberships: Membership[];
  cancellationPolicy: string;
  depositPolicy: string;
  /** Shown on the confirmation. */
  confirmationNote: string;
};

// ── What the visitor sends ─────────────────────────────────────────────────

export type Recurrence = { frequency: "weekly" | "biweekly" | "monthly"; count: number };

export type BookingSelection = {
  /** Null when the tenant sells no services (a plain consultation booker). */
  serviceId: string | null;
  variantId: string | null;
  addonIds: string[];
  /** per_person / per_unit / hourly: how many. */
  quantity: number;
  /** Null = anyone available (the server assigns). */
  staffId: string | null;
  locationId: string | null;
  mode: ServiceMode;
  /** mobile: where we go. */
  customerAddress: string;
  postalCode: string;
  /** ISO instant. */
  startsAt: string;
  /** The visitor's IANA zone, for the confirmation only. */
  timezone: string;
  recurrence: Recurrence | null;
  /** True when the slot was full and the visitor asked to be waitlisted. */
  waitlist: boolean;
  customer: Customer;
  /** Intake answers keyed by field key. */
  answers: Record<string, unknown>;
  promoCode: string;
  /** Percent of the subtotal, or an absolute amount; at most one applies. */
  tipPercent: number | null;
  tipAmount: number | null;
  membershipId: string | null;
};

// ── What the server (and the card) compute ─────────────────────────────────

export type PriceLineKind =
  | "service"
  | "variant"
  | "addon"
  | "travel"
  | "promo"
  | "membership"
  | "tax"
  | "fee"
  | "tip";

export type PriceLine = {
  kind: PriceLineKind;
  label: string;
  /** Null when the line can't be priced (a quote, "varies"). */
  amount: number | null;
  /** True when the amount is a floor ("from $45"). */
  estimate?: boolean;
  note?: string;
};

export type PriceBreakdown = {
  currency: string;
  lines: PriceLine[];
  /** Before promo / membership / tax / fee / tip. */
  subtotal: number;
  total: number;
  /** True when any line is a floor or unpriced — the total is "from". */
  estimate: boolean;
  /** True when the service (or variant) needs a quote: no total is promised. */
  quoteRequired: boolean;
  /** What is owed at booking, if the tenant takes deposits. */
  deposit: number | null;
  /** Total with the deposit taken out; null when no deposit. */
  balance: number | null;
  durationMinutes: number;
  /** "$45", "From $45", "$45–$80", "Quote". */
  display: string;
};

// ── Availability ───────────────────────────────────────────────────────────

export type DayAvailability = { date: string; open: boolean; slots: number };
export type Slot = {
  startsAt: string;
  endsAt: string;
  /** Providers free for it; empty when the tenant tracks no providers. */
  staffIds: string[];
};

// ── The block the card receives ────────────────────────────────────────────

/** The public subset of BookingSettings — no promo codes. */
export type BookingRules = Omit<BookingSettings, "promoCodes"> & { hasPromoCodes: boolean };

export type BookingFlow = {
  business: { name: string; timezone: string; currency: string };
  services: ServiceRow[];
  categories: string[];
  staff: StaffRow[];
  locations: LocationRow[];
  rules: BookingRules;
  /** Intake questions (lib/appointmentTypes.ts BookingField shape lives in lib/cards.ts). */
  preselect: { serviceId: string | null };
};

// ── Sanitizers: anything → a shape this module vouches for. Never throw. ──

const MAX_LIST = 60;

export const flat = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
export const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "";
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const money = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined || n < 0 || n > 1_000_000 ? undefined : Math.round(n * 100) / 100;
};
const int = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = num(v);
  return n === undefined ? fallback : Math.min(max, Math.max(min, Math.round(n)));
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const strings = (v: unknown, max = 40, each = 80): string[] =>
  Array.isArray(v)
    ? [...new Set(v.map((s) => flat(s, each)).filter(Boolean))].slice(0, max)
    : [];
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_LIST) : []);

export const slugId = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "item";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isTime = (s: unknown): s is string => typeof s === "string" && TIME_RE.test(s);
export const isDate = (s: unknown): s is string => typeof s === "string" && DATE_RE.test(s);

export function sanitizePricing(raw: unknown): Pricing {
  const src = obj(raw);
  const kind = (PRICING_KINDS as readonly string[]).includes(String(src.kind))
    ? (src.kind as PricingKind)
    : "fixed";
  const out: Pricing = { kind };
  const amount = money(src.amount);
  const maxAmount = money(src.maxAmount);
  if (kind === "free" || kind === "quote") return withNote(out, src);
  if (amount !== undefined) out.amount = amount;
  if (kind === "range" && maxAmount !== undefined && (amount === undefined || maxAmount >= amount)) {
    out.maxAmount = maxAmount;
  }
  if (kind === "per_unit") {
    const unit = flat(src.unitLabel, 30);
    if (unit) out.unitLabel = unit;
  }
  // A priced kind with no amount can't be priced: it is "varies" with a note.
  if (kind !== "variable" && out.amount === undefined) {
    return withNote({ kind: "variable" }, src);
  }
  return withNote(out, src);
}

function withNote(p: Pricing, src: Record<string, unknown>): Pricing {
  const note = flat(src.note, 120);
  if (note) p.note = note;
  return p;
}

export function sanitizeHoursRanges(raw: unknown): HoursRange[] {
  const out: HoursRange[] = [];
  for (const r of list(raw)) {
    const src = obj(r);
    if (isTime(src.start) && isTime(src.end) && src.start < src.end) {
      out.push({ start: src.start, end: src.end });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
}

export function sanitizeWeeklyHours(raw: unknown): WeeklyHours {
  const src = obj(raw);
  const out = {} as WeeklyHours;
  for (const d of DAY_KEYS) out[d] = sanitizeHoursRanges(src[d]);
  return out;
}

/** Null when nothing usable was given — "use the business hours". */
export function sanitizeOptionalHours(raw: unknown): WeeklyHours | null {
  if (raw === null || raw === undefined || typeof raw !== "object") return null;
  const hours = sanitizeWeeklyHours(raw);
  return DAY_KEYS.some((d) => hours[d].length > 0) ? hours : null;
}

export function sanitizeDeposit(raw: unknown): Deposit {
  const src = obj(raw);
  const amount = money(src.amount);
  if (src.kind === "fixed" && amount) return { kind: "fixed", amount };
  if (src.kind === "percent" && amount && amount <= 100) return { kind: "percent", amount };
  return { kind: "none" };
}

export function sanitizeAddons(raw: unknown): ServiceAddon[] {
  const out: ServiceAddon[] = [];
  const seen = new Set<string>();
  for (const a of list(raw)) {
    const src = obj(a);
    const name = flat(src.name, 80);
    if (!name) continue;
    const id = flat(src.id, 40) || slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const addon: ServiceAddon = { id, name };
    const description = flat(src.description, 200);
    const price = money(src.price);
    const duration = num(src.durationMinutes);
    if (description) addon.description = description;
    if (price !== undefined) addon.price = price;
    if (duration !== undefined && duration > 0) addon.durationMinutes = Math.round(duration);
    out.push(addon);
  }
  return out;
}

export function sanitizeVariants(raw: unknown): ServiceVariant[] {
  const out: ServiceVariant[] = [];
  const seen = new Set<string>();
  for (const v of list(raw)) {
    const src = obj(v);
    const name = flat(src.name, 80);
    if (!name) continue;
    const id = flat(src.id, 40) || slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const variant: ServiceVariant = { id, name };
    const description = flat(src.description, 200);
    const duration = num(src.durationMinutes);
    if (description) variant.description = description;
    if (src.pricing && typeof src.pricing === "object") variant.pricing = sanitizePricing(src.pricing);
    if (duration !== undefined && duration > 0) variant.durationMinutes = Math.round(duration);
    out.push(variant);
  }
  return out;
}

/** The long tail of a service, stored as one JSON column. */
export type ServiceConfig = Pick<
  ServiceRow,
  | "images"
  | "addons"
  | "variants"
  | "deposit"
  | "modes"
  | "staffIds"
  | "locationIds"
  | "eligibility"
  | "preparation"
  | "cancellationPolicy"
  | "bufferBeforeMinutes"
  | "bufferAfterMinutes"
  | "maxQuantity"
>;

export function sanitizeServiceConfig(raw: unknown): ServiceConfig {
  const src = obj(raw);
  const modes = strings(src.modes, 3, 20).filter((m): m is ServiceMode =>
    (SERVICE_MODES as readonly string[]).includes(m),
  );
  const out: ServiceConfig = {
    images: strings(src.images, 8, 500).filter(isImageRef),
    addons: sanitizeAddons(src.addons),
    variants: sanitizeVariants(src.variants),
    deposit: sanitizeDeposit(src.deposit),
    modes,
    staffIds: strings(src.staffIds, 60, 60),
    locationIds: strings(src.locationIds, 60, 60),
    eligibility: text(src.eligibility, 600),
    preparation: text(src.preparation, 1000),
    cancellationPolicy: text(src.cancellationPolicy, 1000),
    bufferBeforeMinutes: int(src.bufferBeforeMinutes, 0, 480, 0),
    bufferAfterMinutes: int(src.bufferAfterMinutes, 0, 480, 0),
  };
  const maxQuantity = num(src.maxQuantity);
  if (maxQuantity !== undefined && maxQuantity >= 1) out.maxQuantity = Math.round(maxQuantity);
  return out;
}

/** An image the card may draw: one of ours, or an https URL. */
export function isImageRef(s: string): boolean {
  return /^\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp|gif)$/i.test(s) || /^https:\/\/\S+$/i.test(s);
}

/** The long tail of a provider, stored as one JSON column. */
export type StaffConfig = Pick<
  StaffRow,
  | "specialties"
  | "languages"
  | "credentials"
  | "genderLabel"
  | "hours"
  | "timeOff"
  | "priceOverrides"
  | "durationOverrides"
>;

export function sanitizeTimeOff(raw: unknown): TimeOff[] {
  const out: TimeOff[] = [];
  for (const t of list(raw)) {
    const src = obj(t);
    const start = new Date(String(src.start ?? ""));
    const end = new Date(String(src.end ?? ""));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) continue;
    const item: TimeOff = { start: start.toISOString(), end: end.toISOString() };
    const label = flat(src.label, 60);
    if (label) item.label = label;
    out.push(item);
  }
  return out;
}

function numberMap(raw: unknown, min: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(raw))) {
    const n = money(v);
    if (n !== undefined && n >= min && /^[a-zA-Z0-9_:-]{1,60}$/.test(k)) out[k] = n;
  }
  return out;
}

export function sanitizeStaffConfig(raw: unknown): StaffConfig {
  const src = obj(raw);
  const durations = numberMap(src.durationOverrides, 1);
  for (const k of Object.keys(durations)) durations[k] = Math.round(durations[k]);
  return {
    specialties: strings(src.specialties, 20, 60),
    languages: strings(src.languages, 20, 40),
    credentials: strings(src.credentials, 20, 80),
    genderLabel: flat(src.genderLabel, 30),
    hours: sanitizeOptionalHours(src.hours),
    timeOff: sanitizeTimeOff(src.timeOff),
    priceOverrides: numberMap(src.priceOverrides, 0),
    durationOverrides: durations,
  };
}

/** The long tail of a location, stored as one JSON column. */
export type LocationConfig = Pick<
  LocationRow,
  "hours" | "serviceArea" | "meetingLink" | "note" | "capacity" | "priceOverrides"
>;

export function sanitizeServiceArea(raw: unknown): ServiceArea {
  const src = obj(raw);
  const out: ServiceArea = {
    postalCodes: strings(src.postalCodes, 500, 12).map((z) => z.toUpperCase().replace(/\s+/g, "")),
  };
  const radius = num(src.radiusMiles);
  const fee = money(src.travelFee);
  const description = flat(src.description, 200);
  if (radius !== undefined && radius > 0) out.radiusMiles = Math.round(radius * 10) / 10;
  if (fee !== undefined) out.travelFee = fee;
  if (description) out.description = description;
  return out;
}

export function sanitizeLocationConfig(raw: unknown): LocationConfig {
  const src = obj(raw);
  const link = flat(src.meetingLink, 300);
  return {
    hours: sanitizeOptionalHours(src.hours),
    serviceArea: sanitizeServiceArea(src.serviceArea),
    meetingLink: /^https:\/\/\S+$/i.test(link) ? link : "",
    note: text(src.note, 400),
    capacity: int(src.capacity, 1, 100, 1),
    priceOverrides: numberMap(src.priceOverrides, 0),
  };
}

export function sanitizeCustomerFields(raw: unknown): CustomerFieldConfig[] {
  const given = new Map<string, Record<string, unknown>>();
  for (const f of list(raw)) {
    const src = obj(f);
    if (typeof src.key === "string") given.set(src.key, src);
  }
  // Every key is always present so the admin form and the card iterate one
  // list; the core five are always on, and firstName/email always required.
  return CUSTOMER_FIELD_KEYS.map((key) => {
    const src = given.get(key) ?? {};
    const core = CORE_CUSTOMER_KEYS.includes(key);
    const always = key === "firstName" || key === "email";
    return {
      key,
      enabled: core ? true : bool(src.enabled, false),
      required: always ? true : key === "smsConsent" ? false : bool(src.required, key === "lastName" || key === "phone"),
      label: flat(src.label, 80),
    };
  });
}

export function sanitizePromoCodes(raw: unknown): PromoCode[] {
  const out: PromoCode[] = [];
  const seen = new Set<string>();
  for (const p of list(raw)) {
    const src = obj(p);
    const code = flat(src.code, 30).toUpperCase().replace(/\s+/g, "");
    const amount = money(src.amount);
    if (!code || seen.has(code) || amount === undefined || amount <= 0) continue;
    const kind = src.kind === "fixed" ? "fixed" : "percent";
    if (kind === "percent" && amount > 100) continue;
    seen.add(code);
    out.push({
      code,
      kind,
      amount,
      serviceIds: strings(src.serviceIds, 60, 60),
      expiresOn: isDate(src.expiresOn) ? src.expiresOn : "",
      note: flat(src.note, 120),
    });
  }
  return out;
}

export function sanitizeMemberships(raw: unknown): Membership[] {
  const out: Membership[] = [];
  const seen = new Set<string>();
  for (const m of list(raw)) {
    const src = obj(m);
    const name = flat(src.name, 60);
    const discountPercent = num(src.discountPercent);
    if (!name || discountPercent === undefined || discountPercent <= 0 || discountPercent > 100) continue;
    const id = flat(src.id, 40) || slugId(name);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, discountPercent: Math.round(discountPercent * 100) / 100 });
  }
  return out;
}

export const DEFAULT_TIMEZONE = "America/New_York";

export function defaultWeeklyHours(): WeeklyHours {
  const day: HoursRange[] = [{ start: "09:00", end: "17:00" }];
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: [], sun: [] };
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function sanitizeBookingSettings(raw: unknown): BookingSettings {
  const src = obj(raw);
  const fee = obj(src.serviceFee);
  const feeAmount = money(fee.amount);
  const feeKind = fee.kind === "fixed" || fee.kind === "percent" ? fee.kind : "none";
  const tips = obj(src.tips);
  const staffSelection =
    src.staffSelection === "hidden" || src.staffSelection === "required" ? src.staffSelection : "optional";
  const holidays: Holiday[] = [];
  for (const h of list(src.holidays)) {
    const item = obj(h);
    if (!isDate(item.date)) continue;
    const label = flat(item.label, 60);
    holidays.push(label ? { date: item.date, label } : { date: item.date });
  }
  const hours = sanitizeWeeklyHours(src.hours);
  return {
    timezone: isValidTimezone(src.timezone) ? src.timezone : DEFAULT_TIMEZONE,
    currency: /^[A-Z]{3}$/.test(String(src.currency ?? "")) ? String(src.currency) : "USD",
    hours: DAY_KEYS.some((d) => hours[d].length) ? hours : defaultWeeklyHours(),
    holidays: holidays.slice(0, 100),
    slotIntervalMinutes: [5, 10, 15, 20, 30, 45, 60, 90, 120].includes(int(src.slotIntervalMinutes, 5, 120, 30))
      ? int(src.slotIntervalMinutes, 5, 120, 30)
      : 30,
    leadTimeMinutes: int(src.leadTimeMinutes, 0, 60 * 24 * 30, 60),
    dailyCutoff: isTime(src.dailyCutoff) ? src.dailyCutoff : "",
    sameDayBooking: bool(src.sameDayBooking, true),
    maxAdvanceDays: int(src.maxAdvanceDays, 1, 730, 60),
    bufferBeforeMinutes: int(src.bufferBeforeMinutes, 0, 480, 0),
    bufferAfterMinutes: int(src.bufferAfterMinutes, 0, 480, 0),
    defaultDurationMinutes: int(src.defaultDurationMinutes, 5, 24 * 60, 30),
    waitlist: bool(src.waitlist, false),
    recurring: bool(src.recurring, false),
    staffSelection,
    genderPreference: bool(src.genderPreference, false),
    customerFields: sanitizeCustomerFields(src.customerFields),
    taxRate: Math.min(100, Math.max(0, num(src.taxRate) ?? 0)),
    taxLabel: flat(src.taxLabel, 30) || "Tax",
    serviceFee:
      feeKind === "none" || feeAmount === undefined || (feeKind === "percent" && feeAmount > 100)
        ? { kind: "none" }
        : { kind: feeKind, amount: feeAmount, label: flat(fee.label, 40) || "Service fee" },
    tips: {
      enabled: bool(tips.enabled, false),
      presets: (Array.isArray(tips.presets) ? tips.presets : [15, 20, 25])
        .map((p) => num(p))
        .filter((p): p is number => p !== undefined && p > 0 && p <= 100)
        .slice(0, 4),
    },
    promoCodes: sanitizePromoCodes(src.promoCodes),
    memberships: sanitizeMemberships(src.memberships),
    cancellationPolicy: text(src.cancellationPolicy, 1000),
    depositPolicy: text(src.depositPolicy, 600),
    confirmationNote: text(src.confirmationNote, 600),
  };
}

export function publicRules(s: BookingSettings): BookingRules {
  const { promoCodes, ...rest } = s;
  return { ...rest, hasPromoCodes: promoCodes.length > 0 };
}

export function sanitizeSelection(raw: unknown): BookingSelection {
  const src = obj(raw);
  const rec = obj(src.recurrence);
  const frequency =
    rec.frequency === "weekly" || rec.frequency === "biweekly" || rec.frequency === "monthly"
      ? rec.frequency
      : null;
  const customer: Customer = {};
  const givenCustomer = obj(src.customer);
  for (const key of CUSTOMER_FIELD_KEYS) {
    const v = flat(givenCustomer[key], key === "notes" ? 1000 : 200);
    if (v) customer[key] = v;
  }
  const mode = (SERVICE_MODES as readonly string[]).includes(String(src.mode))
    ? (src.mode as ServiceMode)
    : "in_person";
  const tipPercent = num(src.tipPercent);
  const tipAmount = money(src.tipAmount);
  return {
    serviceId: flat(src.serviceId, 80) || null,
    variantId: flat(src.variantId, 40) || null,
    addonIds: strings(src.addonIds, 20, 40),
    quantity: int(src.quantity, 1, 500, 1),
    staffId: flat(src.staffId, 60) || null,
    locationId: flat(src.locationId, 60) || null,
    mode,
    customerAddress: flat(src.customerAddress, 300),
    postalCode: flat(src.postalCode, 12).toUpperCase().replace(/\s+/g, ""),
    startsAt: flat(src.startsAt, 40),
    timezone: isValidTimezone(src.timezone) ? src.timezone : "",
    recurrence: frequency ? { frequency, count: int(rec.count, 2, 26, 4) } : null,
    waitlist: bool(src.waitlist, false),
    customer,
    answers: obj(src.answers),
    promoCode: flat(src.promoCode, 30).toUpperCase().replace(/\s+/g, ""),
    tipPercent: tipPercent !== undefined && tipPercent > 0 && tipPercent <= 100 ? tipPercent : null,
    tipAmount: tipAmount !== undefined && tipAmount > 0 ? tipAmount : null,
    membershipId: flat(src.membershipId, 40) || null,
  };
}

// ── Display helpers ────────────────────────────────────────────────────────

export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** "$45", "From $45", "$45–$80", "$45/hr", "$12/person", "Free", "Quote", "Varies". */
export function pricingLabel(p: Pricing, currency = "USD"): string {
  const m = (n: number) => formatMoney(n, currency);
  switch (p.kind) {
    case "free":
      return "Free";
    case "quote":
      return "Quote";
    case "variable":
      return p.note || "Varies";
    case "fixed":
      return m(p.amount ?? 0);
    case "starting_at":
      return `From ${m(p.amount ?? 0)}`;
    case "range":
      return p.maxAmount !== undefined ? `${m(p.amount ?? 0)}–${m(p.maxAmount)}` : `From ${m(p.amount ?? 0)}`;
    case "hourly":
      return `${m(p.amount ?? 0)}/hr`;
    case "per_person":
      return `${m(p.amount ?? 0)}/person`;
    case "per_unit":
      return `${m(p.amount ?? 0)}/${p.unitLabel || "unit"}`;
  }
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export const MODE_LABELS: Record<ServiceMode, string> = {
  in_person: "In person",
  online: "Online",
  mobile: "We come to you",
};

/** The business's own price text ("$35", "$40+", "from £25", "$30–$45") → a Pricing. Never invents. */
export function pricingFromText(raw: string): Pricing {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "variable" };
  if (/^free$/i.test(s)) return { kind: "free" };
  if (/quote|call|contact|consult/i.test(s) && !/\d/.test(s)) return { kind: "quote", note: s.slice(0, 120) };
  const amounts = [...s.matchAll(/(\d[\d,]*(?:\.\d{1,2})?)/g)]
    .map((m) => Number.parseFloat(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
  if (!amounts.length) return { kind: "variable", note: s.slice(0, 120) };
  const floor = /\+|from|starting|and up|min/i.test(s);
  const perHour = /\/\s*(hr|hour)|per hour|hourly/i.test(s);
  const perPerson = /\/\s*(person|pp|guest)|per (person|guest)|each/i.test(s);
  if (perHour) return { kind: "hourly", amount: amounts[0] };
  if (perPerson) return { kind: "per_person", amount: amounts[0] };
  if (amounts.length >= 2 && /[-–—]|to\b/i.test(s)) {
    const lo = Math.min(amounts[0], amounts[1]);
    const hi = Math.max(amounts[0], amounts[1]);
    return lo === hi ? { kind: "fixed", amount: lo } : { kind: "range", amount: lo, maxAmount: hi };
  }
  if (amounts.length >= 2) return { kind: "starting_at", amount: Math.min(...amounts) };
  return floor ? { kind: "starting_at", amount: amounts[0] } : { kind: "fixed", amount: amounts[0] };
}

/** The pricing that applies once a variant is chosen. */
export function effectivePricing(service: ServiceRow, variant: ServiceVariant | null): Pricing {
  return variant?.pricing ?? service.pricing;
}

/** Minutes for the service as configured, before add-ons. */
export function baseDuration(
  service: ServiceRow | null,
  variant: ServiceVariant | null,
  staff: StaffRow | null,
  fallback: number,
): number {
  if (!service) return fallback;
  return staff?.durationOverrides[service.id] ?? variant?.durationMinutes ?? service.durationMinutes;
}

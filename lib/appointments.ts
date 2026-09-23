import { prisma, getProfile } from "./db";
import {
  FIELD_TYPES,
  isChoiceType,
  keyFromLabel,
  parseFieldConfig,
  resolveAnswer,
  sanitizeFieldConfig,
  type FieldConfig,
  type FieldType,
  type AppointmentFieldRow,
  type BookingConfig,
} from "./appointmentTypes";
import { LEGACY_PICKER_HEAD, SERVICE_PICKER_KEY, servicePickerField } from "./bookingMenu";
import { onboardingIngestKind } from "./ingestionSources";
import { SERVICES_SOURCE_TITLE, parseServiceCatalog } from "./serviceCatalog";
import { indexAppointment } from "./retrieval/origins";
import { dropOrigin } from "./retrieval/indexer";
import { sanitizeBookingSettings } from "./booking/types";
import { addMinutes } from "./booking/time";

/**
 * The appointment store: the per-tenant booking toggle, the field catalog the
 * wizard asks from, and the appointments themselves. Data only — the booking
 * card is hydrated in lib/cards.ts and rendered in app/cards/Cards.tsx; the
 * admin Calendar panel reads listAppointments.
 *
 * Every validation the visitor-facing submit needs lives in
 * createAppointment, because the client wizard is untrusted: disabled means
 * rejected, required means required, the past is unbookable, and the unique
 * (userId, startsAt) constraint — not a read-then-write check — decides who
 * wins a race for the same instant.
 */

// Shapes live in lib/appointmentTypes.ts (import-free, so the client Calendar
// can reach them); re-exported here so this stays the one import for the store.
export {
  FIELD_TYPES,
  type FieldType,
  type FieldConfig,
  type FieldOption,
  type AppointmentFieldRow,
  type BookingConfig,
} from "./appointmentTypes";

export type AppointmentRow = {
  id: string;
  startsAt: Date;
  answers: Record<string, string>;
  createdAt: Date;
};

/** Seeded on first enable; from there the tenant owns the catalog. */
export const DEFAULT_APPOINTMENT_FIELDS: ReadonlyArray<
  Pick<AppointmentFieldRow, "key" | "label" | "type" | "required">
> = [
  { key: "name", label: "Your name", type: "short_text", required: true },
  { key: "email", label: "Your email", type: "email", required: true },
  { key: "reason", label: "What would you like to talk about?", type: "long_text", required: false },
];

function toFieldRow(f: {
  key: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  config: string;
}): AppointmentFieldRow {
  const type = (FIELD_TYPES as readonly string[]).includes(f.type) ? (f.type as FieldType) : "short_text";
  return {
    key: f.key,
    label: f.label,
    type,
    required: f.required,
    order: f.order,
    config: parseFieldConfig(type, f.config),
  };
}

/**
 * The service question onboarding used to write: a text box whose label
 * listed what fit of the menu. Recognized only while it is still exactly what
 * was generated — the seeded key, still a text box, still the generated
 * opening words — so a question the tenant has since made their own is never
 * touched.
 */
const isLegacyPicker = (f: AppointmentFieldRow) =>
  f.key === SERVICE_PICKER_KEY && f.type === "short_text" && f.label.startsWith(LEGACY_PICKER_HEAD);

const isDefaultField = (f: AppointmentFieldRow) =>
  DEFAULT_APPOINTMENT_FIELDS.some(
    (d) => d.key === f.key && d.label === f.label && d.type === f.type && d.required === f.required,
  );

/** Exactly the three questions the first enable writes, nothing edited. */
const isBareDefaults = (fields: AppointmentFieldRow[]) =>
  fields.length === DEFAULT_APPOINTMENT_FIELDS.length && fields.every(isDefaultField);

/**
 * Nobody has edited this form, so onboarding may rebuild it: it is empty, or
 * every question is one onboarding wrote (`generated`), or it is still the
 * defaults — with or without the legacy picker older onboardings added. One
 * admin save, delete or reorder ends that (`claimForm`).
 */
export function isUntouchedForm(fields: AppointmentFieldRow[]): boolean {
  if (fields.every((f) => f.config.generated)) return true;
  const rest = fields.filter((f) => !isLegacyPicker(f));
  return fields.length - rest.length <= 1 && rest.length >= 2 && rest.every(isDefaultField);
}

/** The services on file as the menu question; null when there are none. */
async function servicesMenu(userId: string) {
  const source = await prisma.source.findFirst({
    where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    orderBy: { updatedAt: "desc" },
    select: { rawText: true },
  });
  return servicePickerField(parseServiceCatalog(source?.rawText));
}

/**
 * Present a legacy picker as the menu it was standing in for, built from the
 * services on file. On read, not as a data migration: the catalog is text
 * only this code can parse, and a read-time rule fixes every tenant's form
 * the moment it deploys. Everything downstream — the card, the validator, the
 * admin editor — reads this one config, so they all agree on what is being
 * asked; the first admin Save writes the menu down and the rule lets go.
 */
async function upgradeLegacyPicker(userId: string, fields: AppointmentFieldRow[]): Promise<AppointmentFieldRow[]> {
  if (!fields.some(isLegacyPicker)) return fields;
  const picker = await servicesMenu(userId);
  // No services on file: the text box is still the best question available.
  if (!picker) return fields;
  return fields.map((f) =>
    isLegacyPicker(f) ? { ...f, label: picker.label, type: picker.type, config: picker.config } : f,
  );
}

const GENERATED = JSON.stringify({ generated: true });

/**
 * Bare defaults with services on file: booking is on by default, so the three
 * defaults were written before onboarding knew the services, and nothing ever
 * revisited them. The menu takes the place of "What would you like to talk
 * about?". Written down rather than presented — unlike the legacy picker, the
 * menu's key ("service") is not the key of the row it replaces ("reason"), and
 * an admin deleting or saving the question they are shown must be acting on a
 * row that exists. Once, idempotently; the rows stay `generated`, so onboarding
 * can still rebuild the form. True when it wrote.
 */
async function adoptServicesMenu(userId: string, fields: AppointmentFieldRow[]): Promise<boolean> {
  if (!isBareDefaults(fields)) return false;
  const picker = await servicesMenu(userId);
  const reason = fields.find((f) => f.key === "reason");
  if (!picker || !reason) return false;
  const menu = {
    label: picker.label,
    type: picker.type,
    required: picker.required,
    order: reason.order,
    config: JSON.stringify({ ...picker.config, generated: true }),
  };
  await prisma.$transaction([
    prisma.appointmentField.deleteMany({ where: { userId, key: "reason" } }),
    prisma.appointmentField.updateMany({ where: { userId }, data: { config: GENERATED } }),
    prisma.appointmentField.upsert({
      where: { userId_key: { userId, key: picker.key } },
      update: menu,
      create: { userId, key: picker.key, ...menu },
    }),
  ]);
  return true;
}

const storedFields = async (userId: string) =>
  (await prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } })).map(toFieldRow);

export async function getBookingConfig(userId: string): Promise<BookingConfig> {
  const [profile, stored] = await Promise.all([getProfile(userId), storedFields(userId)]);
  const fields = (await adoptServicesMenu(userId, stored)) ? await storedFields(userId) : stored;
  return { enabled: profile.bookingEnabled, fields: await upgradeLegacyPicker(userId, fields) };
}

/** Toggle booking; the first enable seeds the default fields so the wizard
 *  is never a zero-question flow. */
export async function setBookingEnabled(userId: string, enabled: boolean): Promise<void> {
  await getProfile(userId); // ensure the row exists
  await prisma.profile.update({ where: { userId }, data: { bookingEnabled: enabled } });
  if (enabled && (await prisma.appointmentField.count({ where: { userId } })) === 0) {
    await prisma.appointmentField.createMany({
      data: DEFAULT_APPOINTMENT_FIELDS.map((f, i) => ({ ...f, userId, order: i })),
    });
  }
}

export { keyFromLabel };

/** Create or update one field. Returns an error string, or null on success. */
export async function saveAppointmentField(
  userId: string,
  input: { key?: string; label: string; type: string; required: boolean; config?: unknown; generated?: boolean },
): Promise<string | null> {
  const label = input.label.trim().slice(0, 120);
  if (!label) return "The question needs a label.";
  const key = (input.key?.trim() || keyFromLabel(label)).slice(0, 60);
  if (!/^[a-z0-9_]+$/.test(key)) return "Field keys are lowercase letters, digits, and _ only.";
  const type = (FIELD_TYPES as readonly string[]).includes(input.type)
    ? input.type
    : "short_text";
  // `config` left out means "keep what's stored" — a caller renaming a
  // question shouldn't have to resend its menu to avoid wiping it.
  const config = input.config === undefined ? undefined : sanitizeFieldConfig(type, input.config);
  if (config && isChoiceType(type) && !config.options?.length) {
    return "A choice question needs at least one option.";
  }
  // Onboarding's own writes are marked so it can rebuild them later; any other
  // save means a person now owns this form.
  const kept: FieldConfig | undefined = input.generated ? { ...(config ?? {}), generated: true } : config;
  const stored = kept === undefined ? {} : { config: JSON.stringify(kept) };
  const last = await prisma.appointmentField.findFirst({
    where: { userId },
    orderBy: { order: "desc" },
  });
  await prisma.appointmentField.upsert({
    where: { userId_key: { userId, key } },
    update: { label, type, required: input.required, ...stored },
    create: { userId, key, label, type, required: input.required, order: (last?.order ?? -1) + 1, ...stored },
  });
  if (!input.generated) await claimForm(userId);
  return null;
}

/** The tenant has edited their form: nothing in it is onboarding's to rebuild. */
async function claimForm(userId: string): Promise<void> {
  const rows = await prisma.appointmentField.findMany({
    where: { userId, config: { contains: '"generated":true' } },
    select: { id: true, type: true, config: true },
  });
  for (const r of rows) {
    const config = parseFieldConfig(r.type, r.config);
    delete config.generated;
    await prisma.appointmentField.update({ where: { id: r.id }, data: { config: JSON.stringify(config) } });
  }
}

/**
 * Replace an untouched form with the questions onboarding planned. Returns how
 * many were written — 0 when the form is the tenant's, which is never rewritten.
 */
export async function rebuildUntouchedForm(
  userId: string,
  plan: { key: string; label: string; type: string; required: boolean; config?: FieldConfig }[],
): Promise<number> {
  const rows = await prisma.appointmentField.findMany({ where: { userId } });
  if (!isUntouchedForm(rows.map(toFieldRow))) return 0;
  await prisma.appointmentField.deleteMany({ where: { userId } });
  let written = 0;
  for (const f of plan) {
    if ((await saveAppointmentField(userId, { ...f, config: f.config ?? {}, generated: true })) === null) written++;
  }
  return written;
}

export async function deleteAppointmentField(userId: string, key: string): Promise<void> {
  await prisma.appointmentField.deleteMany({ where: { userId, key } });
  await claimForm(userId);
}

/** Swap a field with its neighbor so the wizard asks it earlier or later. */
export async function moveAppointmentField(
  userId: string,
  key: string,
  dir: "up" | "down",
): Promise<void> {
  const fields = await prisma.appointmentField.findMany({
    where: { userId },
    orderBy: { order: "asc" },
  });
  const i = fields.findIndex((f) => f.key === key);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= fields.length) return;
  await prisma.$transaction([
    prisma.appointmentField.update({ where: { id: fields[i].id }, data: { order: fields[j].order } }),
    prisma.appointmentField.update({ where: { id: fields[j].id }, data: { order: fields[i].order } }),
  ]);
  await claimForm(userId);
}

export type CreateAppointmentResult = { ok: true; id: string } | { ok: false; error: string };

/** The tenant's default appointment length — the one BookingSettings field
 *  this intake-only path needs, read without pulling in lib/booking/store.ts
 *  (which imports back into this module for the legacy bridge). */
async function defaultDurationMinutes(userId: string): Promise<number> {
  const row = await prisma.bookingSettings.findUnique({ where: { userId } });
  let raw: unknown = {};
  try {
    raw = row ? JSON.parse(row.config) : {};
  } catch {
    raw = {};
  }
  return sanitizeBookingSettings(raw).defaultDurationMinutes;
}

/**
 * The one write path for a booking, shared by the API route and anything
 * later. Fail closed: every uncertain state is a rejection with a reason.
 *
 * Two appointments may legitimately share an instant once services, staff
 * and locations exist (lib/booking/store.ts's createBooking), so the race
 * guard is no longer a unique (userId, startsAt) index — this path books with
 * no provider, so "the same instant is already booked" is still exactly one
 * taken slot, decided under a per-tenant advisory lock instead.
 */
export async function createAppointment(
  userId: string,
  input: { startsAt: string; answers: Record<string, unknown> },
): Promise<CreateAppointmentResult> {
  const { enabled, fields } = await getBookingConfig(userId);
  if (!enabled) return { ok: false, error: "Booking isn't available right now." };

  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: "That date doesn't look right." };
  if (startsAt.getTime() <= Date.now()) return { ok: false, error: "Pick a time in the future." };

  // Keep only answers to questions that exist, each held to what its question
  // allows (a pick must be on the menu, a count inside its bounds); reject a
  // missing required one.
  const answers: Record<string, string> = {};
  for (const f of fields) {
    const resolved = resolveAnswer(f, input.answers?.[f.key]);
    if (!resolved.ok) return resolved;
    if (f.required && !resolved.value) return { ok: false, error: `"${f.label}" is required.` };
    if (resolved.value) answers[f.key] = resolved.value;
  }

  const duration = await defaultDurationMinutes(userId);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, which
      // $queryRaw's row deserializer can't handle.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const clash = await tx.appointment.findFirst({ where: { userId, startsAt, status: "confirmed" } });
      if (clash) return { ok: false as const, error: "That time was just taken — pick another." };
      const row = await tx.appointment.create({
        data: { userId, startsAt, endsAt: addMinutes(startsAt, duration), durationMinutes: duration, answers: JSON.stringify(answers) },
      });
      return { ok: true as const, id: row.id };
    });
    if (!result.ok) return result;
    // Best-effort: an indexing failure must never lose the booking.
    await indexAppointment(userId, result.id).catch(() => {});
    return result;
  } catch {
    return { ok: false, error: "Could not save the booking. Try again." };
  }
}

/** Cancel = delete: the slot frees up and the knowledge entry is retracted. */
export async function cancelAppointment(userId: string, id: string): Promise<void> {
  await prisma.appointment.deleteMany({ where: { userId, id } });
  await dropOrigin(userId, "appointment", id).catch(() => {});
}

export function safeAnswers(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, v]) => typeof v === "string")
        .map(([k, v]) => [k, v as string]),
    );
  } catch {
    return {};
  }
}

export async function listAppointments(userId: string): Promise<AppointmentRow[]> {
  const rows = await prisma.appointment.findMany({
    where: { userId },
    orderBy: { startsAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    startsAt: r.startsAt,
    answers: safeAnswers(r.answers),
    createdAt: r.createdAt,
  }));
}

import { prisma, getProfile } from "./db";
import {
  FIELD_TYPES,
  isChoiceType,
  parseFieldConfig,
  resolveAnswer,
  sanitizeFieldConfig,
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
  const source = await prisma.source.findFirst({
    where: { userId, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE },
    orderBy: { updatedAt: "desc" },
    select: { rawText: true },
  });
  const picker = servicePickerField(parseServiceCatalog(source?.rawText));
  // No services on file: the text box is still the best question available.
  if (!picker) return fields;
  return fields.map((f) =>
    isLegacyPicker(f) ? { ...f, label: picker.label, type: picker.type, config: picker.config } : f,
  );
}

export async function getBookingConfig(userId: string): Promise<BookingConfig> {
  const [profile, fields] = await Promise.all([
    getProfile(userId),
    prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } }),
  ]);
  return {
    enabled: profile.bookingEnabled,
    fields: await upgradeLegacyPicker(userId, fields.map(toFieldRow)),
  };
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

/** The key a label becomes. Exported because onboarding seeds several
 *  questions in a row and must detect a collision before the upsert below
 *  silently overwrites one it just wrote. */
export const keyFromLabel = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/** Create or update one field. Returns an error string, or null on success. */
export async function saveAppointmentField(
  userId: string,
  input: { key?: string; label: string; type: string; required: boolean; config?: unknown },
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
  const stored = config === undefined ? {} : { config: JSON.stringify(config) };
  const last = await prisma.appointmentField.findFirst({
    where: { userId },
    orderBy: { order: "desc" },
  });
  await prisma.appointmentField.upsert({
    where: { userId_key: { userId, key } },
    update: { label, type, required: input.required, ...stored },
    create: { userId, key, label, type, required: input.required, order: (last?.order ?? -1) + 1, ...stored },
  });
  return null;
}

export async function deleteAppointmentField(userId: string, key: string): Promise<void> {
  await prisma.appointmentField.deleteMany({ where: { userId, key } });
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
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
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

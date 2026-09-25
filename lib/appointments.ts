import { prisma, getProfile } from "./db";
import {
  FIELD_TYPES,
  isChoiceType,
  isFieldRole,
  keyFromLabel,
  parseFieldConfig,
  resolveAnswer,
  sanitizeFieldConfig,
  type FieldConfig,
  type FieldRole,
  type FieldType,
  type AppointmentFieldRow,
  type BookingConfig,
} from "./appointmentTypes";
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
 * The form is the business's own: what is stored is what is asked, in the
 * stored order — nothing seeded on enable, nothing rewritten on read. A
 * field's `role` says which answer is the customer's name/email/phone; its
 * `screen` says which questions are asked together.
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

function toFieldRow(f: {
  key: string;
  label: string;
  type: string;
  required: boolean;
  order: number;
  config: string;
  role: string;
  screen: number;
}): AppointmentFieldRow {
  const type = (FIELD_TYPES as readonly string[]).includes(f.type) ? (f.type as FieldType) : "short_text";
  return {
    key: f.key,
    label: f.label,
    type,
    required: f.required,
    order: f.order,
    config: parseFieldConfig(type, f.config),
    role: isFieldRole(f.role) ? f.role : "none",
    // A row written before screens existed sits on its own screen.
    screen: f.screen >= 1 ? f.screen : f.order + 1,
  };
}

/**
 * Nobody has edited this form, so onboarding may rebuild it: it is empty, or
 * every question is one onboarding wrote (`generated`). One admin save,
 * delete, reorder or screen change ends that (`claimForm`).
 */
export function isUntouchedForm(fields: AppointmentFieldRow[]): boolean {
  return fields.every((f) => f.config.generated);
}

const storedFields = async (userId: string) =>
  (await prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } })).map(toFieldRow);

/** The booking flag and the stored questions, in order — exactly what is on file. */
export async function getBookingConfig(userId: string): Promise<BookingConfig> {
  const [profile, fields] = await Promise.all([getProfile(userId), storedFields(userId)]);
  return { enabled: profile.bookingEnabled, fields };
}

/** Toggle booking. Nothing else: the form is whatever the tenant (or
 *  onboarding, on their behalf) has written. */
export async function setBookingEnabled(userId: string, enabled: boolean): Promise<void> {
  await getProfile(userId); // ensure the row exists
  await prisma.profile.update({ where: { userId }, data: { bookingEnabled: enabled } });
}

export { keyFromLabel };

/** Create or update one field. Returns an error string, or null on success. */
export async function saveAppointmentField(
  userId: string,
  input: {
    key?: string;
    label: string;
    type: string;
    required: boolean;
    config?: unknown;
    generated?: boolean;
    /** Left out = keep what's stored (or `none` on create). */
    role?: FieldRole;
    /** Left out = keep what's stored (or a new screen of its own on create). */
    screen?: number;
  },
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
  const [last, top] = await Promise.all([
    prisma.appointmentField.findFirst({ where: { userId }, orderBy: { order: "desc" } }),
    prisma.appointmentField.aggregate({ where: { userId }, _max: { screen: true } }),
  ]);
  const role = input.role !== undefined && isFieldRole(input.role) ? { role: input.role } : {};
  const screen =
    input.screen !== undefined && Number.isInteger(input.screen) && input.screen >= 1 ? { screen: input.screen } : {};
  await prisma.appointmentField.upsert({
    where: { userId_key: { userId, key } },
    update: { label, type, required: input.required, ...stored, ...role, ...screen },
    create: {
      userId,
      key,
      label,
      type,
      required: input.required,
      order: (last?.order ?? -1) + 1,
      role: "none",
      screen: (top._max.screen ?? 0) + 1,
      ...stored,
      ...role,
      ...screen,
    },
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
  plan: {
    key: string;
    label: string;
    type: string;
    required: boolean;
    config?: FieldConfig;
    role?: FieldRole;
    /** Left out = a screen of its own, after every screen written so far. */
    screen?: number;
  }[],
): Promise<number> {
  const rows = await prisma.appointmentField.findMany({ where: { userId } });
  if (!isUntouchedForm(rows.map(toFieldRow))) return 0;
  await prisma.appointmentField.deleteMany({ where: { userId } });
  let written = 0;
  for (const f of plan) {
    const saved = await saveAppointmentField(userId, {
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      config: f.config ?? {},
      generated: true,
      ...(f.role !== undefined ? { role: f.role } : {}),
      ...(f.screen !== undefined ? { screen: f.screen } : {}),
    });
    if (saved === null) written++;
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

/**
 * Put the questions in the given order. Keys left out keep their relative
 * order after the named ones; unknown keys are ignored. Like any reorder, this
 * makes the form the tenant's own.
 */
export async function reorderAppointmentFields(userId: string, keys: string[]): Promise<void> {
  const fields = await prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } });
  const wanted = keys.filter((k, i) => keys.indexOf(k) === i && fields.some((f) => f.key === k));
  const rest = fields.filter((f) => !wanted.includes(f.key)).map((f) => f.key);
  const order = [...wanted, ...rest];
  await prisma.$transaction(
    order.map((key, i) =>
      prisma.appointmentField.update({ where: { userId_key: { userId, key } }, data: { order: i } }),
    ),
  );
  await claimForm(userId);
}

/**
 * Put a question on a screen — with the questions already there, or on a new
 * one. Which screen a field is on never changes where it sits in the order;
 * the flow (BookingSettings.flow) says when each screen is asked.
 */
export async function setFieldScreen(userId: string, key: string, screen: number): Promise<void> {
  if (!Number.isInteger(screen) || screen < 1) return;
  await prisma.appointmentField.updateMany({ where: { userId, key }, data: { screen } });
  await claimForm(userId);
}

/**
 * Compact the screens to 1..m, numbered by first appearance in field order,
 * so a deleted or moved question never leaves a gap. Fields keep their order:
 * a screen number is a grouping, not a position, and never sorts against it.
 */
export async function renumberScreens(userId: string): Promise<void> {
  const fields = await prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } });
  const numbered = new Map<number, number>();
  const writes = [];
  for (const f of fields) {
    // A row from before screens existed (0) is a screen of its own.
    const current = f.screen >= 1 ? f.screen : -(f.order + 1);
    let next = numbered.get(current);
    if (next === undefined) {
      next = numbered.size + 1;
      numbered.set(current, next);
    }
    if (next !== f.screen) writes.push(prisma.appointmentField.update({ where: { id: f.id }, data: { screen: next } }));
  }
  if (writes.length) await prisma.$transaction(writes);
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

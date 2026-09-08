import { prisma, getProfile } from "./db";
import { FIELD_TYPES, type FieldType, type AppointmentFieldRow, type BookingConfig } from "./appointmentTypes";
import { indexAppointment } from "./retrieval/origins";
import { dropOrigin } from "./retrieval/indexer";

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
}): AppointmentFieldRow {
  return {
    key: f.key,
    label: f.label,
    type: (FIELD_TYPES as readonly string[]).includes(f.type) ? (f.type as FieldType) : "short_text",
    required: f.required,
    order: f.order,
  };
}

export async function getBookingConfig(userId: string): Promise<BookingConfig> {
  const [profile, fields] = await Promise.all([
    getProfile(userId),
    prisma.appointmentField.findMany({ where: { userId }, orderBy: { order: "asc" } }),
  ]);
  return { enabled: profile.bookingEnabled, fields: fields.map(toFieldRow) };
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

const keyFromLabel = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);

/** Create or update one field. Returns an error string, or null on success. */
export async function saveAppointmentField(
  userId: string,
  input: { key?: string; label: string; type: string; required: boolean },
): Promise<string | null> {
  const label = input.label.trim().slice(0, 120);
  if (!label) return "The question needs a label.";
  const key = (input.key?.trim() || keyFromLabel(label)).slice(0, 60);
  if (!/^[a-z0-9_]+$/.test(key)) return "Field keys are lowercase letters, digits, and _ only.";
  const type = (FIELD_TYPES as readonly string[]).includes(input.type)
    ? input.type
    : "short_text";
  const last = await prisma.appointmentField.findFirst({
    where: { userId },
    orderBy: { order: "desc" },
  });
  await prisma.appointmentField.upsert({
    where: { userId_key: { userId, key } },
    update: { label, type, required: input.required },
    create: { userId, key, label, type, required: input.required, order: (last?.order ?? -1) + 1 },
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

/**
 * The one write path for a booking, shared by the API route and anything
 * later. Fail closed: every uncertain state is a rejection with a reason.
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

  // Keep only answers to questions that exist; reject a missing required one.
  const answers: Record<string, string> = {};
  for (const f of fields) {
    const v = String(input.answers?.[f.key] ?? "").trim().slice(0, 2000);
    if (f.required && !v) return { ok: false, error: `"${f.label}" is required.` };
    if (v) answers[f.key] = v;
  }

  try {
    const row = await prisma.appointment.create({
      data: { userId, startsAt, answers: JSON.stringify(answers) },
    });
    // Best-effort: an indexing failure must never lose the booking.
    await indexAppointment(userId, row.id).catch(() => {});
    return { ok: true, id: row.id };
  } catch (e) {
    // The unique (userId, startsAt) constraint is the race guard.
    if (e && typeof e === "object" && (e as { code?: string }).code === "P2002") {
      return { ok: false, error: "That time was just taken — pick another." };
    }
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

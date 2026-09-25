import { prisma, getProfile } from "./db";
import {
  FIELD_TYPES,
  isChoiceType,
  isFieldRole,
  keyFromLabel,
  parseFieldConfig,
  sanitizeFieldConfig,
  type FieldConfig,
  type FieldRole,
  type FieldType,
  type AppointmentFieldRow,
  type BookingConfig,
} from "./appointmentTypes";

/**
 * The form store: the per-tenant booking toggle and the field catalog the
 * booking cards ask from. Data only — the booking card is hydrated in
 * lib/cards.ts and rendered in app/cards/; the booking itself (validation,
 * the race, the calendar rows) is lib/booking/store.ts's createBooking.
 *
 * The form is the business's own: what is stored is what is asked, in the
 * stored order — nothing seeded on enable, nothing rewritten on read. A
 * field's `role` says which answer is the customer's name/email/phone; its
 * `screen` says which questions are asked together. Onboarding writes a
 * transcribed form through lib/booking/formSpec.ts, and only while the form
 * is untouched (`isUntouchedForm`).
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
 * Nobody has edited this form, so onboarding may rewrite it: it is empty, or
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
  // Answers are read by key off a plain object: a key that names something
  // every object already has would read a function, not an answer.
  if (key in Object.prototype) return "That key is reserved — pick another.";
  const type = (FIELD_TYPES as readonly string[]).includes(input.type)
    ? input.type
    : "short_text";
  // `config` left out means "keep what's stored" — a caller renaming a
  // question shouldn't have to resend its menu to avoid wiping it.
  const config = input.config === undefined ? undefined : sanitizeFieldConfig(type, input.config);
  if (config && isChoiceType(type) && !config.options?.length) {
    return "A choice question needs at least one option.";
  }
  // Onboarding's own writes are marked so it may rewrite them later; any other
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

/** The tenant has edited their form: nothing in it is onboarding's to rewrite. */
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

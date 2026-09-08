/**
 * The appointment shapes, with no imports.
 *
 * These live apart from lib/appointments.ts because the admin Calendar is a
 * client component: importing the shapes from the store would pull Prisma and
 * the Anthropic SDK (via the retrieval indexer) into the client bundle and
 * break the build. Types alone are erased at compile time, but FIELD_TYPES is
 * a real value the field editor renders its <select> from, so it has to come
 * from somewhere the client can safely reach.
 */

export const FIELD_TYPES = ["short_text", "long_text", "email", "phone"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type AppointmentFieldRow = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  order: number;
};

export type BookingConfig = { enabled: boolean; fields: AppointmentFieldRow[] };

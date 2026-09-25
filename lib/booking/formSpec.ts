import { prisma } from "../db";
import { getBookingConfig, isUntouchedForm } from "../appointments";
import { isChoiceType, isFieldRole, keyFromLabel, sanitizeFieldConfig, type FieldConfig, type FieldType } from "../appointmentTypes";
import type { FormSpec } from "../onboarding/formTranscribe";
import { seedStaff } from "../onboarding/bookingSeed";
import { listStaff, saveBookingSettings } from "./store";
import type { BookingSettings, FlowStep } from "./types";

/**
 * A transcribed booking form (lib/onboarding/formTranscribe.ts FormSpec)
 * written into a tenant: one AppointmentField row per field, in the form's
 * own order, on the form's own screens, with the form's own words; the flow
 * (BookingSettings.flow) in the form's own step order. Nothing is added,
 * renamed, merged, reordered or dropped on the way — the one coercion is a
 * choice question the form listed no options for, which becomes a text box
 * because a menu with nothing on it cannot be answered.
 *
 * The only gate is the tenant's: a form somebody has edited is theirs and is
 * never rewritten (lib/appointments.ts `isUntouchedForm`). Never throws — a
 * failure is logged and the counts say what was written.
 */

const errMsg = (err: unknown): string => (err instanceof Error ? err.message.slice(0, 160) : String(err));

/**
 * A unique, form-safe key per field: the label's key, `q<n>` when the label
 * yields none (or names an Object.prototype member — "Constructor" would
 * otherwise read `answers.constructor`), `_2`/`_3`… on a collision.
 */
export function specKeys(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label, i) => {
    const own = keyFromLabel(label);
    const base = own && !(own in Object.prototype) ? own : `q${i + 1}`;
    let key = base;
    for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 60 - String(n).length - 1)}_${n}`;
    taken.add(key);
    return key;
  });
}

/** The staff rule the form implies: never a change to what an owner set by hand. */
function staffSelectionFor(spec: FormSpec): BookingSettings["staffSelection"] {
  if (spec.anyStaffOffered) return "optional";
  if (spec.steps.some((s) => s.kind === "provider")) return "required";
  return "hidden";
}

export async function writeFormSpec(
  userId: string,
  spec: FormSpec,
  log: (m: string) => void = () => {},
): Promise<{ fields: number; steps: number; staff: number }> {
  const out = { fields: 0, steps: 0, staff: 0 };
  if (!spec.found) return out;

  try {
    const { fields: existing } = await getBookingConfig(userId);
    if (!isUntouchedForm(existing)) {
      log("Booking form: yours has been edited by hand, so the site's form was not copied over it");
      return out;
    }
  } catch (err) {
    log(`Booking form: couldn't read the form on file — ${errMsg(err)}`);
    return out;
  }

  // The fields, in one transaction: the old generated rows go, the copied
  // ones come, or neither.
  const keys = specKeys(spec.fields.map((f) => f.label));
  const rows = spec.fields.map((f, i) => {
    // The one coercion: a choice question with nothing to choose from.
    const type: FieldType = isChoiceType(f.type) && f.options.length === 0 ? "short_text" : f.type;
    const config: FieldConfig = {
      ...sanitizeFieldConfig(type, {
        options: f.options.map((label) => ({ label })),
        allowOther: f.allowOther,
        min: f.min,
        max: f.max,
        text: f.text,
        placeholder: f.placeholder,
        help: f.help,
      }),
      generated: true,
    };
    return {
      userId,
      key: keys[i],
      label: f.label.slice(0, 120),
      type,
      required: f.required,
      order: i,
      role: isFieldRole(f.role) ? f.role : "none",
      screen: f.screen >= 1 ? f.screen : 1,
      config: JSON.stringify(config),
    };
  });
  try {
    await prisma.$transaction([
      prisma.appointmentField.deleteMany({ where: { userId } }),
      ...rows.map((data) => prisma.appointmentField.create({ data })),
    ]);
    out.fields = rows.length;
  } catch (err) {
    log(`Booking form: couldn't write the copied questions — ${errMsg(err)}`);
    return out;
  }

  // The flow, in the form's own order; the staff rule only while the tenant
  // has no providers of their own (a hand-written roster means a hand-set rule).
  try {
    const flow: FlowStep[] = spec.steps.map((s) => {
      const step: FlowStep = { kind: s.kind };
      if (s.title) step.title = s.title;
      if (s.kind === "questions" && s.screen !== undefined) step.screen = s.screen;
      return step;
    });
    const patch: Partial<BookingSettings> = { flow };
    if ((await listStaff(userId)).length === 0) patch.staffSelection = staffSelectionFor(spec);
    await saveBookingSettings(userId, patch);
    out.steps = flow.length;
  } catch (err) {
    log(`Booking form: couldn't save the step order — ${errMsg(err)}`);
  }

  // The people the provider screen listed, only when the tenant has none.
  // The provider screen's "Any available" choice is a rule (staffSelection),
  // not a person: only names become providers.
  const people = spec.staff.filter((name) => !/\b(any|anyone|anybody|no preference|first available)\b/i.test(name));
  if (people.length) {
    const seeded = await seedStaff(userId, people.map((name) => ({ name, bio: "" })), [], log);
    out.staff = seeded.seeded;
  }
  return out;
}

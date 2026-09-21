import { keyFromLabel, type FieldConfig, type FieldType } from "./appointmentTypes";
import { SERVICE_PICKER_KEY, servicePickerField, type MenuService } from "./bookingMenu";

/**
 * The booking form a business would have built itself, from what onboarding
 * learned: ask what the business asks when it takes a booking, and where the
 * site is silent, what that kind of business normally asks. Evidence from the
 * site always beats a norm. Pure — no store, no model — so the rules can be
 * read and proven in one place. docs/features/booking-form-planner/FEATURE.md
 * has the table this encodes and the real booking page it was checked against.
 */

export const BOOKING_KINDS = [
  "personal_service", // salon, spa, barber, clinic, studio: you book a person's time
  "table", // restaurant, bar, café
  "home_service", // trades, cleaning, repair: they come to you
  "class", // classes, tours, events: you book places
  "consultation", // agencies, advisers, coaches: you book a conversation
  "other",
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** What the site says about a contact detail; "unknown" defers to the norm. */
export type ContactNeed = "required" | "optional" | "unknown";

export type PlanRequirement = { label: string; type: FieldType; required: boolean; options: string[] };

export type BookingFacts = {
  kind: BookingKind;
  services: MenuService[];
  /** People a customer can ask for, by the names the site uses. */
  staff: string[];
  phone: ContactNeed;
  email: ContactNeed;
  /** The site's own booking takes a free-text note. */
  notes: boolean;
  requirements: PlanRequirement[];
};

export type PlannedField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  config?: FieldConfig;
};

/** Past this a wizard stops being quicker than a phone call. */
export const MAX_QUESTIONS = 8;
export const ANY_STAFF = "Any available";

const NAME: PlannedField = { key: "name", label: "Your name", type: "short_text", required: true };
const REASON: PlannedField = { key: "reason", label: "What would you like to talk about?", type: "long_text", required: false };

type Norm = {
  phone: "required" | "optional" | null;
  email: "required" | "optional" | null;
  /** The specifics this kind of booking can't be taken without. */
  extras: PlannedField[];
  notes: string | null;
};

const NORMS: Record<BookingKind, Norm> = {
  // They text or call to confirm and to say they're running late.
  personal_service: { phone: "required", email: "optional", extras: [], notes: "Anything we should know before your visit?" },
  table: {
    phone: "required",
    email: "optional",
    extras: [{ key: "party_size", label: "How many people?", type: "number", required: true, config: { min: 1, max: 20 } }],
    notes: "Any allergies or a special occasion?",
  },
  home_service: {
    phone: "required",
    email: "optional",
    extras: [
      { key: "address", label: "Where is the job?", type: "short_text", required: true },
      { key: "job", label: "What do you need done?", type: "long_text", required: true },
    ],
    notes: null,
  },
  class: {
    phone: "optional",
    email: "required",
    extras: [{ key: "attendees", label: "How many are coming?", type: "number", required: true, config: { min: 1, max: 30 } }],
    notes: "Anything we should know?",
  },
  consultation: { phone: "optional", email: "required", extras: [REASON], notes: null },
  other: { phone: null, email: "required", extras: [], notes: null },
};

const NOTES_FALLBACK = "Anything we should know?";

function contacts(facts: BookingFacts, norm: Norm): PlannedField[] {
  const need = (seen: ContactNeed, usual: Norm["phone"]) => (seen === "unknown" ? usual : seen);
  const out: PlannedField[] = [];
  const phone = need(facts.phone, norm.phone);
  const email = need(facts.email, norm.email);
  if (phone) out.push({ key: "phone", label: "Your phone number", type: "phone", required: phone === "required" });
  if (email) out.push({ key: "email", label: "Your email", type: "email", required: email === "required" });
  if (!out.length) out.push({ key: "email", label: "Your email", type: "email", required: true });
  // A booking nobody can be reached about isn't one.
  if (!out.some((f) => f.required)) out[0] = { ...out[0], required: true };
  return out.sort((a, b) => Number(b.required) - Number(a.required));
}

/** What an extracted requirement is really asking, when the plan already asks it. */
const REPEATS: { says: RegExp; covered: (plan: PlannedField[]) => boolean }[] = [
  { says: /\bname\b/i, covered: () => true },
  // The wizard's last step is always "when".
  { says: /\b(dates?|times?|days?|when)\b/i, covered: () => true },
  { says: /phone|mobile|cell|\btel\b/i, covered: (p) => p.some((f) => f.type === "phone") },
  { says: /e-?mail/i, covered: (p) => p.some((f) => f.type === "email") },
  { says: /party|guests?|people|attend|how many|number of/i, covered: (p) => p.some((f) => f.type === "number") },
  { says: /address|location of/i, covered: (p) => p.some((f) => f.key === "address") },
  { says: /services?|treatments?/i, covered: (p) => p.some((f) => f.key === SERVICE_PICKER_KEY) },
  { says: /staff|stylist|technician|therapist|barber|provider|artist/i, covered: (p) => p.some((f) => f.key === "staff") },
  { says: /notes?|comments?|requests?|anything else|message/i, covered: (p) => p.some((f) => f.key === "notes" || f.type === "long_text") },
];

function staffQuestion(staff: string[]): PlannedField | null {
  const names = [...new Set(staff.map((s) => s.trim()).filter(Boolean))];
  if (!names.length) return null;
  return {
    key: "staff",
    label: "Who would you like to see?",
    type: "select",
    required: false,
    config: { options: [ANY_STAFF, ...names].map((label) => ({ label })) },
  };
}

/** The ordered questions: who → what → who with → the specifics → notes. */
export function planBookingForm(facts: BookingFacts): PlannedField[] {
  const norm = NORMS[facts.kind] ?? NORMS.other;
  const picker = servicePickerField(facts.services);
  const staff = facts.kind === "personal_service" ? staffQuestion(facts.staff) : null;

  const plan: PlannedField[] = [NAME, ...contacts(facts, norm)];
  if (picker) plan.push(picker);
  if (staff) plan.push(staff);
  plan.push(...norm.extras);

  const noteLabel = norm.notes ?? (facts.notes ? NOTES_FALLBACK : null);
  // A long answer is already being asked for; a second box is one too many.
  const notes: PlannedField | null =
    noteLabel && !plan.some((f) => f.type === "long_text")
      ? { key: "notes", label: noteLabel, type: "long_text", required: false }
      : null;

  const taken = new Set(plan.map((f) => f.key));
  const covered = notes ? [...plan, notes] : plan;
  const room = MAX_QUESTIONS - covered.length;
  const extracted: PlannedField[] = [];
  for (const r of facts.requirements) {
    if (extracted.length >= room) break;
    const key = keyFromLabel(r.label.trim().slice(0, 120));
    if (!key || taken.has(key)) continue;
    if (REPEATS.some((x) => x.says.test(r.label) && x.covered(covered))) continue;
    taken.add(key);
    const choice = r.type === "select" || r.type === "multi_select";
    extracted.push({
      key,
      label: r.label,
      type: r.type,
      required: r.required,
      // The site's list is what it happened to name, not a closed set.
      ...(choice ? { config: { options: r.options.map((label) => ({ label })), allowOther: true } } : {}),
    });
  }
  plan.push(...extracted);

  // "reason" is the generic catch-all: only when nothing more specific was asked.
  if (facts.kind === "other" && !picker && !extracted.length) return [...plan, REASON];
  return notes ? [...plan, notes] : plan;
}

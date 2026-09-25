import { keyFromLabel, type FieldConfig, type FieldRole, type FieldType } from "./appointmentTypes";
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
  /** Which answer is the customer's name/email/phone (FIELD_ROLES); `none` for a question. */
  role: FieldRole;
  /** The contact details share screen 1; every other question gets its own, in plan order. */
  screen: number;
};

/** A planned question before its screen is known. */
type Draft = Omit<PlannedField, "role" | "screen"> & { role?: FieldRole };

/** Past this a wizard stops being quicker than a phone call. */
export const MAX_QUESTIONS = 8;
export const ANY_STAFF = "Any available";

const NAME: Draft = { key: "name", label: "Your name", type: "short_text", required: true, role: "name" };
const REASON: Draft = { key: "reason", label: "What would you like to talk about?", type: "long_text", required: false };

type Norm = {
  phone: "required" | "optional" | null;
  email: "required" | "optional" | null;
  /** The specifics this kind of booking can't be taken without. */
  extras: Draft[];
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

function contacts(facts: BookingFacts, norm: Norm): Draft[] {
  const need = (seen: ContactNeed, usual: Norm["phone"]) => (seen === "unknown" ? usual : seen);
  const out: Draft[] = [];
  const phone = need(facts.phone, norm.phone);
  const email = need(facts.email, norm.email);
  if (phone) out.push({ key: "phone", label: "Your phone number", type: "phone", required: phone === "required", role: "phone" });
  if (email) out.push({ key: "email", label: "Your email", type: "email", required: email === "required", role: "email" });
  if (!out.length) out.push({ key: "email", label: "Your email", type: "email", required: true, role: "email" });
  // A booking nobody can be reached about isn't one.
  if (!out.some((f) => f.required)) out[0] = { ...out[0], required: true };
  return out.sort((a, b) => Number(b.required) - Number(a.required));
}

/** What an extracted requirement is really asking, when the plan already asks it. */
const REPEATS: { says: RegExp; covered: (plan: Draft[]) => boolean }[] = [
  { says: /\bname\b/i, covered: () => true },
  // The wizard's last step is always "when".
  { says: /\b(dates?|times?|days?|when)\b/i, covered: () => true },
  { says: /phone|mobile|cell|\btel\b/i, covered: (p) => p.some((f) => f.type === "phone") },
  { says: /e-?mail/i, covered: (p) => p.some((f) => f.type === "email") },
  { says: /party|guests?|people|attend|how many|number of/i, covered: (p) => p.some((f) => f.type === "number") },
  // The wizard has no file question; a text box labelled "Upload photos" is worse than none.
  { says: /upload|photos?|pictures?|attach|\bfiles?\b/i, covered: () => true },
  {
    says: /address|location of|where is|job site|\b(city|town|state|zip|postal|postcode)\b/i,
    covered: (p) => p.some((f) => f.key === "address"),
  },
  {
    says: /need(s|ed)? (done|help)|describe|details? (of|about)|tell us (about|more)|(project|job) description/i,
    covered: (p) => p.some((f) => f.key === "job" || f.key === "reason"),
  },
  { says: /services?|treatments?/i, covered: (p) => p.some((f) => f.key === SERVICE_PICKER_KEY) },
  { says: /staff|stylist|technician|therapist|barber|provider|artist/i, covered: (p) => p.some((f) => f.key === "staff") },
  { says: /notes?|comments?|requests?|anything else|message/i, covered: (p) => p.some((f) => f.key === "notes" || f.type === "long_text") },
];

function staffQuestion(staff: string[]): Draft | null {
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

/**
 * Screens and roles: the contact details (name, phone, email) sit together on
 * screen 1, the way a details step reads; every other question gets a screen
 * of its own, in plan order. A question with no role is `none`.
 */
function laidOut(drafts: Draft[]): PlannedField[] {
  const contact = (d: Draft) => d.role === "name" || d.role === "phone" || d.role === "email";
  let next = 2;
  return drafts.map((d) => ({ ...d, role: d.role ?? "none", screen: contact(d) ? 1 : next++ }));
}

/** The ordered questions: who → what → who with → the specifics → notes. */
export function planBookingForm(facts: BookingFacts): PlannedField[] {
  const norm = NORMS[facts.kind] ?? NORMS.other;
  // A restaurant's "services" are its dishes, and nobody books a table by the plate.
  const picker = facts.kind === "table" ? null : servicePickerField(facts.services);
  const staff = facts.kind === "personal_service" ? staffQuestion(facts.staff) : null;

  const plan: Draft[] = [NAME, ...contacts(facts, norm)];
  if (picker) plan.push(picker);
  if (staff) plan.push(staff);
  plan.push(...norm.extras);

  const noteLabel = norm.notes ?? (facts.notes ? NOTES_FALLBACK : null);
  // A long answer is already being asked for; a second box is one too many.
  const notes: Draft | null =
    noteLabel && !plan.some((f) => f.type === "long_text")
      ? { key: "notes", label: noteLabel, type: "long_text", required: false, role: "notes" }
      : null;

  const taken = new Set(plan.map((f) => f.key));
  const covered = notes ? [...plan, notes] : plan;
  const room = MAX_QUESTIONS - covered.length;
  const extracted: Draft[] = [];
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
  if (facts.kind === "other" && !picker && !extracted.length) return laidOut([...plan, REASON]);
  return laidOut(notes ? [...plan, notes] : plan);
}

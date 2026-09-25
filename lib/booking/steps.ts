import type { BookingFlow } from "./types";
import { CUSTOMER_FIELD_LABELS } from "./types";
import type { AppointmentFieldRow } from "../appointmentTypes";

/**
 * The booking form as a list of the steps a visitor walks through — what the
 * onboarding chat's booking-form step shows beside the live card, and what
 * the form-editing model is told the form currently asks. Pure, import-free
 * apart from types and one label table, so the client and the server describe
 * the same form the same way.
 *
 * The list follows the card's own order (app/cards/booking/BookingFlowCard.tsx
 * computeSteps): service → options → provider → location → time → your
 * details → each intake question → review. A step the card only shows for
 * some selections (options, a conditional question) is still listed, with a
 * note, so the owner sees every question the form can ask.
 */

export type FormStep = {
  /** Stable id for diffing one version of the form against the next. */
  id: string;
  kind: "service" | "options" | "provider" | "location" | "time" | "details" | "question" | "review";
  title: string;
  /** What the step asks or offers, one line. */
  detail: string;
  /** Present on an intake question: the row it was built from. */
  question?: { key: string; type: string; required: boolean };
};

/** The wire shape of the form the onboarding step reads and re-reads. */
export type BookingFormSummary = {
  slug: string;
  enabled: boolean;
  flow: BookingFlow | null;
  /** The intake questions the card asks (name/email/phone already moved to the details step). */
  fields: AppointmentFieldRow[];
  steps: FormStep[];
};

const TYPE_WORDS: Record<string, string> = {
  short_text: "short answer",
  long_text: "a few lines",
  email: "email",
  phone: "phone number",
  select: "pick one",
  multi_select: "pick any",
  number: "a number",
  yes_no: "yes / no",
  date: "a date",
  address: "an address",
  file: "file upload",
  photo: "photo upload",
  signature: "signature",
  waiver: "agree to a waiver",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function questionDetail(f: AppointmentFieldRow): string {
  const parts: string[] = [];
  const n = f.config.options?.length ?? 0;
  if ((f.type === "select" || f.type === "multi_select") && n) {
    parts.push(`${TYPE_WORDS[f.type]} of ${plural(n, "option")}${f.config.allowOther ? ", or something else" : ""}`);
  } else if (f.type === "number" && (f.config.min !== undefined || f.config.max !== undefined)) {
    parts.push(`a number${f.config.min !== undefined ? ` from ${f.config.min}` : ""}${f.config.max !== undefined ? ` to ${f.config.max}` : ""}`);
  } else {
    parts.push(TYPE_WORDS[f.type] ?? f.type);
  }
  parts.push(f.required ? "required" : "optional");
  if (f.config.showIf) {
    const when = f.config.showIf.values.length ? ` is ${f.config.showIf.values.join(" or ")}` : " is answered";
    parts.push(`only when "${f.config.showIf.key}"${when}`);
  }
  return parts.join(" · ");
}

/**
 * The steps of the form as the card will ask them. `flow` null means booking
 * is off (no steps at all) — the step list says so rather than listing a
 * form nobody can reach.
 */
export function describeBookingSteps(flow: BookingFlow | null, fields: AppointmentFieldRow[]): FormStep[] {
  if (!flow) return [];
  const steps: FormStep[] = [];

  if (flow.services.length) {
    const cats = flow.categories.length;
    steps.push({
      id: "service",
      kind: "service",
      title: "Pick a service",
      detail: `${plural(flow.services.length, "service")}${cats > 1 ? ` in ${plural(cats, "section")}` : ""}, with prices and durations`,
    });
    const withOptions = flow.services.filter(
      (s) => s.variants.length || s.addons.length || ["per_person", "per_unit", "hourly"].includes(s.pricing.kind),
    );
    if (withOptions.length) {
      steps.push({
        id: "options",
        kind: "options",
        title: "Options and add-ons",
        detail: `only for ${plural(withOptions.length, "service")} with variants, add-ons or per-person pricing`,
      });
    }
  }

  if (flow.rules.staffSelection !== "hidden" && flow.staff.length) {
    steps.push({
      id: "provider",
      kind: "provider",
      title: "Choose who you'd like to see",
      detail: `${plural(flow.staff.length, "provider")}${flow.rules.staffSelection === "optional" ? ", or anyone available" : " — one must be chosen"}`,
    });
  }

  const realChoice = flow.locations.length > 1 || flow.locations.some((l) => l.kind !== "business");
  if (realChoice) {
    steps.push({
      id: "location",
      kind: "location",
      title: "Where",
      detail: flow.locations.map((l) => l.name).filter(Boolean).join(", ") || plural(flow.locations.length, "location"),
    });
  }

  steps.push({ id: "time", kind: "time", title: "Date and time", detail: "live availability from your hours" });

  const asked = flow.rules.customerFields.filter((f) => f.enabled);
  steps.push({
    id: "details",
    kind: "details",
    title: "Your details",
    detail: asked
      .map((f) => `${f.label || CUSTOMER_FIELD_LABELS[f.key]}${f.required ? "*" : ""}`)
      .join(", "),
  });

  for (const f of fields) {
    steps.push({
      id: `q:${f.key}`,
      kind: "question",
      title: f.label,
      detail: questionDetail(f),
      question: { key: f.key, type: f.type, required: f.required },
    });
  }

  steps.push({
    id: "review",
    kind: "review",
    title: "Review and confirm",
    detail: flow.rules.confirmation === "request" ? "sent as a request you confirm" : "booked on the spot",
  });
  return steps;
}

/** Which steps changed between two versions: for marking the re-shown form. */
export function diffSteps(before: FormStep[], after: FormStep[]): { added: string[]; changed: string[]; removed: string[] } {
  const prev = new Map(before.map((s) => [s.id, s]));
  const next = new Map(after.map((s) => [s.id, s]));
  const added: string[] = [];
  const changed: string[] = [];
  for (const s of after) {
    const p = prev.get(s.id);
    if (!p) added.push(s.id);
    else if (p.title !== s.title || p.detail !== s.detail) changed.push(s.id);
  }
  const removed = before.filter((s) => !next.has(s.id)).map((s) => s.id);
  return { added, changed, removed };
}

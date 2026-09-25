import type { BookingFlow } from "./types";
import { sanitizeFlow } from "./types";
import { locationChoiceReal, providerCandidates, screenFields } from "./flowSteps";
import type { AppointmentFieldRow, FieldRole } from "../appointmentTypes";

/**
 * The booking form as a list of the steps a visitor walks through — what the
 * onboarding chat's booking-form step shows beside the live card, and what
 * the form-editing model is told the form currently asks. Pure, import-free
 * apart from types and the flow planner's helpers, so the client and the
 * server describe the same form the same way.
 *
 * The order is the business's own (`flow.rules.flow`, resolved by
 * `sanitizeFlow` exactly as the card's planner resolves it): service (with
 * options right after it, when any service has them) → provider → location →
 * time → each screen of questions → review, or whatever order the business's
 * form uses, with review always last. A step the card only shows for some
 * selections (options, a conditional question) is still listed, with a note,
 * so the owner sees every question the form can ask. Contact details are
 * ordinary fields with a `role`; a screen holding several fields is one step.
 */

export type FormStepKind = "service" | "options" | "provider" | "location" | "time" | "screen" | "question" | "review";

/** One field as a step lists it: the row's essentials plus its one-line description. */
export type FormStepField = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  role: FieldRole;
  /** What the field asks, one line (type, required, range, "only when…"). */
  detail: string;
};

export type FormStep = {
  /** Stable id for diffing one version of the form against the next. */
  id: string;
  kind: FormStepKind;
  title: string;
  /** What the step asks or offers, one line. */
  detail: string;
  /** Present on a question or screen step: the screen number its fields share. */
  screen?: number;
  /** Present on a single-field question step: the row it was built from. */
  question?: { key: string; type: string; required: boolean; role: FieldRole };
  /** Present on a screen step: every field asked on that screen, in order. */
  fields?: FormStepField[];
};

/** The wire shape of the form the onboarding step reads and re-reads. */
export type BookingFormSummary = {
  slug: string;
  enabled: boolean;
  flow: BookingFlow | null;
  /** Every field the card asks, role-tagged and screen-grouped, in order. */
  fields: AppointmentFieldRow[];
  /** True when the form has no fields at all. */
  empty: boolean;
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

/** The type as the list says it: "pick one of 3 options", "a number from 1 to 8", "email". */
function typeWords(f: AppointmentFieldRow): string {
  const n = f.config.options?.length ?? 0;
  if ((f.type === "select" || f.type === "multi_select") && n) {
    return `${TYPE_WORDS[f.type]} of ${plural(n, "option")}${f.config.allowOther ? ", or something else" : ""}`;
  }
  if (f.type === "number" && (f.config.min !== undefined || f.config.max !== undefined)) {
    return `a number${f.config.min !== undefined ? ` from ${f.config.min}` : ""}${f.config.max !== undefined ? ` to ${f.config.max}` : ""}`;
  }
  return TYPE_WORDS[f.type] ?? f.type;
}

function onlyWhen(f: AppointmentFieldRow): string {
  if (!f.config.showIf) return "";
  const when = f.config.showIf.values.length ? ` is ${f.config.showIf.values.join(" or ")}` : " is answered";
  return `only when "${f.config.showIf.key}"${when}`;
}

function questionDetail(f: AppointmentFieldRow): string {
  return [typeWords(f), f.required ? "required" : "optional", onlyWhen(f)].filter(Boolean).join(" · ");
}

const starred = (f: AppointmentFieldRow) => `${f.label}${f.required ? "*" : ""}`;

/** One field's word on a screen step: "Email* · email", "Allergies · a few lines · only when…". */
const screenWord = (f: AppointmentFieldRow) => [starred(f), typeWords(f), onlyWhen(f)].filter(Boolean).join(" · ");

/**
 * The steps of the form as the card will ask them. `flow` null means booking
 * is off (no steps at all) — the step list says so rather than listing a
 * form nobody can reach.
 */
export function describeBookingSteps(flow: BookingFlow | null, fields: AppointmentFieldRow[]): FormStep[] {
  if (!flow) return [];
  const steps: FormStep[] = [];

  for (const step of sanitizeFlow(flow.rules.flow, fields)) {
    switch (step.kind) {
      case "service": {
        if (!flow.services.length) break;
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
        break;
      }
      case "provider": {
        const candidates = providerCandidates(flow, null);
        if (flow.rules.staffSelection === "hidden" || !candidates.length) break;
        steps.push({
          id: "provider",
          kind: "provider",
          title: "Choose who you'd like to see",
          detail: `${plural(candidates.length, "provider")}${flow.rules.staffSelection === "optional" ? ", or anyone available" : " — one must be chosen"}`,
        });
        break;
      }
      case "location": {
        if (!locationChoiceReal(flow, null)) break;
        steps.push({
          id: "location",
          kind: "location",
          title: "Where",
          detail: flow.locations.map((l) => l.name).filter(Boolean).join(", ") || plural(flow.locations.length, "location"),
        });
        break;
      }
      case "time":
        steps.push({ id: "time", kind: "time", title: "Date and time", detail: "live availability from your hours" });
        break;
      case "questions": {
        const screen = step.screen ?? -1;
        const onScreen = screenFields(fields, screen);
        if (!onScreen.length) break;
        if (onScreen.length === 1) {
          const f = onScreen[0];
          steps.push({
            id: `q:${f.key}`,
            kind: "question",
            title: f.label,
            detail: questionDetail(f),
            screen,
            question: { key: f.key, type: f.type, required: f.required, role: f.role },
          });
          break;
        }
        steps.push({
          id: `screen:${screen}`,
          kind: "screen",
          title: step.title || onScreen.map(starred).join(", "),
          detail: onScreen.map(screenWord).join(", "),
          screen,
          fields: onScreen.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
            role: f.role,
            detail: questionDetail(f),
          })),
        });
        break;
      }
      case "review":
        steps.push({
          id: "review",
          kind: "review",
          title: "Review and confirm",
          detail: flow.rules.confirmation === "request" ? "sent as a request you confirm" : "booked on the spot",
        });
        break;
    }
  }
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

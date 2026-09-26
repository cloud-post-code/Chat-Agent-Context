import { FIELD_TYPES, isFieldRole, type FieldRole, type FieldType } from "../appointmentTypes";
import { FLOW_KINDS, flat, text as multiline, type FlowStep } from "../booking/types";
import { safeJson } from "../util";
import { serializeSnapshot, snapshotIsEmpty, type FormSnapshot } from "./formReader";

/**
 * A business's booking form, transcribed verbatim from a rendered snapshot:
 * the steps in the order the form walks them, and every field with its label
 * as written, its type, whether it is required, its options as listed. This
 * is the one shape onboarding writes a form from (lib/booking/formSpec.ts).
 *
 * The rule the transcriber lives by: never add, rename, merge, reorder or
 * drop anything; never invent. The sanitizer below caps for safety and
 * nothing else.
 */

type SpecField = {
  /** As written on the form, asterisk removed. */
  label: string;
  type: FieldType;
  required: boolean;
  /** As listed, in order; empty for non-choice types. */
  options: string[];
  /** Only when the form itself offers "Other" / free text. */
  allowOther: boolean;
  role: FieldRole;
  /** The screen (1-based) the field sits on; fields sharing one are asked together. */
  screen: number;
  placeholder: string;
  help: string;
  /** number only. */
  min?: number;
  max?: number;
  /** waiver only: the policy text agreed to. */
  text?: string;
};

type SpecStep = {
  kind: FlowStep["kind"];
  /** The screen's heading as written ("How do we say hello?"); "" when it has none. */
  title: string;
  /** For `questions`: which screen's fields this step asks. */
  screen?: number;
};

export type FormSpec = {
  /** False when the page has no booking form to copy (a page that only says "call us"). */
  found: boolean;
  steps: SpecStep[];
  fields: SpecField[];
  /** Names the service and provider screens list — for checking, not for the form. */
  services: string[];
  staff: string[];
  /** True when the provider screen offers "any / anyone available". */
  anyStaffOffered: boolean;
};

export const EMPTY_FORM_SPEC: FormSpec = {
  found: false,
  steps: [],
  fields: [],
  services: [],
  staff: [],
  anyStaffOffered: false,
};

/** Safety caps only — never a normalization. */
const SPEC_CAPS = { fields: 60, options: 60, label: 200, placeholder: 120, help: 300, waiverText: 4000, steps: 12 } as const;

export type LlmFn = (system: string, corpus: string, maxTokens: number, onEvent?: (m: string) => void) => Promise<string>;

const FORM_SYSTEM_PROMPT = `You are given a business's online booking form exactly as it renders in a browser, one screen at a time. Each screen starts with "=== SCREEN <n> <url>" and lists its HEADINGS, its ELEMENTS (every visible input, choice group and tile list as "- [<tag>, <input type>] "<label>", required, placeholder "…", options: a | b | c"), its BUTTONS, and its visible TEXT. Your job is to transcribe this form VERBATIM into JSON so the business's own form can be rebuilt with the same steps, the same fields and the same words.

Steps — one "steps" entry per screen, in screen order, "screen" = the screen's number:
- "service": the screen's main content lists the business's services / treatments / menu items, usually with prices (tile lists of priced rows).
- "provider": a list of people to book with, or an "Any available" choice.
- "location": a choice of branch / location.
- "time": a calendar and/or time slots — a screen with a "- [calendar]" element (its options are the slots offered).
- "questions": a screen of inputs the customer fills in. "title" is the screen's heading exactly as written.
- "review": the final screen whose button books / submits / pays. Every form that can be booked ends with one — when that screen is also the last questions screen, list both for it, "questions" first, then "review" with the same "screen". A screen with nothing to answer or pick that only goes on ("Your appointment … Back / Next") is not a review and not a step: leave it out.
Never add a step the form doesn't show and never drop one it does. A screen that lists services AND a date picker is two steps in the order they appear. "title" is the screen's first heading as written, or "" when it has none.

Fields — EVERY input on every "questions" screen, in on-screen order, "screen" = that screen's number:
- "label": exactly as written on the form, with the required asterisk removed. Never rename, shorten, merge or reword.
- "required": exactly as the form marks it (the line says "required"); otherwise false.
- "type", one of ${FIELD_TYPES.join(", ")}:
  - email input → "email"; tel input → "phone". A plain text box whose label or placeholder asks for a phone number or an email address is "phone" / "email" too — the form asks for that, whatever the input's own type.
  - a single-line text box → "short_text"; a multi-line box (textarea) → "long_text".
  - a dropdown (select) or a radio group → "select"; a checkbox group → "multi_select".
  - a number input / a count (guests, people) → "number".
  - one checkbox → "yes_no", or "waiver" when it is an agreement ("I agree to…", "I accept…", "I have read…"): copy the policy paragraph from the screen's TEXT into "text".
  - a date input → "date".
  - a file input → "file", or "photo" when it asks for a photo / picture / image.
  - a signature pad → "signature".
  - a street address box → "address".
- "options": copied as listed, in order, for select / multi_select only; [] otherwise. Never invent an option.
- "allowOther": true only when the form itself offers "Other" / "something else" / a free-text alternative among the options.
- "placeholder" and "help": as shown, or "".
- "role": "name" when the one field asks for the whole name ("Full Name", "Your name"); "first_name" / "last_name" for split names; "email"; "phone"; "notes" for a free-text notes / comments / special requests box; "policy" for the agreement checkbox; else "none".
- "min" / "max" only for number when the form states them; otherwise 0.
A "Service" / "Stylist" / "Location" dropdown INSIDE a questions screen is a question (type "select", role "none"), not a step.
A box that searches or filters the screen's own list ("Search service", "Find a stylist") belongs to that list: never a field, and a screen with only such a box beside a menu or a list of names is that "service" / "provider" step, not "questions".

"services": the names the service screens list, as written (drop the price). "staff": the names the provider screen lists. "anyStaffOffered": true when the provider screen offers an "any / anyone available" choice.

"found": false when no screen has inputs, choices or a booking step (a page that only says "call us") — then every list is empty.

Rules: NEVER add, rename, merge, reorder or drop anything. NEVER invent an option, a label, a placeholder or a required flag. When unsure between two types, prefer the one closest to the input's own type. Copy text exactly, including capitalization and punctuation (a curly apostrophe stays curly).

Respond with ONLY this JSON, no other text:
{"found":true,"steps":[{"kind":"","title":"","screen":0}],"fields":[{"label":"","type":"short_text","required":false,"options":[],"allowOther":false,"role":"none","screen":1,"placeholder":"","help":"","min":0,"max":0,"text":""}],"services":[],"staff":[],"anyStaffOffered":false}`;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const bool = (v: unknown): boolean =>
  typeof v === "boolean" ? v : typeof v === "string" ? /^(true|yes|1)$/i.test(v.trim()) : typeof v === "number" ? v !== 0 : false;
/** A string the model meant as one line; numbers are spelled, everything else is "". */
const str = (v: unknown, max: number): string => flat(typeof v === "number" ? String(v) : v, max);
const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const screenNo = (v: unknown): number | undefined => {
  const n = num(v);
  return n === undefined || n < 1 ? undefined : Math.floor(n);
};
const strings = (v: unknown, max: number, each: number): string[] =>
  Array.isArray(v) ? v.map((s) => str(s, each)).filter(Boolean).slice(0, max) : [];

/** Model output → a FormSpec: caps applied, unknown types/roles defaulted, screens renumbered 1..n in first-seen order. Never throws. */
export function sanitizeFormSpec(raw: unknown): FormSpec {
  const src = obj(raw);
  if (!src || !bool(src.found)) return EMPTY_FORM_SPEC;

  type Step = SpecStep & { screen?: number };
  const steps: Step[] = [];
  for (const s of Array.isArray(src.steps) ? src.steps.slice(0, SPEC_CAPS.steps) : []) {
    const o = obj(s);
    const kind = str(o?.kind, 20);
    if (!o || !(FLOW_KINDS as readonly string[]).includes(kind)) continue;
    const step: Step = { kind: kind as FlowStep["kind"], title: str(o.title, SPEC_CAPS.label) };
    const screen = screenNo(o.screen);
    if (screen !== undefined) step.screen = screen;
    steps.push(step);
  }

  const fields: SpecField[] = [];
  for (const f of Array.isArray(src.fields) ? src.fields.slice(0, SPEC_CAPS.fields) : []) {
    const o = obj(f);
    if (!o) continue;
    const label = str(o.label, SPEC_CAPS.label);
    if (!label) continue;
    const typeRaw = str(o.type, 30);
    const type = (FIELD_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as FieldType) : "short_text";
    const roleRaw = str(o.role, 30);
    const field: SpecField = {
      label,
      type,
      required: bool(o.required),
      options: strings(o.options, SPEC_CAPS.options, SPEC_CAPS.label),
      allowOther: bool(o.allowOther),
      role: isFieldRole(roleRaw) ? roleRaw : "none",
      screen: screenNo(o.screen) ?? 0,
      placeholder: str(o.placeholder, SPEC_CAPS.placeholder),
      help: str(o.help, SPEC_CAPS.help),
    };
    if (type === "number") {
      const min = num(o.min);
      const max = num(o.max);
      if (min !== undefined) field.min = min;
      if (max !== undefined) field.max = max;
    }
    if (type === "waiver") {
      const t = multiline(o.text, SPEC_CAPS.waiverText);
      if (t) field.text = t;
    }
    fields.push(field);
  }

  // Screens as the model numbered them → 1..n in first-seen order, steps
  // first so a field keeps sitting on the step that asks it. A field with no
  // screen joins the last numbered one (or screen 1).
  const order = new Map<number, number>();
  const renumber = (n: number) => {
    if (!order.has(n)) order.set(n, order.size + 1);
    return order.get(n)!;
  };
  for (const s of steps) if (s.screen !== undefined) s.screen = renumber(s.screen);
  let last = 0;
  for (const f of fields) {
    if (f.screen > 0) last = f.screen;
    f.screen = renumber(f.screen > 0 ? f.screen : last || 1);
  }

  return {
    found: true,
    steps,
    fields,
    services: strings(src.services, 500, SPEC_CAPS.label),
    staff: strings(src.staff, 200, SPEC_CAPS.label),
    anyStaffOffered: bool(src.anyStaffOffered),
  };
}

/** The production model call, as the extractors make it: retries, the shared gate, JSON out. */
const defaultLlm: LlmFn = async (system, corpus, maxTokens, onEvent) => {
  const { llmExtract } = await import("./knowledgeLlm");
  return JSON.stringify(await llmExtract(system, corpus, maxTokens, onEvent ?? (() => {})));
};

/** One model call over the serialized snapshot. An empty snapshot short-circuits to `found: false` with no call. */
export async function transcribeForm(
  snapshot: FormSnapshot,
  deps: { llm?: LlmFn } = {},
  onEvent?: (m: string) => void,
): Promise<FormSpec> {
  if (snapshotIsEmpty(snapshot)) return EMPTY_FORM_SPEC;
  const llm = deps.llm ?? defaultLlm;
  onEvent?.(`Transcribing the booking form (${snapshot.screens.length} screen${snapshot.screens.length === 1 ? "" : "s"})`);
  const reply = await llm(FORM_SYSTEM_PROMPT, serializeSnapshot(snapshot), 8000, onEvent);
  const parsed = safeJson<unknown>(reply.match(/\{[\s\S]*\}/)?.[0], null);
  if (parsed === null) {
    onEvent?.("Booking form transcription returned no JSON");
    return EMPTY_FORM_SPEC;
  }
  return sanitizeFormSpec(parsed);
}

import type { FieldRole, FieldType } from "../appointmentTypes";
import type { FlowStep } from "../booking/types";
import type { FormSnapshot } from "./formReader";

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

export type SpecField = {
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

export type SpecStep = {
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
export const SPEC_CAPS = { fields: 60, options: 60, label: 200, placeholder: 120, help: 300, waiverText: 4000, steps: 12 } as const;

export type LlmFn = (system: string, corpus: string, maxTokens: number, onEvent?: (m: string) => void) => Promise<string>;

export const FORM_SYSTEM_PROMPT = "";

/** Model output → a FormSpec: caps applied, unknown types/roles defaulted, screens renumbered 1..n in first-seen order. Never throws. */
export function sanitizeFormSpec(raw: unknown): FormSpec {
  void raw;
  // Contract stub — implemented in the reader phase.
  return EMPTY_FORM_SPEC;
}

/** One model call over the serialized snapshot. An empty snapshot short-circuits to `found: false` with no call. */
export async function transcribeForm(
  snapshot: FormSnapshot,
  deps: { llm?: LlmFn } = {},
  onEvent?: (m: string) => void,
): Promise<FormSpec> {
  void snapshot;
  void deps;
  void onEvent;
  return EMPTY_FORM_SPEC;
}

"use client";

import { useState } from "react";
import { resolveAnswer } from "@/lib/appointmentTypes";
import type { CardStep, FlowField } from "@/lib/booking/flowSteps";
import { QuestionInput, hasAnswer, type Answer, type Answers } from "../BookingQuestion";
import { headingStyle, inputStyle, linkBtn, liveBtn } from "./ui";
import { stepFrame } from "./ServiceStep";

export type ScreenCardStep = Extract<CardStep, { kind: "screen" }>;

/** The text types this step draws itself, so each box can carry the business's own placeholder. */
const PLAIN_TEXT = new Set(["short_text", "long_text", "email", "phone"]);

/**
 * One screen of the business's own form: every field that shares the screen
 * number, asked together in order — the migrated "Your details" screen
 * (first name, last name, email, phone, a consent) or a single question, the
 * card cannot tell the difference. The server's own resolveAnswer decides
 * whether an answer is valid, so the verdict the server would give shows here
 * before the round trip; a required field with no answer is the other reason
 * Next stays put. Errors appear after the first Next press, the way a form
 * does, not while the visitor is still typing.
 */
export function ScreenStep({
  step,
  answers,
  setAnswer,
  slug,
  onNext,
  onBack,
  nextLabel,
  locked = false,
}: {
  step: ScreenCardStep;
  answers: Answers;
  setAnswer: (key: string, value: Answer) => void;
  slug: string;
  onNext: () => void;
  /** Left out when earlier steps stay editable in the thread: no Back button. */
  onBack?: () => void;
  /** "Next" by default; a step already answered reads "Update". */
  nextLabel?: string;
  /** The booking is done (or abandoned): controls disabled, no button. */
  locked?: boolean;
}) {
  const [touched, setTouched] = useState(false);

  const rows = step.fields.map((field) => {
    const value = answers[field.key];
    const answered = hasAnswer(field, value);
    const verdict = resolveAnswer({ label: field.label, type: field.type, config: field.config ?? {} }, value);
    const error = !verdict.ok ? verdict.error : field.required && !answered ? "Required." : null;
    return { field, value, answered, error };
  });
  const canNext = rows.every((r) => !r.error);
  const only = rows.length === 1 ? rows[0] : null;
  const skip = !!only && !only.field.required && !only.answered;

  function next() {
    setTouched(true);
    if (canNext) onNext();
  }

  return (
    <fieldset disabled={locked} style={stepFrame}>
      {step.title && <strong style={{ ...headingStyle, display: "block", marginBottom: 10 }}>{step.title}</strong>}
      {rows.map(({ field, value, error }, i) => (
        <ScreenField
          key={field.key}
          field={field}
          value={value}
          onChange={(a) => setAnswer(field.key, a)}
          onEnter={next}
          error={touched ? error : null}
          slug={slug}
          autoFocus={i === 0 && !locked}
        />
      ))}
      {!locked && (
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {onBack && (
            <button type="button" onClick={onBack} style={linkBtn}>
              Back
            </button>
          )}
          <button type="button" onClick={next} aria-disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
            {skip ? "Skip" : (nextLabel ?? "Next")}
          </button>
        </div>
      )}
    </fieldset>
  );
}

function ScreenField({
  field,
  value,
  onChange,
  onEnter,
  error,
  slug,
  autoFocus,
}: {
  field: FlowField;
  value: Answer | undefined;
  onChange: (a: Answer) => void;
  onEnter: () => void;
  error: string | null;
  slug: string;
  autoFocus: boolean;
}) {
  const id = `bf-${field.key}`;
  const help = field.config?.help ?? "";
  return (
    <div style={{ marginBottom: 12 }}>
      <label htmlFor={id} style={{ fontSize: 13, display: "block", marginBottom: help ? 2 : 4 }}>
        {field.label}
        {field.required ? " *" : ""}
      </label>
      {help && <p style={{ fontSize: 12, opacity: 0.75, margin: "0 0 4px" }}>{help}</p>}
      {PLAIN_TEXT.has(field.type) ? (
        <PlainTextInput id={id} field={field} value={value} onChange={onChange} onEnter={onEnter} autoFocus={autoFocus} />
      ) : (
        <QuestionInput field={field} value={value} onChange={onChange} onEnter={onEnter} inputStyle={inputStyle} slug={slug} />
      )}
      {error && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 12, margin: "-6px 0 0" }}>{error}</p>}
    </div>
  );
}

/**
 * A text box as the business's form shows it: its own placeholder when the
 * form has one, else Required/Optional as the wizard always said. Drawn here
 * rather than by QuestionInput so a screen of several boxes focuses its first
 * one only and each carries its own placeholder.
 */
function PlainTextInput({
  id,
  field,
  value,
  onChange,
  onEnter,
  autoFocus,
}: {
  id: string;
  field: FlowField;
  value: Answer | undefined;
  onChange: (a: Answer) => void;
  onEnter: () => void;
  autoFocus: boolean;
}) {
  const shared = {
    id,
    value: String(value ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder: field.config?.placeholder || (field.required ? "Required" : "Optional"),
    "aria-label": field.label,
    autoFocus,
  };
  return field.type === "long_text" ? (
    <textarea {...shared} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
  ) : (
    <input
      {...shared}
      style={inputStyle}
      type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
      autoComplete={field.role === "email" ? "email" : field.role === "phone" ? "tel" : field.role === "first_name" ? "given-name" : field.role === "last_name" ? "family-name" : field.role === "name" ? "name" : undefined}
      onKeyDown={(e) => e.key === "Enter" && onEnter()}
    />
  );
}

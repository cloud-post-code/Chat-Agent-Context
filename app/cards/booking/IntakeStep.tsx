"use client";

import { resolveAnswer } from "@/lib/appointmentTypes";
import { QuestionInput, hasAnswer, type Answer, type Answers, type BookingField } from "../BookingQuestion";
import { inputStyle, linkBtn, liveBtn } from "./ui";

/**
 * One intake question per screen, exactly like the pre-flow wizard: the
 * server's own resolveAnswer decides whether the current answer is valid, so
 * the same verdict the server would give shows here before the round trip.
 */
export function IntakeStep({
  field,
  answers,
  setAnswer,
  slug,
  onNext,
  onBack,
}: {
  field: BookingField;
  answers: Answers;
  setAnswer: (key: string, value: Answer) => void;
  slug: string;
  onNext: () => void;
  onBack: () => void;
}) {
  const value = answers[field.key];
  const answered = hasAnswer(field, value);
  const verdict = resolveAnswer({ label: field.label, type: field.type, config: field.config ?? {} }, value);
  const canNext = verdict.ok && (!field.required || answered);

  return (
    <div>
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>{field.label}</strong>
      <div style={{ marginTop: 10 }}>
        <QuestionInput
          key={field.key}
          field={field}
          value={value}
          onChange={(a) => setAnswer(field.key, a)}
          onEnter={() => canNext && onNext()}
          inputStyle={inputStyle}
          slug={slug}
        />
      </div>
      {!verdict.ok && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{verdict.error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onBack} style={linkBtn}>
          Back
        </button>
        <button type="button" onClick={onNext} disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
          {answered || field.required ? "Next" : "Skip"}
        </button>
      </div>
    </div>
  );
}

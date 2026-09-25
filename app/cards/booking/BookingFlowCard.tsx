"use client";

import { useState } from "react";
import { resolveAnswer } from "@/lib/appointmentTypes";
import type { FlowField } from "@/lib/booking/flowSteps";
import { answerLines, hasAnswer, QuestionInput, type Answers, type BookingField } from "../BookingQuestion";
import { createLegacyBooking } from "./api";
import { card, headingStyle, inputStyle, linkBtn, liveBtn, progressStyle } from "./ui";

/**
 * What is left of the one-card booking wizard now that a booking is a
 * conversation of cards (BookingSessionCard, BookingStepCard, BookingThread):
 * the reading of a block's fields the planner needs, and the pre-flow wizard
 * for a tenant with no flow at all — intake questions, a datetime picker,
 * confirm — so nothing ever goes blank.
 */

/**
 * A block's fields as the planner reads them. An old stored block (a canned
 * answer saved before roles and screens existed) lacks both: such a field
 * is nobody's contact detail and sits on a screen of its own, in order — one
 * question per screen, exactly what that block always drew.
 */
export function toFlowFields(fields: BookingField[]): FlowField[] {
  return fields.map((f, i) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    config: f.config ?? {},
    role: f.role ?? "none",
    screen: f.screen ?? i + 1,
  }));
}

/**
 * The pre-flow wizard: unchanged behaviour from the original booking card —
 * one intake question per screen, then a plain datetime picker, then confirm,
 * POSTing the legacy `{ slug, startsAt, answers }` body.
 */
export function LegacyWizard({
  slug,
  fields,
  prefill,
  preview = false,
}: {
  slug: string;
  fields: BookingField[];
  prefill?: Record<string, string>;
  preview?: boolean;
}) {
  const asked = fields.filter((f) => f.type === "multi_select" || !(prefill?.[f.key] ?? "").trim());
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(prefill ?? {});
  const [when, setWhen] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const timeStep = asked.length;
  const reviewStep = asked.length + 1;
  const startsAt = when ? new Date(when) : null;
  const timeOk = !!startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now();

  async function submit() {
    if (state === "sending" || !startsAt) return;
    if (preview) {
      setState("done");
      return;
    }
    setState("sending");
    setError("");
    const res = await createLegacyBooking(slug, startsAt.toISOString(), answers);
    if (!res.ok) {
      setError(res.error);
      setState("error");
      return;
    }
    setState("done");
  }

  if (state === "done" && startsAt) {
    return (
      <div data-fill="bg-soft" style={{ ...card, borderColor: "var(--success-on-bg-soft)" }}>
        <strong style={{ fontSize: 15 }}>You&apos;re booked.</strong>
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14, marginTop: 6 }}>
          {startsAt.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} — your local time.
        </p>
      </div>
    );
  }

  const back = step > 0 && (
    <button type="button" onClick={() => setStep(step - 1)} style={linkBtn}>
      Back
    </button>
  );
  const progress = (
    <p style={progressStyle}>
      Step {Math.min(step, reviewStep) + 1} of {reviewStep + 1}
    </p>
  );

  if (step < timeStep) {
    const f = asked[step];
    const v = answers[f.key];
    const answered = hasAnswer(f, v);
    const verdict = resolveAnswer({ label: f.label, type: f.type, config: f.config ?? {} }, v);
    const canNext = verdict.ok && (!f.required || answered);
    const next = () => canNext && setStep(step + 1);
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        {progress}
        <strong style={headingStyle}>{f.label}</strong>
        <div style={{ marginTop: 10 }}>
          <QuestionInput key={f.key} field={f} value={v} onChange={(a) => setAnswers({ ...answers, [f.key]: a })} onEnter={next} inputStyle={inputStyle} slug={slug} />
        </div>
        {!verdict.ok && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{verdict.error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          {back}
          <button type="button" onClick={next} disabled={!canNext} style={{ ...linkBtn, ...liveBtn, opacity: canNext ? 1 : 0.55 }}>
            {answered || f.required ? "Next" : "Skip"}
          </button>
        </div>
      </div>
    );
  }

  if (step === timeStep) {
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        {progress}
        <strong style={headingStyle}>When works for you?</strong>
        <div style={{ marginTop: 10 }}>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} style={inputStyle} />
        </div>
        {when && !timeOk && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>Pick a time in the future.</p>}
        <div style={{ display: "flex", gap: 8 }}>
          {back}
          <button type="button" onClick={() => timeOk && setStep(reviewStep)} disabled={!timeOk} style={{ ...linkBtn, ...liveBtn, opacity: timeOk ? 1 : 0.55 }}>
            Next
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
      {progress}
      <strong style={headingStyle}>Confirm your booking</strong>
      <dl style={{ margin: "10px 0", fontSize: 13 }}>
        {fields
          .filter((f) => hasAnswer(f, answers[f.key]))
          .map((f) => {
            const lines = answerLines(f, answers[f.key]);
            return (
              <div key={f.key} style={{ marginBottom: 6 }}>
                <dt style={{ color: "var(--on-bg-soft)", fontSize: 12 }}>{f.label}</dt>
                {lines.map((line) => (
                  <dd key={line} style={{ margin: 0 }}>
                    {line}
                  </dd>
                ))}
              </div>
            );
          })}
        <div>
          <dt style={{ color: "var(--on-bg-soft)", fontSize: 12 }}>Time</dt>
          <dd style={{ margin: 0 }}>
            {startsAt?.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </dd>
        </div>
      </dl>
      {state === "error" && <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {back}
        <button type="button" onClick={submit} disabled={state === "sending"} style={{ ...linkBtn, ...liveBtn, padding: "10px 18px", opacity: state === "sending" ? 0.55 : 1 }}>
          {state === "sending" ? "Booking…" : "Confirm booking"}
        </button>
      </div>
    </div>
  );
}

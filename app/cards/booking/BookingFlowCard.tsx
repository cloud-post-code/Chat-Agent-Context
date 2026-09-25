"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveAnswer } from "@/lib/appointmentTypes";
import type { BookingFlow, BookingSelection } from "@/lib/booking/types";
import { contactFields, planSteps, providerCandidates, type CardStep, type FlowField } from "@/lib/booking/flowSteps";
import { answerLines, hasAnswer, QuestionInput, type Answer, type Answers, type BookingField } from "../BookingQuestion";
import { createLegacyBooking, getBookingFlow, type CreateBookingResult } from "./api";
import { Confirmed } from "./Confirmed";
import { LocationStep } from "./LocationStep";
import { ProviderStep } from "./ProviderStep";
import { ReviewStep } from "./ReviewStep";
import { ScreenStep } from "./ScreenStep";
import { OptionsStep, ServiceStep } from "./ServiceStep";
import { TimeStep } from "./TimeStep";
import { card, headingStyle, inputStyle, linkBtn, liveBtn, progressStyle, textBtn } from "./ui";

/**
 * The visitor-facing booking card: a state machine over one `BookingSelection`
 * (see docs/features/booking-flow/DESIGN.md "The visitor's flow"), driven by
 * a `BookingFlow` handed in the block or fetched on mount when the block is an
 * old stored sample with no `flow`. The steps are the business's own
 * (`planSteps` over `flow.rules.flow` and its role-tagged, screen-grouped
 * fields), so the card walks the form the business already has — contact
 * details are ordinary fields on a screen, not a fixed step of ours. When
 * there is truly no flow to be had (fetch fails, or the tenant has none), this
 * draws the pre-flow wizard — intake questions, a datetime picker, confirm —
 * so nothing ever goes blank.
 */

/** Where the review's Edit links go: an engine step, the contact screen, or the first question screen. */
export type EditTarget = "service" | "options" | "provider" | "location" | "time" | "details" | "intake";

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

function visitorZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function emptySelection(preselectServiceId: string | null): BookingSelection {
  return {
    serviceId: preselectServiceId,
    variantId: null,
    addonIds: [],
    quantity: 1,
    staffId: null,
    locationId: null,
    mode: "in_person",
    customerAddress: "",
    postalCode: "",
    startsAt: "",
    timezone: visitorZone(),
    recurrence: null,
    waitlist: false,
    // The customer is read from the role-tagged answers server-side; nothing
    // is collected outside `answers` any more.
    customer: {},
    answers: {},
    promoCode: "",
    tipPercent: null,
    tipAmount: null,
    membershipId: null,
  };
}

export function BookingFlowCard({
  slug,
  fields,
  flow: flowProp,
  preselectServiceId,
  prefill,
  preview = false,
}: {
  slug: string;
  fields: BookingField[];
  /** Absent/null on an old stored sample — the card fetches it itself. */
  flow?: BookingFlow | null;
  /** From the services card: the service the visitor already tapped. */
  preselectServiceId?: string | null;
  /** Legacy-mode prefill (no flow): an intake answer the visitor already gave elsewhere. */
  prefill?: Record<string, string>;
  /**
   * The owner trying their own form (the onboarding booking-form step): every
   * step is the real one — live availability, the real quote — but confirming
   * books nothing, and the card can be started over.
   */
  preview?: boolean;
}) {
  const [remote, setRemote] = useState<{ flow: BookingFlow | null; fields: BookingField[] } | null>(
    flowProp ? { flow: flowProp, fields } : null,
  );

  // A block with no flow (an old stored sample, or a server-rendered card)
  // draws the intake-only wizard from the fields it was handed straight away
  // — nothing waits on the network — and quietly upgrades to the full flow if
  // the fetch brings one back. A failed fetch leaves the wizard as it is.
  useEffect(() => {
    if (flowProp) return;
    let cancelled = false;
    getBookingFlow(slug, preselectServiceId ?? undefined).then((res) => {
      if (cancelled || !res.ok || !res.flow) return;
      setRemote({ flow: res.flow, fields: res.fields });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, flowProp, preselectServiceId]);

  const flow = remote?.flow ?? null;
  const blockFields = remote?.fields ?? fields;
  const flowFields = useMemo(() => toFlowFields(blockFields), [blockFields]);

  if (!flow) {
    return <LegacyWizard slug={slug} fields={blockFields} prefill={prefill} preview={preview} />;
  }

  return (
    <FlowWizard slug={slug} flow={flow} fields={flowFields} preselectServiceId={preselectServiceId ?? flow.preselect.serviceId} preview={preview} />
  );
}

/** The step a review Edit link lands on, by target. */
function editIndex(steps: CardStep[], target: EditTarget): number {
  if (target === "details") {
    return steps.findIndex((s) => s.kind === "screen" && contactFields(s.fields).length > 0);
  }
  if (target === "intake") return steps.findIndex((s) => s.kind === "screen");
  return steps.findIndex((s) => s.kind === target);
}

function FlowWizard({
  slug,
  flow,
  fields,
  preselectServiceId,
  preview,
}: {
  slug: string;
  flow: BookingFlow;
  fields: FlowField[];
  preselectServiceId: string | null;
  preview: boolean;
}) {
  const [selection, setSelection] = useState<BookingSelection>(() => emptySelection(preselectServiceId));
  const [stepIndex, setStepIndex] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
  const [confirmed, setConfirmed] = useState<{ result: CreateBookingResult; waitlisted: boolean } | null>(null);

  const steps = useMemo(() => planSteps(flow, fields, selection), [flow, fields, selection]);
  const index = Math.min(stepIndex, steps.length - 1);
  const step = steps[index];

  const service = flow.services.find((s) => s.id === selection.serviceId) ?? null;
  const variant = service?.variants.find((v) => v.id === selection.variantId) ?? null;
  const provider = flow.staff.find((s) => s.id === selection.staffId) ?? null;
  const location = flow.locations.find((l) => l.id === selection.locationId) ?? null;

  function goNext() {
    if (returnToReview) {
      setReturnToReview(false);
      const reviewIdx = steps.findIndex((s) => s.kind === "review");
      setStepIndex(reviewIdx >= 0 ? reviewIdx : Math.min(index + 1, steps.length - 1));
      return;
    }
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }
  function editTarget(target: EditTarget) {
    const idx = editIndex(steps, target);
    if (idx >= 0) {
      setReturnToReview(true);
      setStepIndex(idx);
    }
  }
  function pickService(id: string) {
    setSelection((sel) => {
      const next = flow.services.find((s) => s.id === id) ?? null;
      // Provider may come before service in the business's flow: a provider
      // already chosen who doesn't perform this service is let go, so the
      // server never sees a pair it would refuse.
      const keepStaff = !sel.staffId || providerCandidates(flow, next).some((s) => s.id === sel.staffId);
      return { ...sel, serviceId: id, variantId: null, addonIds: [], quantity: 1, staffId: keepStaff ? sel.staffId : null };
    });
  }
  function setAnswer(key: string, value: Answer) {
    setSelection((sel) => ({ ...sel, answers: { ...sel.answers, [key]: value } }));
  }
  function startOver() {
    setSelection(emptySelection(preselectServiceId));
    setStepIndex(0);
    setReturnToReview(false);
    setConfirmed(null);
  }

  // The owner's preview says so on every screen, and can always be restarted.
  const previewNote = preview && (
    <p style={{ ...progressStyle, display: "flex", justifyContent: "space-between", gap: 10 }}>
      <span>Preview — nothing gets booked.</span>
      {(confirmed || index > 0) && (
        <button type="button" onClick={startOver} style={textBtn}>
          Start over
        </button>
      )}
    </p>
  );

  if (confirmed) {
    return (
      <div>
        {previewNote}
        <Confirmed
          flow={flow}
          result={confirmed.result}
          waitlisted={confirmed.waitlisted}
          service={service}
          provider={provider}
          location={location}
          selection={selection}
        />
      </div>
    );
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 560 }}>
      {previewNote}
      <p style={progressStyle}>
        Step {index + 1} of {steps.length}
      </p>
      {step.kind === "service" && (
        <ServiceStep
          flow={flow}
          selection={selection}
          onPick={(id) => {
            pickService(id);
            goNext();
          }}
        />
      )}
      {step.kind === "options" && service && (
        <OptionsStep service={service} selection={selection} setSelection={setSelection} onNext={goNext} onBack={goBack} currency={flow.business.currency} />
      )}
      {step.kind === "provider" && (
        <ProviderStep flow={flow} service={service} selection={selection} setSelection={setSelection} slug={slug} onNext={goNext} onBack={goBack} />
      )}
      {step.kind === "location" && (
        <LocationStep flow={flow} service={service} selection={selection} setSelection={setSelection} onNext={goNext} onBack={goBack} />
      )}
      {step.kind === "time" && <TimeStep flow={flow} selection={selection} setSelection={setSelection} slug={slug} onNext={goNext} onBack={goBack} />}
      {step.kind === "screen" && (
        <ScreenStep key={step.screen} step={step} answers={selection.answers as Answers} setAnswer={setAnswer} slug={slug} onNext={goNext} onBack={goBack} />
      )}
      {step.kind === "review" && (
        <ReviewStep
          flow={flow}
          service={service}
          variant={variant}
          provider={provider}
          location={location}
          selection={selection}
          setSelection={setSelection}
          fields={fields}
          title={step.title}
          slug={slug}
          onEdit={editTarget}
          onBack={goBack}
          onConfirmed={(result, waitlisted) => setConfirmed({ result, waitlisted })}
          preview={preview}
        />
      )}
    </div>
  );
}

/**
 * The pre-flow wizard: unchanged behaviour from the original booking card —
 * one intake question per screen, then a plain datetime picker, then confirm,
 * POSTing the legacy `{ slug, startsAt, answers }` body.
 */
function LegacyWizard({
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

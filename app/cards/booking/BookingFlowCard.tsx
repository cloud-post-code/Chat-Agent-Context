"use client";

import { useEffect, useMemo, useState } from "react";
import { isFieldShown, resolveAnswer } from "@/lib/appointmentTypes";
import type { BookingFlow, BookingSelection } from "@/lib/booking/types";
import { effectivePricing } from "@/lib/booking/types";
import { answerLines, hasAnswer, QuestionInput, type Answer, type Answers, type BookingField } from "../BookingQuestion";
import { createLegacyBooking, getBookingFlow, type CreateBookingResult } from "./api";
import { Confirmed } from "./Confirmed";
import { DetailsStep } from "./DetailsStep";
import { IntakeStep } from "./IntakeStep";
import { LocationStep, locationChoiceReal } from "./LocationStep";
import { ProviderStep, providerCandidates } from "./ProviderStep";
import { ReviewStep } from "./ReviewStep";
import { OptionsStep, ServiceStep } from "./ServiceStep";
import { TimeStep } from "./TimeStep";
import { card, headingStyle, inputStyle, linkBtn, liveBtn, progressStyle } from "./ui";

/**
 * The visitor-facing booking card: a state machine over one `BookingSelection`
 * (see docs/features/booking-flow/DESIGN.md "The visitor's flow"), driven by
 * a `BookingFlow` handed in the block or fetched on mount when the block is an
 * old stored sample with no `flow`. When there is truly no flow to be had
 * (fetch fails, or the tenant has none), this draws the pre-flow wizard —
 * intake questions, a datetime picker, confirm — so nothing ever goes blank.
 */

type Step =
  | { kind: "service" }
  | { kind: "options" }
  | { kind: "provider" }
  | { kind: "location" }
  | { kind: "time" }
  | { kind: "details" }
  | { kind: "intake"; field: BookingField }
  | { kind: "review" };

type EditTarget = "service" | "options" | "provider" | "location" | "time" | "details" | "intake";

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
    customer: {},
    answers: {},
    promoCode: "",
    tipPercent: null,
    tipAmount: null,
    membershipId: null,
  };
}

function computeSteps(flow: BookingFlow, selection: BookingSelection, intake: BookingField[]): Step[] {
  const steps: Step[] = [];
  const service = flow.services.find((s) => s.id === selection.serviceId) ?? null;
  const variant = service?.variants.find((v) => v.id === selection.variantId) ?? null;

  if (flow.services.length > 0) steps.push({ kind: "service" });

  if (service) {
    const pricing = effectivePricing(service, variant);
    const needsOptions =
      service.variants.length > 0 ||
      service.addons.length > 0 ||
      pricing.kind === "per_person" ||
      pricing.kind === "per_unit" ||
      pricing.kind === "hourly";
    if (needsOptions) steps.push({ kind: "options" });
  }

  if (flow.rules.staffSelection !== "hidden" && providerCandidates(flow, service).length >= 1) {
    steps.push({ kind: "provider" });
  }

  if (locationChoiceReal(flow, service)) steps.push({ kind: "location" });

  steps.push({ kind: "time" });
  steps.push({ kind: "details" });

  const keys = intake.map((f) => f.key);
  for (const f of intake) {
    if (isFieldShown({ key: f.key, config: f.config ?? {} }, selection.answers, keys)) {
      steps.push({ kind: "intake", field: f });
    }
  }

  steps.push({ kind: "review" });
  return steps;
}

export function BookingFlowCard({
  slug,
  fields,
  flow: flowProp,
  preselectServiceId,
  prefill,
}: {
  slug: string;
  fields: BookingField[];
  /** Absent/null on an old stored sample — the card fetches it itself. */
  flow?: BookingFlow | null;
  /** From the services card: the service the visitor already tapped. */
  preselectServiceId?: string | null;
  /** Legacy-mode prefill (no flow): an intake answer the visitor already gave elsewhere. */
  prefill?: Record<string, string>;
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
  const intake = remote?.fields ?? fields;

  if (!flow) {
    return <LegacyWizard slug={slug} fields={intake} prefill={prefill} />;
  }

  return (
    <FlowWizard slug={slug} flow={flow} intake={intake} preselectServiceId={preselectServiceId ?? flow.preselect.serviceId} />
  );
}

function FlowWizard({
  slug,
  flow,
  intake,
  preselectServiceId,
}: {
  slug: string;
  flow: BookingFlow;
  intake: BookingField[];
  preselectServiceId: string | null;
}) {
  const [selection, setSelection] = useState<BookingSelection>(() => emptySelection(preselectServiceId));
  const [stepIndex, setStepIndex] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);
  const [confirmed, setConfirmed] = useState<{ result: CreateBookingResult; waitlisted: boolean } | null>(null);

  const steps = useMemo(() => computeSteps(flow, selection, intake), [flow, selection, intake]);
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
  function editTarget(kind: EditTarget) {
    const idx = steps.findIndex((s) => s.kind === kind);
    if (idx >= 0) {
      setReturnToReview(true);
      setStepIndex(idx);
    }
  }
  function setAnswer(key: string, value: Answer) {
    setSelection((sel) => ({ ...sel, answers: { ...sel.answers, [key]: value } }));
  }

  if (confirmed) {
    return (
      <Confirmed
        flow={flow}
        result={confirmed.result}
        waitlisted={confirmed.waitlisted}
        service={service}
        provider={provider}
        location={location}
        selection={selection}
      />
    );
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 560 }}>
      <p style={progressStyle}>
        Step {index + 1} of {steps.length}
      </p>
      {step.kind === "service" && (
        <ServiceStep
          flow={flow}
          selection={selection}
          onPick={(id) => {
            setSelection((sel) => ({ ...sel, serviceId: id, variantId: null, addonIds: [], quantity: 1 }));
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
      {step.kind === "details" && (
        <DetailsStep customerFields={flow.rules.customerFields} selection={selection} setSelection={setSelection} onNext={goNext} onBack={goBack} />
      )}
      {step.kind === "intake" && (
        <IntakeStep field={step.field} answers={selection.answers as Answers} setAnswer={setAnswer} slug={slug} onNext={goNext} onBack={goBack} />
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
          intake={intake}
          slug={slug}
          onEdit={editTarget}
          onBack={goBack}
          onConfirmed={(result, waitlisted) => setConfirmed({ result, waitlisted })}
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
function LegacyWizard({ slug, fields, prefill }: { slug: string; fields: BookingField[]; prefill?: Record<string, string> }) {
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

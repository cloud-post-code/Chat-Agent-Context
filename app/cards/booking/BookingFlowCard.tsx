"use client";

import { useEffect, useMemo, useState } from "react";
import { isFieldShown } from "@/lib/appointmentTypes";
import type { BookingFlow, BookingSelection } from "@/lib/booking/types";
import { effectivePricing } from "@/lib/booking/types";
import type { Answer, Answers, BookingField } from "../BookingQuestion";
import { getBookingFlow, type CreateBookingResult } from "./api";
import { Confirmed } from "./Confirmed";
import { DetailsStep } from "./DetailsStep";
import { IntakeStep } from "./IntakeStep";
import { LocationStep, locationChoiceReal } from "./LocationStep";
import { ProviderStep, providerCandidates } from "./ProviderStep";
import { ReviewStep } from "./ReviewStep";
import { OptionsStep, ServiceStep } from "./ServiceStep";
import { TimeStep } from "./TimeStep";
import { card, progressStyle } from "./ui";

/**
 * The visitor-facing booking card: a state machine over one `BookingSelection`
 * (see docs/features/booking-flow/DESIGN.md "The visitor's flow"), driven by
 * a `BookingFlow` handed in the block or fetched on mount when the block is an
 * old stored sample with no `flow`. While that fetch is out the card says so;
 * when there is no flow to be had (booking is off, or the fetch failed) it
 * says that, with the business's phone number when the flow named one — never
 * a blank card, never a second wizard asking the flow's own questions again.
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
}: {
  slug: string;
  fields: BookingField[];
  /** Absent/null on an old stored sample — the card fetches it itself. */
  flow?: BookingFlow | null;
  /** From the services card: the service the visitor already tapped. */
  preselectServiceId?: string | null;
}) {
  const [remote, setRemote] = useState<{ flow: BookingFlow | null; fields: BookingField[] } | null>(
    flowProp ? { flow: flowProp, fields } : null,
  );

  // A block with no flow (an old stored sample) fetches the live one; the
  // fields it was handed are replaced by the flow's own trimmed intake.
  useEffect(() => {
    if (flowProp) return;
    let cancelled = false;
    getBookingFlow(slug, preselectServiceId ?? undefined).then((res) => {
      if (cancelled) return;
      setRemote(res.ok ? { flow: res.flow, fields: res.fields } : { flow: null, fields: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, flowProp, preselectServiceId]);

  if (!remote) {
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        <p style={{ ...progressStyle, margin: 0 }}>Loading booking…</p>
      </div>
    );
  }
  if (!remote.flow) {
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        <p style={{ margin: 0, fontSize: 14 }}>Online booking isn&apos;t available right now — please get in touch and we&apos;ll set a time up together.</p>
      </div>
    );
  }

  return (
    <FlowWizard
      slug={slug}
      flow={remote.flow}
      intake={remote.fields}
      preselectServiceId={preselectServiceId ?? remote.flow.preselect.serviceId}
    />
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

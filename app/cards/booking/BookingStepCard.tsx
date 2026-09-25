"use client";

import { useChatThread } from "@/app/ChatThread";
import { planSteps } from "@/lib/booking/flowSteps";
import { reviewReady, stepFromId, withService, type StepId } from "@/lib/booking/session";
import type { BookingSelection } from "@/lib/booking/types";
import type { Answer, Answers } from "../BookingQuestion";
import type { UiBlock } from "../Cards";
import { LocationStep } from "./LocationStep";
import { ProviderStep } from "./ProviderStep";
import { ReviewStep } from "./ReviewStep";
import { ScreenStep } from "./ScreenStep";
import { OptionsStep, ServiceStep } from "./ServiceStep";
import { useBookingSession, useBookingSessions } from "./session";
import { completeStep, confirmSession, focusStep } from "./thread";
import { TimeStep } from "./TimeStep";
import { card } from "./ui";

/**
 * One step of a booking session, as its own card in the chat (the
 * `booking_step` block). The card owns no state: it reads the session's store
 * and writes back through it, and the thread controller
 * (app/cards/booking/thread.ts) decides what the finished step says and what
 * comes next. Finished cards stay visible and editable — the button reads
 * "Update" — until the session is confirmed or abandoned, when every control
 * locks. No "Step N of M": the conversation is the progress.
 */

type StepBlock = Extract<UiBlock, { type: "booking_step" }>;

/** The step id a block names (a screen carries its number). */
export function blockStepId(step: StepBlock["step"]): StepId {
  return step.kind === "screen" ? `screen:${step.screen ?? -1}` : step.kind;
}

const BELOW = "One more thing to answer — see the step below.";
const ABOVE = "One more thing to answer — see the step above.";

export function BookingStepCard({ block, slug }: { block: StepBlock; slug: string }) {
  const thread = useChatThread();
  const { preview } = useBookingSessions();
  const { store, state } = useBookingSession(block.sessionId);
  const id = blockStepId(block.step);
  const { flow, fields, selection: sel, asked, answered, status } = state;
  if (!flow) return null;
  const steps = planSteps(flow, fields, sel);
  const step = stepFromId(steps, id);
  // A step the plan no longer holds (the service changed and needs no options
  // now, a screen's every question is hidden) draws nothing.
  if (!step) return null;

  // Without a thread (a server render, an old page) the step is read-only.
  const locked = status !== "live" || !thread;
  const nextLabel = answered.includes(id) ? "Update" : "Next";
  const setSelection = (s: BookingSelection) => store.update((st) => ({ ...st, selection: s }));
  const onNext = () => {
    if (thread) completeStep(thread, store, id);
  };

  const service = flow.services.find((s) => s.id === sel.serviceId) ?? null;
  const variant = service?.variants.find((v) => v.id === sel.variantId) ?? null;
  const provider = flow.staff.find((s) => s.id === sel.staffId) ?? null;
  const location = flow.locations.find((l) => l.id === sel.locationId) ?? null;

  let body: React.ReactNode = null;
  switch (step.kind) {
    case "service":
      body = (
        <ServiceStep
          flow={flow}
          selection={sel}
          locked={locked}
          onPick={(serviceId) => {
            if (!thread) return;
            store.update((st) => ({ ...st, selection: withService(st.flow ?? flow, st.selection, serviceId) }));
            completeStep(thread, store, "service");
          }}
        />
      );
      break;
    case "options":
      body = service && (
        <OptionsStep
          service={service}
          selection={sel}
          setSelection={setSelection}
          onNext={onNext}
          nextLabel={nextLabel}
          locked={locked}
          currency={flow.business.currency}
        />
      );
      break;
    case "provider":
      body = (
        <ProviderStep flow={flow} service={service} selection={sel} setSelection={setSelection} slug={slug} onNext={onNext} nextLabel={nextLabel} locked={locked} />
      );
      break;
    case "location":
      body = <LocationStep flow={flow} service={service} selection={sel} setSelection={setSelection} onNext={onNext} nextLabel={nextLabel} locked={locked} />;
      break;
    case "time":
      body = <TimeStep flow={flow} selection={sel} setSelection={setSelection} slug={slug} onNext={onNext} nextLabel={nextLabel} locked={locked} />;
      break;
    case "screen":
      body = (
        <ScreenStep
          step={step}
          answers={sel.answers as Answers}
          setAnswer={(key: string, value: Answer) =>
            store.update((st) => ({ ...st, selection: { ...st.selection, answers: { ...st.selection.answers, [key]: value } } }))
          }
          slug={slug}
          onNext={onNext}
          nextLabel={nextLabel}
          locked={locked}
        />
      );
      break;
    case "review": {
      const readiness = reviewReady(flow, fields, steps, sel, answered);
      let notReady: string | undefined;
      if (!readiness.ok) {
        // The missing step's card sits below this one when it was asked after
        // review (or not yet), above it otherwise.
        const at = asked.indexOf(readiness.missing[0]);
        notReady = at === -1 || at > asked.indexOf("review") ? BELOW : ABOVE;
      }
      body = (
        <ReviewStep
          flow={flow}
          service={service}
          variant={variant}
          provider={provider}
          location={location}
          selection={sel}
          setSelection={setSelection}
          fields={fields}
          title={step.title}
          slug={slug}
          onEdit={(target) => {
            if (thread) focusStep(thread, store, target);
          }}
          onConfirmed={(result, waitlisted) => {
            if (thread) confirmSession(thread, store, result, waitlisted);
          }}
          ready={readiness.ok}
          notReady={notReady}
          locked={locked}
          preview={preview}
        />
      );
      break;
    }
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 560 }} id={`booking-${block.sessionId}-${id}`} data-booking-step={id}>
      {body}
    </div>
  );
}

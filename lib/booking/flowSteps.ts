import type { AppointmentFieldRow } from "../appointmentTypes";
import { isFieldShown } from "../appointmentTypes";
import type { BookingFlow, BookingSelection, FlowStep, LocationRow, ServiceRow, StaffRow } from "./types";
import { effectivePricing, sanitizeFlow } from "./types";

/**
 * The steps a visitor walks through, planned from the business's own flow
 * (BookingSettings.flow) and its form (the role-tagged, screen-grouped
 * fields). Pure and React-free so the card, the onboarding step list and the
 * form-editing chat all describe the same walk — the card cannot show a step
 * the step list doesn't name, or the other way round.
 *
 * The order is the business's. The only fixed element is `review`, always
 * last, because it is our submit UI (the price, the Confirm button). An
 * engine step is skipped when it has nothing to ask (no services, no
 * providers, one location); a `screen` step is skipped when every field on
 * it is hidden by a condition.
 */

/** The field shape the planner needs: what the card block carries plus role and screen. */
export type FlowField = Pick<AppointmentFieldRow, "key" | "label" | "type" | "required" | "config" | "role" | "screen">;

export type CardStep =
  | { kind: "service" }
  | { kind: "options" }
  | { kind: "provider" }
  | { kind: "location" }
  | { kind: "time" }
  | { kind: "screen"; screen: number; title: string; fields: FlowField[] }
  | { kind: "review"; title: string };

export type StepSelection = Pick<BookingSelection, "serviceId" | "variantId" | "answers">;

/** service.staffIds ∩ enabled staff, or every enabled provider when staffIds is empty (or no service yet). */
export function providerCandidates(flow: BookingFlow, service: ServiceRow | null): StaffRow[] {
  const enabled = flow.staff.filter((s) => s.enabled);
  if (!service || service.staffIds.length === 0) return enabled;
  return enabled.filter((s) => service.staffIds.includes(s.id));
}

/** Enabled locations the service offers; service.locationIds empty = every enabled location. */
export function offeringLocations(flow: BookingFlow, service: ServiceRow | null): LocationRow[] {
  const enabled = flow.locations.filter((l) => l.enabled);
  if (!service || service.locationIds.length === 0) return enabled;
  return enabled.filter((l) => service.locationIds.includes(l.id));
}

/** Whether the location step has anything real to ask. */
export function locationChoiceReal(flow: BookingFlow, service: ServiceRow | null): boolean {
  const offering = offeringLocations(flow, service);
  const modes = service?.modes ?? [];
  return offering.length > 1 || modes.includes("online") || modes.includes("mobile");
}

/** Variants, add-ons or a quantity: the service has options to choose. */
function serviceNeedsOptions(service: ServiceRow, variantId: string | null): boolean {
  const variant = service.variants.find((v) => v.id === variantId) ?? null;
  const pricing = effectivePricing(service, variant);
  return (
    service.variants.length > 0 ||
    service.addons.length > 0 ||
    pricing.kind === "per_person" ||
    pricing.kind === "per_unit" ||
    pricing.kind === "hourly"
  );
}

/** The distinct screens the fields occupy, in field order. */
function fieldScreens(fields: ReadonlyArray<Pick<FlowField, "screen">>): number[] {
  return [...new Set(fields.map((f) => f.screen))];
}

/** The fields on one screen, in their order. */
export function screenFields<F extends Pick<FlowField, "screen">>(fields: ReadonlyArray<F>, screen: number): F[] {
  return fields.filter((f) => f.screen === screen);
}

export function planSteps(flow: BookingFlow, fields: FlowField[], selection: StepSelection): CardStep[] {
  const service = flow.services.find((s) => s.id === selection.serviceId) ?? null;
  const keys = fields.map((f) => f.key);
  const steps: CardStep[] = [];

  const flowSteps: FlowStep[] = sanitizeFlow(flow.rules.flow, fields);
  for (const step of flowSteps) {
    switch (step.kind) {
      case "service":
        if (flow.services.length > 0) {
          steps.push({ kind: "service" });
          if (service && serviceNeedsOptions(service, selection.variantId)) steps.push({ kind: "options" });
        }
        break;
      case "provider":
        if (flow.rules.staffSelection !== "hidden" && providerCandidates(flow, service).length >= 1) {
          steps.push({ kind: "provider" });
        }
        break;
      case "location":
        if (locationChoiceReal(flow, service)) steps.push({ kind: "location" });
        break;
      case "time":
        steps.push({ kind: "time" });
        break;
      case "questions": {
        const shown = screenFields(fields, step.screen ?? -1).filter((f) =>
          isFieldShown({ key: f.key, config: f.config ?? {} }, selection.answers, keys),
        );
        if (shown.length) steps.push({ kind: "screen", screen: step.screen ?? -1, title: step.title ?? "", fields: shown });
        break;
      }
      case "review":
        steps.push({ kind: "review", title: step.title ?? "" });
        break;
    }
  }
  return steps;
}

/** The fields that hold the customer's contact details, in order. */
export function contactFields<F extends Pick<FlowField, "role">>(fields: ReadonlyArray<F>): F[] {
  return fields.filter((f) => f.role === "name" || f.role === "first_name" || f.role === "last_name" || f.role === "email" || f.role === "phone");
}

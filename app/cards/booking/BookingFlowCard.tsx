import type { FlowField } from "@/lib/booking/flowSteps";
import type { BookingField } from "../BookingQuestion";

/**
 * What is left of the one-card booking wizard now that a booking is a
 * conversation of cards (BookingSessionCard, BookingStepCard, BookingThread):
 * the reading of a block's fields the planner needs.
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

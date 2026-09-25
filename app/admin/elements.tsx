import { createElement as h, type ReactNode } from "react";
import {
  buildElementIndex,
  toCalendarAppointment,
  toCalendarOrder,
  type ElementData,
  type ElementMeta,
} from "@/lib/adminElements";
import { loadElementData } from "@/lib/adminElementsLoad";
import { AppointmentCard, type CalendarAppointment } from "./AppointmentsPanel";
import { OrderRow } from "./OrdersPanel";
import { DirectiveForm } from "./DirectivesPanel";
import { AnswerForm, answerTabPositions } from "./AnswersPanel";
import { ServiceRowPanel } from "./booking/ServicesPanel";
import { StaffRowPanel } from "./booking/ProvidersPanel";
import { LocationRowPanel } from "./booking/LocationsPanel";

/**
 * The panel side of the element registry: one React node per element, keyed
 * `nodes[panel][id]`, rendered through the panels' own row components so a
 * revealed element is the panel's row — same markup, same server actions —
 * just on its own. The index returned beside the nodes is built from the same
 * rows with the same builders the brain uses (lib/adminElements.ts), so the
 * ids the copilot picks are the ids the chat can render.
 */

export type ElementActions = {
  cancelAction: (formData: FormData) => Promise<void>;
  confirmAction: (formData: FormData) => Promise<void>;
  deleteOrderAction: (formData: FormData) => Promise<void>;
};

export type ElementNodes = Record<string, Record<string, ReactNode>>;

export function buildElementNodes(
  d: ElementData & { fieldLabels: Record<string, string> },
  actions: ElementActions,
): { index: ElementMeta[]; nodes: ElementNodes; appointmentRows: CalendarAppointment[] } {
  const appointmentRows = d.appointments.map(toCalendarAppointment);
  const categories = [...new Set(d.services.map((s) => s.category).filter(Boolean))];
  const tabs = answerTabPositions(d.canned);
  // createElement rather than JSX: this file is also loaded by offline proofs
  // through tsx, which (with jsx: preserve) has no React global to lean on.
  const nodes: ElementNodes = {
    appointments: Object.fromEntries(
      appointmentRows.map((a) => [
        a.id,
        h(AppointmentCard, {
          key: a.id,
          a,
          fieldLabels: d.fieldLabels,
          cancelAction: actions.cancelAction,
          confirmAction: actions.confirmAction,
        }),
      ]),
    ),
    orders: Object.fromEntries(
      d.orders.map((o) => [
        o.id,
        h(OrderRow, { key: o.id, o: toCalendarOrder(o), deleteAction: actions.deleteOrderAction }),
      ]),
    ),
    goals: Object.fromEntries(
      d.goals.map((r) => [r.id, h(DirectiveForm, { key: r.id, kind: "goal", row: r })]),
    ),
    rules: Object.fromEntries(
      d.rules.map((r) => [r.id, h(DirectiveForm, { key: r.id, kind: "rule", row: r })]),
    ),
    answers: Object.fromEntries(
      d.canned.map((r) => [r.id, h(AnswerForm, { key: r.id, row: r, tab: tabs[r.id] })]),
    ),
    "booking-services": Object.fromEntries(
      d.services.map((s, i) => [
        s.id,
        h(ServiceRowPanel, {
          key: s.id,
          s,
          index: i,
          count: d.services.length,
          staff: d.staff,
          locations: d.locations,
          categories,
          currency: d.currency,
        }),
      ]),
    ),
    "booking-providers": Object.fromEntries(
      d.staff.map((s, i) => [
        s.id,
        h(StaffRowPanel, { key: s.id, s, index: i, count: d.staff.length, services: d.services }),
      ]),
    ),
    "booking-locations": Object.fromEntries(
      d.locations.map((l, i) => [
        l.id,
        h(LocationRowPanel, { key: l.id, l, index: i, count: d.locations.length, services: d.services }),
      ]),
    ),
  };
  return { index: buildElementIndex(d), nodes, appointmentRows };
}

/** Load-and-build, for callers that don't already hold the rows (proofs). */
export async function buildElementNodesForUser(userId: string, actions: ElementActions) {
  const data = await loadElementData(userId);
  const { getBookingConfig } = await import("@/lib/appointments");
  const config = await getBookingConfig(userId);
  const fieldLabels = Object.fromEntries(config.fields.map((f) => [f.key, f.label]));
  return { ...buildElementNodes({ ...data, fieldLabels }, actions), fieldLabels };
}

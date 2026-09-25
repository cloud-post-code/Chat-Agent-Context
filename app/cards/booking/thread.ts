// STUB — replaced by Team T at merge. The controller's signatures with the
// least behaviour that lets the cards run: an ask message per step, a reply
// line per finished step, the next step appended after each completion.

import type { ChatThread } from "@/app/ChatThread";
import { planSteps, type CardStep, type FlowField } from "@/lib/booking/flowSteps";
import { editTargetStep, ids, intro, nextUnasked, stepFromId, stepId, type EditTarget, type StepId } from "@/lib/booking/session";
import type { BookingFlow } from "@/lib/booking/types";
import type { CreateBookingResult } from "./api";
import type { BookingSessions, BookingSessionState, BookingSessionStore } from "./session";

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function startSession(
  thread: ChatThread,
  sessions: BookingSessions,
  opts: { flow: BookingFlow; fields: FlowField[]; preselectServiceId?: string | null; skipTyping?: boolean },
): string {
  void opts.skipTyping;
  const sessionId = newId();
  const store = sessions.get(sessionId);
  store.seed(opts.flow, opts.fields);
  store.update((s) => ({ ...s, preselectServiceId: opts.preselectServiceId ?? null }));
  // The session's start block: BookingSessionCard mounts on it and asks the first step.
  thread.appendMessages([
    {
      id: `${sessionId}:start`,
      role: "assistant",
      content: "",
      cards: [{ type: "booking", fields: opts.fields, flow: opts.flow, sessionId, preselectServiceId: opts.preselectServiceId ?? null }],
    },
  ]);
  return sessionId;
}

export function bindSession(thread: ChatThread, store: BookingSessionStore): () => void {
  void thread;
  return store.subscribe(() => {});
}

export function advanceBooking(thread: ChatThread, store: BookingSessionStore, opts?: { skipTyping?: boolean }): void {
  const st = store.get();
  if (!st.flow || st.status !== "live") return;
  const next = nextUnasked(planSteps(st.flow, st.fields, st.selection), st.asked);
  if (!next) return;
  const id = stepId(next);
  store.update((s) => ({ ...s, asked: [...s.asked, id] }));
  thread.appendMessages([
    {
      id: ids(st.sessionId).ask(id),
      role: "assistant",
      content: intro(next, st.flow),
      typed: !opts?.skipTyping,
      cards: [
        {
          type: "booking_step",
          sessionId: st.sessionId,
          step: next.kind === "screen" ? { kind: "screen", screen: next.screen } : { kind: next.kind },
        },
      ],
    },
  ]);
  thread.scrollToEnd();
}

export function completeStep(thread: ChatThread, store: BookingSessionStore, id: StepId): void {
  const st = store.get();
  if (!st.flow) return;
  const step = stepFromId(planSteps(st.flow, st.fields, st.selection), id);
  store.update((s) => ({
    ...s,
    asked: s.asked.includes(id) ? s.asked : [...s.asked, id],
    answered: s.answered.includes(id) ? s.answered : [...s.answered, id],
  }));
  if (step) thread.appendMessages([{ id: ids(st.sessionId).reply(id), role: "user", content: summaryLine(step, store.get()) }]);
  advanceBooking(thread, store);
}

export function focusStep(thread: ChatThread, store: BookingSessionStore, target: EditTarget): void {
  void thread;
  const st = store.get();
  if (!st.flow) return;
  const step = editTargetStep(planSteps(st.flow, st.fields, st.selection), target);
  if (!step || typeof document === "undefined") return;
  document.getElementById(`booking-${st.sessionId}-${stepId(step)}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function confirmSession(thread: ChatThread, store: BookingSessionStore, result: CreateBookingResult, waitlisted: boolean): void {
  store.update((s) => ({ ...s, confirmed: { result, waitlisted }, status: "confirmed" }));
  const st = store.get();
  thread.appendMessages([
    { id: ids(st.sessionId).confirmedAsk, role: "assistant", content: "", cards: [{ type: "booking_confirmed", sessionId: st.sessionId }] },
  ]);
  thread.scrollToEnd();
}

export function startOver(thread: ChatThread, sessions: BookingSessions, store: BookingSessionStore): string {
  const st = store.get();
  store.clear();
  if (!st.flow) return st.sessionId;
  return startSession(thread, sessions, { flow: st.flow, fields: st.fields, preselectServiceId: st.preselectServiceId });
}

export function reconcileThread(thread: ChatThread, store: BookingSessionStore): void {
  void thread;
  void store;
}

export function summaryLine(step: CardStep, state: BookingSessionState): string {
  const { flow, selection: sel } = state;
  switch (step.kind) {
    case "service":
      return flow?.services.find((s) => s.id === sel.serviceId)?.name ?? "";
    case "options":
      return "Options chosen";
    case "provider":
      return flow?.staff.find((s) => s.id === sel.staffId)?.name ?? "Anyone available";
    case "location":
      return sel.mode === "online"
        ? "Online"
        : sel.mode === "mobile"
          ? sel.customerAddress
          : (flow?.locations.find((l) => l.id === sel.locationId)?.name ?? "");
    case "time":
      return sel.startsAt ? new Date(sel.startsAt).toLocaleString() : "";
    case "screen":
      return step.fields
        .map((f) => String(sel.answers[f.key] ?? ""))
        .filter(Boolean)
        .join(", ");
    case "review":
      return "Confirmed";
  }
}

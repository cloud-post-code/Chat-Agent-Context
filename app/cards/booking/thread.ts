"use client";

import type { ChatThread } from "@/app/ChatThread";
import type { BookingField, UiBlock } from "@/app/cards/Cards";
import { answerLines } from "@/app/cards/BookingQuestion";
import { customerFromAnswers } from "@/lib/appointmentTypes";
import { newChatId, type StoredMsg } from "@/lib/chatStore";
import { contactFields, planSteps, type CardStep, type FlowField } from "@/lib/booking/flowSteps";
import {
  editTargetStep,
  emptySelection,
  ids,
  intro,
  nextUnasked,
  stepFromId,
  stepId,
  stepValid,
  withService,
  type EditTarget,
  type StepId,
} from "@/lib/booking/session";
import { formatInZone } from "@/lib/booking/time";
import { effectivePricing, pricingLabel, type BookingFlow } from "@/lib/booking/types";
import type { CreateBookingResult } from "./api";
import { visitorTimezone, type BookingSessionState, type BookingSessionStore, type BookingSessions } from "./session";

/**
 * The booking as a conversation: what happens to the chat thread when a
 * session starts, a step is finished, an earlier answer changes, or the
 * booking is confirmed. Every card of the session calls in here; nothing in
 * here draws anything. The pure rules (which step is next, whether a step is
 * valid) live in lib/booking/session.ts; this module applies them to a
 * ChatThread and a BookingSessionStore.
 *
 * The thread holds, per session: one `<sid>:start` message carrying the
 * `booking` block (or, for a server-started session, the assistant's own
 * message with that block), then per step an assistant "ask" (intro line +
 * card) and a user "reply" (the one-line summary of what was picked), and
 * once confirmed a last assistant line with the confirmation card. Finished
 * cards stay in the thread and stay editable: a changed answer rewrites its
 * reply in place, and a step the change makes necessary is asked below.
 */

/** The DOM id the card of one step carries, so an Edit link can scroll to it. */
export function stepDomId(sessionId: string, id: StepId): string {
  return `booking-${sessionId}-${id}`;
}

const SUMMARY_MAX = 200;

function cap(s: string): string {
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

/** The planner's field shape from the block's (config, role and screen filled in as the wizard always read them). */
function toFlowFields(fields: BookingField[]): FlowField[] {
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

function recurrenceText(r: NonNullable<BookingSessionState["selection"]["recurrence"]>): string {
  const every = r.frequency === "weekly" ? "weekly" : r.frequency === "biweekly" ? "every two weeks" : "monthly";
  return `repeats ${every} ×${r.count}`;
}

function whenText(startsAt: string, tz: string): string {
  const d = new Date(startsAt);
  return Number.isNaN(d.getTime()) ? startsAt : formatInZone(d, tz);
}

/** The one line a finished step says back, as the visitor's own words in the thread. */
export function summaryLine(step: CardStep, state: BookingSessionState): string {
  const { flow, selection: sel } = state;
  const currency = flow?.business.currency ?? "USD";
  const service = flow?.services.find((s) => s.id === sel.serviceId) ?? null;
  const tz = sel.timezone || flow?.business.timezone || visitorTimezone() || "UTC";

  switch (step.kind) {
    case "service": {
      if (!service) return "Picked: not chosen yet";
      return cap(`Picked: ${service.name} · ${pricingLabel(effectivePricing(service, null), currency)}`);
    }
    case "options": {
      if (!service) return "Options: none";
      const parts: string[] = [];
      const variant = service.variants.find((v) => v.id === sel.variantId);
      if (variant) parts.push(variant.name);
      const addons = service.addons.filter((a) => sel.addonIds.includes(a.id)).map((a) => a.name);
      if (addons.length) parts.push(addons.join(", "));
      const kind = effectivePricing(service, variant ?? null).kind;
      if (kind === "per_person" || kind === "per_unit" || kind === "hourly") parts.push(`× ${sel.quantity}`);
      return parts.length ? cap(`Options: ${parts.join(" · ")}`) : "Options: none";
    }
    case "provider": {
      const staff = flow?.staff.find((s) => s.id === sel.staffId) ?? null;
      return staff ? cap(`Provider: ${staff.name}`) : "Provider: anyone available";
    }
    case "location": {
      if (sel.mode === "online") return "Where: Online";
      if (sel.mode === "mobile") return sel.customerAddress ? cap(`Where: ${sel.customerAddress}`) : "Where: not chosen yet";
      const loc = flow?.locations.find((l) => l.id === sel.locationId) ?? null;
      return loc ? cap(`Where: ${loc.name}`) : "Where: not chosen yet";
    }
    case "time": {
      if (!sel.startsAt) return "When: not chosen yet";
      const parts = [whenText(sel.startsAt, tz)];
      if (sel.recurrence) parts.push(recurrenceText(sel.recurrence));
      if (sel.waitlist) parts.push("waitlist");
      return cap(`When: ${parts.join(" · ")}`);
    }
    case "screen": {
      const contact = contactFields(step.fields);
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(sel.answers)) flat[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
      const parts: string[] = [];
      if (contact.length) {
        const c = customerFromAnswers(contact, flat);
        const name = [c.firstName, c.lastName].filter(Boolean).join(" ");
        parts.push(...[name, c.email, c.phone].filter((x): x is string => !!x));
      }
      const contactKeys = new Set(contact.map((f) => f.key));
      for (const f of step.fields) {
        if (contactKeys.has(f.key)) continue;
        const raw = sel.answers[f.key];
        const value = Array.isArray(raw) ? raw : raw === undefined || raw === null ? undefined : String(raw);
        if (f.type === "waiver") {
          if (raw === true || /^(yes|agreed?|true|on)$/i.test(String(raw ?? ""))) parts.push(`${f.label}: agreed`);
          continue;
        }
        if (f.type === "file" || f.type === "photo" || f.type === "signature") {
          if (typeof raw === "string" && raw.trim()) parts.push(`${f.label}: attached`);
          continue;
        }
        const lines = answerLines(f, value);
        if (lines.length) parts.push(`${f.label}: ${lines.join(", ")}`);
      }
      const prefix = contact.length ? "Details" : "Answers";
      return parts.length ? cap(`${prefix}: ${parts.join(" · ")}`) : `${prefix}: none`;
    }
    case "review": {
      const done = state.confirmed;
      if (!done) return "Review: not confirmed yet";
      const r = done.result;
      const head = done.waitlisted ? "Waitlisted" : flow?.rules.confirmation === "request" ? "Requested" : "Booked";
      const parts = [r.serviceName || service?.name || "", r.staffName || "anyone available", whenText(r.startsAt, tz)].filter(Boolean);
      return cap(`${head}: ${parts.join(" · ")}`);
    }
  }
}

/** Every answered step's line, folded into one — what the model reads. */
export function bookingSoFar(state: BookingSessionState): string {
  if (!state.flow) return "Booking so far: nothing picked yet";
  const steps = planSteps(state.flow, state.fields, state.selection);
  const lines = steps.filter((s) => state.answered.includes(stepId(s))).map((s) => summaryLine(s, state));
  return lines.length ? `Booking so far: ${lines.join("; ")}` : "Booking so far: nothing picked yet";
}

function stepBlock(sessionId: string, step: CardStep): UiBlock {
  return {
    type: "booking_step",
    sessionId,
    step: step.kind === "screen" ? { kind: "screen", screen: step.screen } : { kind: step.kind },
  };
}

function askMessage(sessionId: string, step: CardStep, flow: BookingFlow, skipTyping: boolean): StoredMsg {
  const content = intro(step, flow);
  return {
    id: ids(sessionId).ask(stepId(step)),
    role: "assistant",
    content,
    typed: !skipTyping && content !== "",
    cards: [stepBlock(sessionId, step)],
  };
}

function replyMessage(sessionId: string, step: CardStep, state: BookingSessionState): StoredMsg {
  return { id: ids(sessionId).reply(stepId(step)), role: "user", content: summaryLine(step, state) };
}

/** The `booking` block a session started from, wherever in the thread it sits. */
function startBlock(thread: ChatThread, sessionId: string): Extract<UiBlock, { type: "booking" }> | null {
  for (const m of thread.snapshot()) {
    for (const c of m.cards ?? []) {
      if (c.type === "booking" && c.sessionId === sessionId) return c;
    }
  }
  return null;
}

/** A preselected service counts as the service step picked: no card, just its reply line. */
function applyPreselect(thread: ChatThread, store: BookingSessionStore, serviceId: string): void {
  const s = store.get();
  const flow = s.flow;
  if (!flow || !flow.services.some((x) => x.id === serviceId && x.enabled)) return;
  store.update((x) => ({
    ...x,
    preselectServiceId: serviceId,
    selection: withService(flow, x.selection, serviceId),
    asked: x.asked.includes("service") ? x.asked : [...x.asked, "service"],
    answered: x.answered.includes("service") ? x.answered : [...x.answered, "service"],
  }));
  thread.appendMessages([replyMessage(s.sessionId, { kind: "service" }, store.get())]);
}

/**
 * Start a booking in the thread: the session-start message (the `booking`
 * block, which the card draws as nothing but the session's anchor), the
 * seeded store, and the first step asked. Returns the new session id.
 */
export function startSession(
  thread: ChatThread,
  sessions: BookingSessions,
  args: { flow: BookingFlow; fields: BookingField[]; preselectServiceId?: string | null; skipTyping?: boolean; newId?: () => string },
): string {
  const sessionId = (args.newId ?? newChatId)();
  const store = sessions.get(sessionId);
  const flow = args.flow;
  const preselect = args.preselectServiceId && flow.services.some((s) => s.id === args.preselectServiceId && s.enabled) ? args.preselectServiceId : null;
  store.seed(flow, toFlowFields(args.fields));
  store.update((s) => ({
    ...s,
    selection: emptySelection(null, visitorTimezone() || flow.business.timezone),
    asked: [],
    answered: [],
    confirmed: null,
    status: "live",
    preselectServiceId: preselect,
  }));
  thread.appendMessages([
    {
      id: `${sessionId}:start`,
      role: "assistant",
      content: "",
      cards: [{ type: "booking", fields: args.fields, flow, sessionId, preselectServiceId: preselect }],
    },
  ]);
  if (preselect) applyPreselect(thread, store, preselect);
  advanceBooking(thread, store, { skipTyping: args.skipTyping });
  return sessionId;
}

/**
 * Keep the thread's reply lines true to the store: on every change, each
 * answered step whose summary changed is rewritten in place, and a step
 * whose answer stopped being valid is un-answered (its line then says so).
 * Returns the unsubscribe.
 */
export function bindSession(thread: ChatThread, store: BookingSessionStore): () => void {
  let busy = false;
  const sync = () => {
    if (busy) return;
    busy = true;
    try {
      const s = store.get();
      if (!s.flow) return;
      const flow = s.flow;
      const steps = planSteps(flow, s.fields, s.selection);
      const sid = ids(s.sessionId);
      const invalid: StepId[] = [];
      for (const id of s.answered) {
        const step = stepFromId(steps, id);
        if (!step) continue;
        if (s.status === "live" && !stepValid(flow, s.fields, step, s.selection)) invalid.push(id);
        const replyId = sid.reply(id);
        const line = summaryLine(step, s);
        const current = thread.snapshot().find((m) => m.id === replyId);
        if (current && current.content !== line) thread.rewriteMessage(replyId, { content: line });
      }
      if (invalid.length) store.update((x) => ({ ...x, answered: x.answered.filter((id) => !invalid.includes(id)) }));
    } finally {
      busy = false;
    }
  };
  return store.subscribe(sync);
}

/**
 * Ask the next step the plan has and the thread hasn't: steps the plan no
 * longer holds (options, after a switch to a service without any) lose
 * their messages first. Review is always last in the plan, so a step a
 * later change makes necessary is asked below the review card.
 */
export function advanceBooking(thread: ChatThread, store: BookingSessionStore, opts?: { skipTyping?: boolean }): void {
  const s = store.get();
  if (!s.flow || s.status !== "live") return;
  const flow = s.flow;
  const steps = planSteps(flow, s.fields, s.selection);
  const planned = steps.map(stepId);
  const sid = ids(s.sessionId);

  const stale = s.asked.filter((id) => !planned.includes(id));
  if (stale.length) {
    const gone = new Set(stale.flatMap((id) => [sid.ask(id), sid.reply(id)]));
    thread.removeMessages((m) => !!m.id && gone.has(m.id));
    store.update((x) => ({
      ...x,
      asked: x.asked.filter((id) => planned.includes(id)),
      answered: x.answered.filter((id) => planned.includes(id)),
    }));
  }

  // A step already on screen and not yet answered is the visitor's turn: the
  // next one waits for it. Review is the exception — it is answered only by
  // confirming, and a change made while it shows may need a step after it.
  const { asked, answered } = store.get();
  if (asked.some((id) => id !== "review" && !answered.includes(id))) return;
  const next = nextUnasked(steps, asked);
  if (!next) return;
  const id = stepId(next);
  thread.appendMessages([askMessage(s.sessionId, next, flow, !!opts?.skipTyping)]);
  store.update((x) => ({ ...x, asked: x.asked.includes(id) ? x.asked : [...x.asked, id] }));
  thread.scrollToEnd();
}

/** The visitor finished (or updated) a step: its reply line, then the next step. */
export function completeStep(thread: ChatThread, store: BookingSessionStore, id: StepId): void {
  const s = store.get();
  if (!s.flow) return;
  const step = stepFromId(planSteps(s.flow, s.fields, s.selection), id);
  if (!step) return;
  store.update((x) => ({
    ...x,
    asked: x.asked.includes(id) ? x.asked : [...x.asked, id],
    answered: x.answered.includes(id) ? x.answered : [...x.answered, id],
  }));
  thread.appendMessages([replyMessage(s.sessionId, step, store.get())]);
  advanceBooking(thread, store);
}

/** A review Edit link: scroll to that step's card, or ask it when it never was (a preselected service). */
export function focusStep(thread: ChatThread, store: BookingSessionStore, target: EditTarget): void {
  const s = store.get();
  if (!s.flow) return;
  const flow = s.flow;
  const step = editTargetStep(planSteps(flow, s.fields, s.selection), target);
  if (!step) return;
  const id = stepId(step);
  const askId = ids(s.sessionId).ask(id);
  if (!thread.has(askId)) {
    thread.appendMessages([askMessage(s.sessionId, step, flow, true)]);
    store.update((x) => ({ ...x, asked: x.asked.includes(id) ? x.asked : [...x.asked, id] }));
    thread.scrollToEnd();
  }
  scrollToStep(s.sessionId, id);
}

function scrollToStep(sessionId: string, id: StepId, attempt = 0): void {
  if (typeof document === "undefined") return;
  const el = document.getElementById(stepDomId(sessionId, id));
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  // The card may not be painted yet (just appended): one more try after a frame.
  if (attempt < 3) setTimeout(() => scrollToStep(sessionId, id, attempt + 1), 80);
}

const CONFIRMED_LINE = {
  booked: "You're booked — the details are below.",
  request: "Request sent — the details are below.",
  waitlist: "You're on the waitlist — the details are below.",
} as const;

/** The server accepted the booking: the review's reply becomes the Booked line and the confirmation card follows. */
export function confirmSession(thread: ChatThread, store: BookingSessionStore, result: CreateBookingResult, waitlisted: boolean): void {
  const s = store.get();
  if (!s.flow) return;
  store.update((x) => ({ ...x, status: "confirmed", confirmed: { result, waitlisted } }));
  completeStep(thread, store, "review");
  const flow = s.flow;
  const content = waitlisted ? CONFIRMED_LINE.waitlist : flow.rules.confirmation === "request" ? CONFIRMED_LINE.request : CONFIRMED_LINE.booked;
  thread.appendMessages([
    {
      id: ids(s.sessionId).confirmedAsk,
      role: "assistant",
      content,
      typed: true,
      cards: [{ type: "booking_confirmed", sessionId: s.sessionId }],
    },
  ]);
  thread.scrollToEnd();
}

/** Leave this session where it is (abandoned unless it was confirmed) and begin a new one with the same flow. */
export function startOver(thread: ChatThread, sessions: BookingSessions, store: BookingSessionStore): string {
  const s = store.get();
  if (s.status === "live") store.update((x) => ({ ...x, status: "abandoned" }));
  const block = startBlock(thread, s.sessionId);
  const flow = block?.flow ?? s.flow;
  if (!flow) return s.sessionId;
  const fields: BookingField[] = block?.fields ?? s.fields;
  return startSession(thread, sessions, { flow, fields, preselectServiceId: block?.preselectServiceId ?? s.preselectServiceId });
}

/**
 * After a reload, make the thread and the store agree. An empty store (the
 * visitor's storage was cleared, or the session is brand new — a server
 * block just arrived) means any ask in the thread is stale: those go, and
 * the first step is asked again. A store whose asked steps have no card in
 * the thread (an unsaved thread, a chat reopened mid-stream) gets them
 * appended in order. Nothing types in: this is repair, not conversation.
 */
export function reconcileThread(thread: ChatThread, store: BookingSessionStore): void {
  const s = store.get();
  if (!s.flow) return;
  const flow = s.flow;
  const sid = ids(s.sessionId);
  const startId = `${s.sessionId}:start`;
  const ownsStep = (m: StoredMsg) => sid.owns(m.id) && m.id !== startId;

  if (s.asked.length === 0 && s.status === "live") {
    if (thread.snapshot().some(ownsStep)) thread.removeMessages(ownsStep);
    store.update((x) => ({ ...x, answered: [], confirmed: null }));
    const preselect = startBlock(thread, s.sessionId)?.preselectServiceId ?? s.preselectServiceId;
    if (preselect) applyPreselect(thread, store, preselect);
    advanceBooking(thread, store, { skipTyping: true });
    return;
  }

  const steps = planSteps(flow, s.fields, s.selection);
  const expected = new Set<string>();
  const missing: StoredMsg[] = [];
  for (const id of s.asked) {
    const step = stepFromId(steps, id);
    if (!step) continue;
    // A preselected service was never asked with a card: its reply alone.
    const askedWithCard = !(id === "service" && s.preselectServiceId && !thread.has(sid.ask(id)));
    if (askedWithCard) {
      expected.add(sid.ask(id));
      if (!thread.has(sid.ask(id))) missing.push(askMessage(s.sessionId, step, flow, true));
    }
    if (s.answered.includes(id)) {
      expected.add(sid.reply(id));
      if (!thread.has(sid.reply(id))) missing.push(replyMessage(s.sessionId, step, s));
    }
  }
  if (s.confirmed) {
    expected.add(sid.confirmedAsk);
    if (!thread.has(sid.confirmedAsk)) {
      const content = s.confirmed.waitlisted ? CONFIRMED_LINE.waitlist : flow.rules.confirmation === "request" ? CONFIRMED_LINE.request : CONFIRMED_LINE.booked;
      missing.push({ id: sid.confirmedAsk, role: "assistant", content, cards: [{ type: "booking_confirmed", sessionId: s.sessionId }] });
    }
  }
  const stray = (m: StoredMsg) => ownsStep(m) && !expected.has(m.id!);
  if (thread.snapshot().some(stray)) thread.removeMessages(stray);
  if (missing.length) thread.appendMessages(missing);
  if (s.status === "live") advanceBooking(thread, store, { skipTyping: true });
}

import type { BookingFlow, BookingSelection } from "./types";
import { contactFields, providerCandidates, type CardStep, type FlowField } from "./flowSteps";

/**
 * A booking as a conversation: the pure rules behind the sequence of cards
 * the visitor chat lays out one step at a time — which step comes next, what
 * a finished step says back, how a changed earlier answer settles the rest.
 * No React, no storage, no network: the chat's controller
 * (app/cards/booking/thread.ts) and the proofs both drive these.
 *
 * Message ids: every step of a session has one assistant "ask" message (its
 * intro line + card) and one user "reply" message (the one-line summary of
 * what was picked), keyed `<sessionId>:<stepId>:ask` / `:reply`, so an edit
 * rewrites the reply in place instead of adding a new line.
 */

export type StepId = "service" | "options" | "provider" | "location" | "time" | `screen:${number}` | "review";

export function stepId(step: CardStep): StepId {
  return step.kind === "screen" ? `screen:${step.screen}` : step.kind;
}

export function stepFromId(steps: CardStep[], id: StepId): CardStep | null {
  return steps.find((s) => stepId(s) === id) ?? null;
}

/** Where a review Edit link points. */
export type EditTarget = "service" | "options" | "provider" | "location" | "time" | "details" | "intake";

/** The step an Edit link lands on, by target; null when the plan has none. */
export function editTargetStep(steps: CardStep[], target: EditTarget): CardStep | null {
  if (target === "details") {
    return steps.find((s) => s.kind === "screen" && contactFields(s.fields).length > 0) ?? null;
  }
  if (target === "intake") return steps.find((s) => s.kind === "screen") ?? null;
  return steps.find((s) => s.kind === target) ?? null;
}

export function ids(sessionId: string): {
  ask(id: StepId): string;
  reply(id: StepId): string;
  confirmedAsk: string;
  /** True when a message id belongs to this session. */
  owns(messageId: string | undefined): boolean;
} {
  return {
    ask: (id) => `${sessionId}:${id}:ask`,
    reply: (id) => `${sessionId}:${id}:reply`,
    confirmedAsk: `${sessionId}:confirmed:ask`,
    owns: (messageId) => !!messageId && messageId.startsWith(`${sessionId}:`),
  };
}

export function emptySelection(preselectServiceId: string | null, timezone: string): BookingSelection {
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
    timezone,
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

/**
 * The selection with a (new) service: options reset, and a provider already
 * chosen who doesn't perform it let go — provider may come before service in
 * the business's flow, and the server never sees a pair it would refuse.
 */
export function withService(flow: BookingFlow, sel: BookingSelection, serviceId: string): BookingSelection {
  const next = flow.services.find((s) => s.id === serviceId) ?? null;
  const keepStaff = !sel.staffId || providerCandidates(flow, next).some((s) => s.id === sel.staffId);
  return reconcileSelection(flow, [], {
    ...sel,
    serviceId,
    variantId: null,
    addonIds: [],
    quantity: 1,
    staffId: keepStaff ? sel.staffId : null,
  });
}

/**
 * The invariant every write keeps: nothing in the selection names something
 * the flow no longer offers for the chosen service. Answers are kept even
 * when their question is hidden — a condition can flip back.
 */
export function reconcileSelection(flow: BookingFlow, fields: ReadonlyArray<FlowField>, sel: BookingSelection): BookingSelection {
  void flow;
  void fields;
  // Contract stub — Team T fills in the rules (service/variant/add-ons/quantity,
  // provider candidates, mode + location offered, address cleared off mobile).
  return sel;
}

/** Whether a planned step holds an answer the server would accept. */
export function stepValid(flow: BookingFlow, fields: ReadonlyArray<FlowField>, step: CardStep, sel: BookingSelection): boolean {
  void flow;
  void fields;
  void step;
  void sel;
  // Contract stub — Team T.
  return true;
}

/** The first planned step the thread has not asked yet. */
export function nextUnasked(steps: CardStep[], asked: ReadonlyArray<StepId>): CardStep | null {
  return steps.find((s) => !asked.includes(stepId(s))) ?? null;
}

/** Whether every step before review is answered and valid; else what is missing. */
export function reviewReady(
  flow: BookingFlow,
  fields: ReadonlyArray<FlowField>,
  steps: CardStep[],
  sel: BookingSelection,
  answered: ReadonlyArray<StepId>,
): { ok: true } | { ok: false; missing: StepId[] } {
  const missing = steps
    .filter((s) => s.kind !== "review" && s.kind !== "options")
    .filter((s) => !answered.includes(stepId(s)) || !stepValid(flow, fields, s, sel))
    .map(stepId);
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** The assistant's line before a step's card: the business's own title when it has one. */
export function intro(step: CardStep, flow: BookingFlow): string {
  void flow;
  switch (step.kind) {
    case "service":
      return "Which service would you like?";
    case "options":
      return "Any options or add-ons?";
    case "provider":
      return "Who would you like to see?";
    case "location":
      return "Where?";
    case "time":
      return "When works for you?";
    case "screen":
      return step.title;
    case "review":
      return step.title || "Here's your booking — check it over.";
  }
}

/** The shape of a chat message this module reasons about (lib/chatStore.ts StoredMsg). */
export type ThreadMsg = { id?: string; role: "user" | "assistant"; content: string };

/**
 * Give every stored `booking` block a session id (older chats predate them).
 * Pure: `newId` is injected. `changed` says whether anything was assigned.
 */
export function ensureBookingSessionIds<M extends { cards?: Array<{ type: string; sessionId?: string }> }>(
  msgs: M[],
  newId: () => string,
): { msgs: M[]; changed: boolean } {
  let changed = false;
  const out = msgs.map((m) => {
    if (!m.cards?.some((c) => c.type === "booking" && !c.sessionId)) return m;
    changed = true;
    return { ...m, cards: m.cards.map((c) => (c.type === "booking" && !c.sessionId ? { ...c, sessionId: newId() } : c)) };
  });
  return { msgs: out, changed };
}

/**
 * The history the model is sent: no empty turns, and each booking session's
 * ask/reply lines folded into ONE user line ("Booking so far: …") at the
 * position of its last reply, so a six-step booking never crowds the window.
 */
export function foldBookingLines(msgs: ReadonlyArray<ThreadMsg>): { role: "user" | "assistant"; content: string }[] {
  // Contract stub — Team T folds; for now: drop empties, keep the rest.
  return msgs.filter((m) => m.content.trim()).map(({ role, content }) => ({ role, content }));
}

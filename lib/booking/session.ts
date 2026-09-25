import type { BookingFlow, BookingSelection } from "./types";
import { isFieldShown, resolveAnswer } from "../appointmentTypes";
import { contactFields, offeringLocations, providerCandidates, type CardStep, type FlowField } from "./flowSteps";

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
  void fields;
  const next: BookingSelection = { ...sel, addonIds: [...sel.addonIds] };
  const service = next.serviceId ? (flow.services.find((s) => s.id === next.serviceId && s.enabled) ?? null) : null;

  if (!service) {
    next.serviceId = null;
    next.variantId = null;
    next.addonIds = [];
    next.quantity = 1;
  } else {
    if (next.variantId && !service.variants.some((v) => v.id === next.variantId)) next.variantId = null;
    next.addonIds = next.addonIds.filter((id) => service.addons.some((a) => a.id === id));
    const max = Math.max(1, service.maxQuantity ?? 20);
    const q = Number.isFinite(next.quantity) ? Math.round(next.quantity) : 1;
    next.quantity = Math.min(max, Math.max(1, q));
  }

  if (next.staffId && !providerCandidates(flow, service).some((s) => s.id === next.staffId)) next.staffId = null;

  const modes = service?.modes ?? [];
  if (next.mode !== "in_person" && !modes.includes(next.mode)) {
    if (next.mode === "mobile") {
      next.customerAddress = "";
      next.postalCode = "";
    }
    next.mode = "in_person";
    next.locationId = null;
  }
  if (next.mode === "in_person" && next.locationId && !offeringLocations(flow, service).some((l) => l.id === next.locationId)) {
    next.locationId = null;
  }
  return next;
}

/** Whether a planned step holds an answer the server would accept. */
export function stepValid(flow: BookingFlow, fields: ReadonlyArray<FlowField>, step: CardStep, sel: BookingSelection): boolean {
  switch (step.kind) {
    case "service":
      return !!sel.serviceId;
    case "options":
      return true;
    case "provider":
      return flow.rules.staffSelection !== "required" || !!sel.staffId;
    case "location": {
      // The rule LocationStep's Next button keeps.
      const service = flow.services.find((s) => s.id === sel.serviceId) ?? null;
      const businesses = offeringLocations(flow, service).filter((l) => l.kind === "business");
      return sel.mode === "online" || sel.mode === "mobile" || !!sel.locationId || businesses.length === 0;
    }
    case "time":
      return sel.startsAt !== "";
    case "screen": {
      const keys = fields.map((f) => f.key);
      return step.fields.every((f) => {
        if (!isFieldShown({ key: f.key, config: f.config ?? {} }, sel.answers, keys)) return true;
        const verdict = resolveAnswer({ label: f.label, type: f.type, config: f.config ?? {} }, sel.answers[f.key]);
        if (!verdict.ok) return false;
        return !f.required || verdict.value !== "";
      });
    }
    case "review":
      return true;
  }
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
  const sessionOf = (id: string | undefined): string | null => {
    if (!id) return null;
    const m = SESSION_MESSAGE_RE.exec(id);
    return m ? m[1] : null;
  };

  // Sessions in order of first appearance, each with its reply lines and the
  // index its folded line takes: the last reply, else the last owned message.
  const sessions = new Map<string, { replies: string[]; at: number }>();
  msgs.forEach((m, i) => {
    const sid = sessionOf(m.id);
    if (!sid) return;
    const entry = sessions.get(sid) ?? { replies: [], at: i };
    const content = m.content.trim();
    if (m.role === "user" && m.id!.endsWith(":reply") && content) {
      entry.replies.push(content);
      entry.at = i;
    } else if (entry.replies.length === 0) {
      entry.at = i;
    }
    sessions.set(sid, entry);
  });

  const kept = new Set([...sessions.keys()].slice(-MAX_FOLDED_SESSIONS));
  const lineFor = (entry: { replies: string[] }): string => {
    const done = entry.replies.find((r) => /^(Booked|Requested|Waitlisted):/.test(r));
    if (done) return done;
    if (entry.replies.length === 0) return "Booking so far: nothing picked yet";
    return `Booking so far: ${entry.replies.join("; ")}`;
  };

  const out: { role: "user" | "assistant"; content: string }[] = [];
  msgs.forEach((m, i) => {
    const sid = sessionOf(m.id);
    if (!sid) {
      if (m.content.trim()) out.push({ role: m.role, content: m.content });
      return;
    }
    const entry = sessions.get(sid)!;
    if (entry.at !== i || !kept.has(sid)) return;
    out.push({ role: "user", content: lineFor(entry) });
  });
  return out;
}

/** A message id a booking session owns: `<sid>:start`, `<sid>:<step>:ask|reply`, `<sid>:confirmed:ask`. */
const SESSION_MESSAGE_RE = /^(.+?):(?:start|(?:service|options|provider|location|time|screen:\d+|review|confirmed):(?:ask|reply))$/;

/** Sessions older than the last few are left out of what the model sees. */
const MAX_FOLDED_SESSIONS = 3;

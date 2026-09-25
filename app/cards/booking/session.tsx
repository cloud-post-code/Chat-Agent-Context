"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { FlowField } from "@/lib/booking/flowSteps";
import { emptySelection, reconcileSelection, type StepId } from "@/lib/booking/session";
import type { BookingFlow, BookingSelection } from "@/lib/booking/types";
import type { CreateBookingResult } from "./api";

/**
 * A booking session's state: what the visitor has picked, which steps the
 * thread has asked and which are answered, and how it ended. One store per
 * session, shared by every card of that session in the thread (the service
 * card, the time card and the review card all read one selection), kept in
 * localStorage so a reload finds the picks the transcript's cards refer to.
 *
 * Only the persisted part is saved: the flow and the fields already live in
 * the saved transcript's `booking` block, and the card seeds them back into
 * the store when it mounts. Modelled on app/cards/cart.tsx: an external
 * store, not React state, because cards in different messages must see one
 * selection and the thread controller (thread.ts) writes to it from outside
 * any component.
 */

export type BookingSessionPersisted = {
  sessionId: string;
  selection: BookingSelection;
  asked: StepId[];
  answered: StepId[];
  confirmed: { result: CreateBookingResult; waitlisted: boolean } | null;
  status: "live" | "confirmed" | "abandoned";
  preselectServiceId: string | null;
};

export type BookingSessionState = BookingSessionPersisted & { flow: BookingFlow | null; fields: FlowField[] };

type Listener = () => void;

const STATUSES: ReadonlyArray<BookingSessionPersisted["status"]> = ["live", "confirmed", "abandoned"];

/** The visitor's own zone, for the empty selection; "" when unknown. */
export function visitorTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function freshPersisted(sessionId: string): BookingSessionPersisted {
  return {
    sessionId,
    selection: emptySelection(null, visitorTimezone()),
    asked: [],
    answered: [],
    confirmed: null,
    status: "live",
    preselectServiceId: null,
  };
}

const isStepIdList = (v: unknown): v is StepId[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** A stored session, or null when the JSON is missing, corrupt or not a session. */
function parsePersisted(raw: string | null, sessionId: string): BookingSessionPersisted | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Partial<BookingSessionPersisted>;
  if (!p.selection || typeof p.selection !== "object") return null;
  if (!isStepIdList(p.asked) || !isStepIdList(p.answered)) return null;
  const fresh = freshPersisted(sessionId);
  return {
    sessionId,
    selection: { ...fresh.selection, ...p.selection },
    asked: p.asked,
    answered: p.answered,
    confirmed: p.confirmed && typeof p.confirmed === "object" && p.confirmed.result ? p.confirmed : null,
    status: STATUSES.includes(p.status as BookingSessionPersisted["status"]) ? (p.status as BookingSessionPersisted["status"]) : "live",
    preselectServiceId: typeof p.preselectServiceId === "string" ? p.preselectServiceId : null,
  };
}

export class BookingSessionStore {
  private state: BookingSessionState;
  /** What the server (and the first client render) sees: never storage. */
  private readonly initial: BookingSessionState;
  private listeners = new Set<Listener>();
  private storageKey: string | null;

  constructor(slug: string | null, sessionId: string) {
    this.storageKey = slug ? `booking:${slug}:${sessionId}` : null;
    this.initial = { ...freshPersisted(sessionId), flow: null, fields: [] };
    this.state = { ...(this.load(sessionId) ?? freshPersisted(sessionId)), flow: null, fields: [] };
  }

  private load(sessionId: string): BookingSessionPersisted | null {
    if (!this.storageKey || typeof window === "undefined") return null;
    try {
      return parsePersisted(window.localStorage.getItem(this.storageKey), sessionId);
    } catch {
      return null;
    }
  }

  private save() {
    if (!this.storageKey || typeof window === "undefined") return;
    const { flow, fields, ...persisted } = this.state;
    void flow;
    void fields;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(persisted));
    } catch {
      /* private mode or quota — the live session still works */
    }
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  get = (): BookingSessionState => this.state;

  getServerSnapshot = (): BookingSessionState => this.initial;

  private set(next: BookingSessionState) {
    this.state = next;
    this.save();
    for (const l of [...this.listeners]) l();
  }

  /** Give the store its flow and fields (from the session's block); a no-op once seeded. */
  seed(flow: BookingFlow, fields: FlowField[]): void {
    if (this.state.flow) return;
    const selection = reconcileSelection(flow, fields, {
      ...this.state.selection,
      timezone: this.state.selection.timezone || visitorTimezone() || flow.business.timezone,
    });
    this.set({ ...this.state, flow, fields, selection });
  }

  /** Apply a change; the selection is reconciled against the flow when it is known. */
  update(fn: (s: BookingSessionState) => BookingSessionState): void {
    const next = fn(this.state);
    const selection = next.flow ? reconcileSelection(next.flow, next.fields, next.selection) : next.selection;
    this.set({ ...next, selection });
  }

  /** Back to an untouched session (flow and fields kept); storage forgotten. */
  clear(): void {
    if (this.storageKey && typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(this.storageKey);
      } catch {
        /* nothing to forget */
      }
    }
    const { flow, fields } = this.state;
    const fresh = freshPersisted(this.state.sessionId);
    this.set({
      ...fresh,
      selection: flow ? reconcileSelection(flow, fields, { ...fresh.selection, timezone: fresh.selection.timezone || flow.business.timezone }) : fresh.selection,
      flow,
      fields,
    });
  }
}

/** Every session of one agent's chat, created on first use. */
export class BookingSessions {
  private stores = new Map<string, BookingSessionStore>();

  constructor(private readonly slug: string | null) {}

  get(sessionId: string): BookingSessionStore {
    let store = this.stores.get(sessionId);
    if (!store) {
      store = new BookingSessionStore(this.slug, sessionId);
      this.stores.set(sessionId, store);
    }
    return store;
  }

  /** The newest session still in progress, among those this chat has touched. */
  live(): BookingSessionStore | null {
    let found: BookingSessionStore | null = null;
    for (const store of this.stores.values()) {
      if (store.get().status === "live") found = store;
    }
    return found;
  }
}

type SessionsContextValue = { sessions: BookingSessions; preview: boolean };

const SessionsContext = createContext<SessionsContextValue | null>(null);

/** Cards outside a provider (the admin preview, a stray render) get throwaway in-memory sessions. */
let fallback: SessionsContextValue | null = null;

export function BookingSessionsProvider({
  slug,
  preview = false,
  children,
}: {
  slug: string;
  /** A preview never touches storage or a real booking. */
  preview?: boolean;
  children: React.ReactNode;
}) {
  const value = useMemo<SessionsContextValue>(() => ({ sessions: new BookingSessions(preview ? null : slug), preview }), [slug, preview]);
  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useBookingSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (ctx) return ctx;
  if (!fallback) fallback = { sessions: new BookingSessions(null), preview: false };
  return fallback;
}

export function useBookingSession(sessionId: string): { store: BookingSessionStore; state: BookingSessionState } {
  const { sessions } = useBookingSessions();
  const store = useMemo(() => sessions.get(sessionId), [sessions, sessionId]);
  const state = useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);
  return { store, state };
}

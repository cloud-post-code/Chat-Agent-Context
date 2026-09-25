"use client";

// STUB — replaced by Team T at merge. Exactly the contract's exports, the
// smallest working shapes: one store per session id, a provider that holds
// the registry, hooks over useSyncExternalStore.

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { FlowField } from "@/lib/booking/flowSteps";
import { emptySelection, type StepId } from "@/lib/booking/session";
import type { BookingFlow, BookingSelection } from "@/lib/booking/types";
import type { CreateBookingResult } from "./api";

export type BookingSessionState = {
  sessionId: string;
  selection: BookingSelection;
  asked: StepId[];
  answered: StepId[];
  confirmed: { result: CreateBookingResult; waitlisted: boolean } | null;
  status: "live" | "confirmed" | "abandoned";
  preselectServiceId: string | null;
  flow: BookingFlow | null;
  fields: FlowField[];
};

function zone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export class BookingSessionStore {
  private state: BookingSessionState;
  private listeners = new Set<() => void>();

  constructor(sessionId: string) {
    this.state = {
      sessionId,
      selection: emptySelection(null, zone()),
      asked: [],
      answered: [],
      confirmed: null,
      status: "live",
      preselectServiceId: null,
      flow: null,
      fields: [],
    };
  }
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  get = (): BookingSessionState => this.state;
  seed(flow: BookingFlow, fields: FlowField[]): void {
    this.update((s) => ({ ...s, flow, fields }));
  }
  update(fn: (s: BookingSessionState) => BookingSessionState): void {
    this.state = fn(this.state);
    this.listeners.forEach((l) => l());
  }
  clear(): void {
    this.update((s) => ({ ...s, status: "abandoned" }));
  }
}

export class BookingSessions {
  private stores = new Map<string, BookingSessionStore>();
  get(sessionId: string): BookingSessionStore {
    let s = this.stores.get(sessionId);
    if (!s) {
      s = new BookingSessionStore(sessionId);
      this.stores.set(sessionId, s);
    }
    return s;
  }
  /** The session under way, if any: started (asked something) and not yet done. */
  live(): BookingSessionStore | null {
    for (const s of this.stores.values()) {
      const st = s.get();
      if (st.status === "live" && st.asked.length > 0) return s;
    }
    return null;
  }
}

type Ctx = { sessions: BookingSessions; preview: boolean };
const SessionsContext = createContext<Ctx | null>(null);
const fallback: Ctx = { sessions: new BookingSessions(), preview: false };

export function BookingSessionsProvider({
  slug,
  preview = false,
  children,
}: {
  slug: string | null;
  preview?: boolean;
  children: ReactNode;
}) {
  void slug;
  const value = useMemo<Ctx>(() => ({ sessions: new BookingSessions(), preview }), [preview]);
  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useBookingSessions(): Ctx {
  return useContext(SessionsContext) ?? fallback;
}

export function useBookingSession(sessionId: string): { store: BookingSessionStore; state: BookingSessionState } {
  const { sessions } = useBookingSessions();
  const store = sessions.get(sessionId);
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { store, state };
}

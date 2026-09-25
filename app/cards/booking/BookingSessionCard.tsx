"use client";

import { useEffect, useState } from "react";
import { useChatThread, type ChatThread } from "@/app/ChatThread";
import { planSteps } from "@/lib/booking/flowSteps";
import { ids, nextUnasked, stepId, withService } from "@/lib/booking/session";
import type { BookingField } from "../BookingQuestion";
import type { UiBlock } from "../Cards";
import { getBookingFlow } from "./api";
import { LegacyWizard, toFlowFields } from "./BookingFlowCard";
import { BookingThread } from "./BookingThread";
import { useBookingSession, useBookingSessions } from "./session";
import { advanceBooking, bindSession, completeStep, reconcileThread } from "./thread";

/**
 * The START of a booking conversation: the server's `booking` block, given a
 * session id by the chat. Inside a chat thread it draws nothing itself — it
 * seeds the session's store from the block (or fetches the flow an old stored
 * block lacks), binds the store to the thread, and asks the first step, which
 * appears as the next card down. Outside a thread (a server render, the
 * onboarding preview) it draws a thread of its own (BookingThread).
 */

type BookingBlock = Extract<UiBlock, { type: "booking" }>;

export function BookingSessionCard({ block, slug }: { block: BookingBlock; slug: string }) {
  const thread = useChatThread();
  if (!thread || !block.sessionId) {
    return <BookingThread slug={slug} fields={block.fields} flow={block.flow ?? null} preselectServiceId={block.preselectServiceId ?? undefined} />;
  }
  return <SessionStart block={block} slug={slug} thread={thread} sessionId={block.sessionId} />;
}

type Mode =
  | { kind: "starting" }
  | { kind: "live" }
  /** Another booking is under way in this chat: nothing starts here. */
  | { kind: "elsewhere" }
  /** No flow to be had (fetch failed, or the tenant has none): the pre-flow wizard, inline. */
  | { kind: "legacy"; fields: BookingField[] };

function SessionStart({ block, slug, thread, sessionId }: { block: BookingBlock; slug: string; thread: ChatThread; sessionId: string }) {
  const { sessions } = useBookingSessions();
  const { store } = useBookingSession(sessionId);
  const [mode, setMode] = useState<Mode>({ kind: "starting" });
  const preselect = block.preselectServiceId ?? null;

  useEffect(() => {
    const other = sessions.live();
    if (other && other.get().sessionId !== sessionId) {
      setMode({ kind: "elsewhere" });
      return;
    }
    let cancelled = false;
    let unbind: (() => void) | null = null;

    async function run() {
      if (!store.get().flow) {
        if (block.flow) {
          store.seed(block.flow, toFlowFields(block.fields));
        } else {
          const res = await getBookingFlow(slug, preselect);
          if (cancelled) return;
          if (!res.ok || !res.flow) {
            setMode({ kind: "legacy", fields: res.ok && res.fields.length ? res.fields : block.fields });
            return;
          }
          store.seed(res.flow, toFlowFields(res.fields));
        }
      }
      if (preselect && store.get().preselectServiceId !== preselect) {
        store.update((s) => ({ ...s, preselectServiceId: preselect }));
      }
      reconcileThread(thread, store);
      unbind = bindSession(thread, store);
      setMode({ kind: "live" });

      const st = store.get();
      const flow = st.flow;
      if (!flow || st.asked.length > 0) return;
      const has = ids(sessionId);
      if (preselect) {
        // The visitor already tapped the service: no service card, its reply
        // line is written and the conversation goes on from the next step.
        store.update((s) => ({ ...s, selection: withService(flow, s.selection, preselect) }));
        const planned = planSteps(flow, st.fields, store.get().selection);
        const expected = nextUnasked(planned, [...st.asked, "service"]);
        // Loaded from storage when the next step's ask is already in the thread: no typing then.
        const loaded = !!expected && thread.has(has.ask(stepId(expected)));
        completeStep(thread, store, "service");
        const after = store.get();
        const next = nextUnasked(planSteps(flow, after.fields, after.selection), after.asked);
        if (expected && next && stepId(next) === stepId(expected)) advanceBooking(thread, store, { skipTyping: loaded });
      } else {
        const first = nextUnasked(planSteps(flow, st.fields, st.selection), st.asked);
        const loaded = !!first && thread.has(has.ask(stepId(first)));
        advanceBooking(thread, store, { skipTyping: loaded });
      }
    }
    void run();
    return () => {
      cancelled = true;
      unbind?.();
    };
    // The block is the session's fixed start; only its id matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (mode.kind === "elsewhere") {
    return (
      <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--on-bg-soft)", margin: 0 }}>
        Your booking is in progress above — keep going there, or say &apos;start over&apos;.
      </p>
    );
  }
  if (mode.kind === "legacy") return <LegacyWizard slug={slug} fields={mode.fields} />;
  return null;
}

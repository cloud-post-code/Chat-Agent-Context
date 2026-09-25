"use client";

import { useEffect, useRef, useState } from "react";
import { Bubble as ChatBubble } from "@/app/ChatBubble";
import { LocalChatThreadProvider, useChatThread } from "@/app/ChatThread";
import type { StoredMsg } from "@/lib/chatStore";
import type { BookingFlow } from "@/lib/booking/types";
import type { BookingField } from "../BookingQuestion";
import { getBookingFlow } from "./api";
import { toFlowFields } from "./BookingFlowCard";
import { BookingSessionsProvider, useBookingSessions } from "./session";
import { startSession } from "./thread";

/** The one line drawn when there is no flow to book through (booking off, or the fetch failed). */
export function BookingUnavailable() {
  return (
    <p data-booking-unavailable="" style={{ fontSize: 13, fontStyle: "italic", color: "var(--on-bg-soft)", margin: 0 }}>
      Booking is unavailable right now.
    </p>
  );
}

/**
 * A booking conversation with a thread of its own — for a booking that sits
 * outside the visitor chat: the services card on a server-rendered page, and
 * the owner trying their form in onboarding (`preview`). The same cards, the
 * same controller; only the thread is local. A block with no flow (an old
 * stored sample) fetches one first; until it arrives nothing is drawn, and
 * when none comes back one line says booking is unavailable.
 */
export function BookingThread({
  slug,
  fields,
  flow,
  preselectServiceId,
  preview = false,
}: {
  slug: string;
  fields: BookingField[];
  flow: BookingFlow | null;
  preselectServiceId?: string | null;
  preview?: boolean;
}) {
  const [remote, setRemote] = useState<{ flow: BookingFlow; fields: BookingField[] } | null>(flow ? { flow, fields } : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (flow) return;
    let cancelled = false;
    getBookingFlow(slug, preselectServiceId ?? undefined).then((res) => {
      if (cancelled) return;
      if (!res.ok || !res.flow) {
        setFailed(true);
        return;
      }
      setRemote({ flow: res.flow, fields: res.fields });
    });
    return () => {
      cancelled = true;
    };
  }, [slug, flow, preselectServiceId]);

  if (!remote) return failed ? <BookingUnavailable /> : null;

  return (
    <LocalChatThreadProvider slug={slug} initial={[]}>
      {(msgs) => (
        <BookingSessionsProvider slug={slug} preview={preview}>
          <ThreadColumn
            slug={slug}
            msgs={msgs}
            flow={remote.flow}
            fields={remote.fields}
            preselectServiceId={preselectServiceId ?? remote.flow.preselect.serviceId}
            preview={preview}
          />
        </BookingSessionsProvider>
      )}
    </LocalChatThreadProvider>
  );
}

function ThreadColumn({
  slug,
  msgs,
  flow,
  fields,
  preselectServiceId,
  preview,
}: {
  slug: string;
  msgs: StoredMsg[];
  flow: BookingFlow;
  fields: BookingField[];
  preselectServiceId: string | null;
  preview: boolean;
}) {
  const thread = useChatThread();
  const { sessions } = useBookingSessions();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !thread) return;
    started.current = true;
    startSession(thread, sessions, { flow, fields: toFlowFields(fields), preselectServiceId, skipTyping: false });
    // Once, on mount: the thread then carries the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The other way to book stays in view until a service card carries it.
  const phone = flow.business.phone;
  const serviceCardShown = msgs.some((m) => m.cards?.some((c) => c.type === "booking_step" && c.step.kind === "service"));

  return (
    <div data-booking-thread="" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
      {preview && <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--on-bg-soft)", margin: 0 }}>Preview — nothing gets booked.</p>}
      {phone && !serviceCardShown && (
        <p style={{ fontSize: 13, margin: 0, color: "var(--on-bg-soft)" }}>
          Prefer to call? Book by phone:{" "}
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} style={{ color: "inherit", fontWeight: 600 }}>
            {phone}
          </a>
        </p>
      )}
      {msgs.map((m, i) => (
        <ChatBubble key={m.id ?? i} id={m.id} role={m.role} content={m.content} cards={m.cards} loading={false} slug={slug} typed={m.typed} />
      ))}
    </div>
  );
}

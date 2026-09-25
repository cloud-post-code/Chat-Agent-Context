"use client";

import { useEffect, useRef, useState } from "react";
import { Typewriter } from "@/app/admin/onboarding/ActivityStream";
import { Cards, type UiBlock } from "./cards/Cards";
import { Markdown } from "./Markdown";

/**
 * One message of the visitor chat. Two layouts:
 *
 *  - Streamed (the model's answer): its A2UI cards lead and the words follow,
 *    as the thread has always drawn them.
 *  - Typed (`typed`: a line the page itself says — a booking step's intro):
 *    the words type in letter by letter ABOVE the card, and the card mounts
 *    only once they are done, the way the onboarding chat introduces each of
 *    its cards. A typed message with no words shows its cards at once.
 *
 * `onSettled` fires when the cards mount, so the thread can scroll to them
 * after a typed intro rather than at the moment the message was added.
 */
export function Bubble({
  id,
  role,
  content,
  cards,
  typed,
  loading,
  slug,
  onSettled,
}: {
  id?: string;
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
  typed?: boolean;
  loading: boolean;
  slug: string;
  onSettled?: () => void;
}) {
  const isUser = role === "user";
  const hasCards = !!cards && cards.length > 0;
  const types = !!typed && !isUser && content !== "";
  const [typingDone, setTypingDone] = useState(!types);
  const showCards = hasCards && (!types || typingDone);
  // A booking step's line introduces its card, so it leads — typed live or
  // restored from storage alike; every other card still leads its words.
  const textLeads =
    !isUser && content !== "" && !!cards?.some((c) => c.type === "booking_step" || c.type === "booking_confirmed");

  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  useEffect(() => {
    if (showCards) onSettledRef.current?.();
  }, [showCards]);

  const cardList = hasCards ? (
    <div style={{ width: "100%" }}>
      {cards!.map((c, i) => (
        <Cards key={i} block={c} slug={slug} />
      ))}
    </div>
  ) : null;

  if (types || textLeads) {
    return (
      <div data-message-id={id} style={{ ...styles.row, flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
        <div data-fill="surface" data-who="assistant" style={styles.botBubble}>
          {types ? <Typewriter text={content} onDone={() => setTypingDone(true)} /> : <Markdown text={content} />}
        </div>
        {showCards && cardList}
      </div>
    );
  }

  return (
    <div data-message-id={id} style={{ ...styles.row, flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {/* A2UI cards always lead; the agent's words follow. */}
      {hasCards && <div style={{ width: "100%", marginBottom: content ? 8 : 0 }}>{cardList}</div>}
      {(content || !hasCards) && (
        <div data-fill="surface" data-who={isUser ? "user" : "assistant"} style={isUser ? styles.userBubble : styles.botBubble}>
          {content ? (
            isUser ? (
              <span style={{ whiteSpace: "pre-wrap" }}>{content}</span>
            ) : (
              <Markdown text={content} />
            )
          ) : loading ? (
            <span style={styles.typing}>
              <i style={{ ...styles.tdot, animationDelay: "0ms" }} />
              <i style={{ ...styles.tdot, animationDelay: "150ms" }} />
              <i style={{ ...styles.tdot, animationDelay: "300ms" }} />
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: "flex", width: "100%" },
  // User and bot bubbles share one look; only alignment and the tucked corner
  // differ, so both sides of the conversation read identically.
  userBubble: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--on-surface)",
    padding: "12px 16px",
    borderRadius: "var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg)",
    maxWidth: "80%",
    fontSize: 15,
    lineHeight: 1.5,
  },
  botBubble: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    color: "var(--on-surface)",
    padding: "12px 16px",
    borderRadius: "var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm)",
    maxWidth: "80%",
    fontSize: 15,
    lineHeight: 1.5,
  },
  typing: { display: "inline-flex", gap: 5, alignItems: "center", height: 20 },
  tdot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    // The dots sit inside a surface bubble, so they take that fill's
    // foreground — --primary-soft was the surface fill itself and vanished.
    background: "var(--on-surface)",
    display: "inline-block",
    animation: "blink 1s infinite",
  },
};

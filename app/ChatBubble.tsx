"use client";

import { Cards, type UiBlock } from "./cards/Cards";
import { Markdown } from "./Markdown";

/**
 * One message of the visitor chat. The agent's A2UI cards lead and its words
 * follow; a visitor's message is its text alone. While an answer is still
 * streaming with nothing said yet, the bubble shows the typing dots.
 */
export function Bubble({
  id,
  role,
  content,
  cards,
  loading,
  slug,
}: {
  id?: string;
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
  loading: boolean;
  slug: string;
}) {
  const isUser = role === "user";
  const hasCards = !!cards && cards.length > 0;

  return (
    <div data-message-id={id} style={{ ...styles.row, flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {/* A2UI cards always lead; the agent's words follow. */}
      {hasCards && (
        <div style={{ width: "100%", marginBottom: content ? 8 : 0 }}>
          {cards!.map((c, i) => (
            <Cards key={i} block={c} slug={slug} />
          ))}
        </div>
      )}
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

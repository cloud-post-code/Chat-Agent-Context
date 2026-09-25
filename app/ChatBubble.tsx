"use client";

// STUB — replaced by Team T at merge (the visitor Bubble moves here, with the
// typed-in line and the cards shown after it). Plain renderer: cards above text.

import type { UiBlock } from "./cards/Cards";
import { Cards } from "./cards/Cards";

export function ChatBubble({
  id,
  role,
  content,
  cards,
  loading,
  slug,
  typed,
  onSettled,
}: {
  id?: string;
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
  loading: boolean;
  slug: string;
  typed?: boolean;
  onSettled?: () => void;
}) {
  void id;
  void loading;
  void typed;
  void onSettled;
  const isUser = role === "user";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {cards && cards.length > 0 && (
        <div style={{ width: "100%", marginBottom: content ? 8 : 0 }}>
          {cards.map((c, i) => (
            <Cards key={i} block={c} slug={slug} />
          ))}
        </div>
      )}
      {content && (
        <div
          data-fill="surface"
          style={{
            background: "var(--surface)",
            color: "var(--on-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "10px 14px",
            fontSize: 14,
            maxWidth: "85%",
            whiteSpace: "pre-wrap",
          }}
        >
          {content}
        </div>
      )}
    </div>
  );
}

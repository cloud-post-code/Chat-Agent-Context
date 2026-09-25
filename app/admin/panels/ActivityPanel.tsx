import { deleteChatSession } from "@/app/admin/actions/chat";
import { PendingButton } from "../PendingButton";
import { panel, btnDanger, SectionTitle, Label, Stat } from "../ui";
import { Empty, MessageRow } from "./shared";
import type { AdminData } from "./queries";

export function ActivityPanel({ data }: { data: AdminData }) {
  const { chatSessions, metrics } = data;
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Activity — visitor conversations</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 14 }}>
        Every conversation people have with your chatbot is recorded here — their
        questions and the answers they got. Click any chat to read the full transcript.
      </p>

      {chatSessions.length === 0 ? (
        <Empty>No conversations yet. They&apos;ll appear here as visitors chat.</Empty>
      ) : (
        <>
          {/* ── Metrics overview ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <Stat label="Chats" value={metrics.totalChats} />
            <Stat label="This week" value={metrics.chatsThisWeek} />
            <Stat label="Questions" value={metrics.totalQuestions} />
            <Stat label="Messages" value={metrics.totalMessages} />
            <Stat label="Avg / chat" value={metrics.avgQuestions} />
            <Stat label="Flagged 👎" value={metrics.flaggedDown} />
          </div>

          {/* ── Most-asked questions ── */}
          {metrics.topQuestions.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <Label>Most asked</Label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {metrics.topQuestions.map((q) => (
                  <div
                    key={q.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "7px 12px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        minWidth: 0,
                      }}
                    >
                      {q.label}
                    </span>
                    <span
                      style={{
                        flexShrink: 0,
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--accent-on-bg-soft)",
                        background: "var(--bg-soft)",
                        borderRadius: "var(--radius-pill)",
                        padding: "1px 9px",
                      }}
                    >
                      {q.count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Label>All conversations</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {chatSessions.map((s) => (
          <details key={s.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "12px 14px" }}>
            <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", listStyle: "none" }}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ fontSize: 14, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.firstQuery || "(no question)"}
                </strong>
                <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 11 }}>
                  {s.messages.length} messages · {s.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
                </span>
              </span>
              <form action={deleteChatSession}>
                <input type="hidden" name="id" value={s.id} />
                <PendingButton pendingLabel="Deleting…" style={btnDanger as React.CSSProperties}>
                  Delete
                </PendingButton>
              </form>
            </summary>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {s.messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </div>
          </details>
        ))}
          </div>
        </>
      )}
    </section>
  );
}

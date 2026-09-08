"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Markdown } from "@/app/Markdown";
import type { IngestProposal } from "@/lib/adminBrain";
import { CLASSIFICATION_LABELS } from "@/lib/ingestionSources";
import { approveIngestionAction, logout } from "../actions";
import { PendingButton } from "../PendingButton";
import { btnGhost, field } from "../ui";

/**
 * The chat-first admin surface's client. Panels arrive fully server-rendered
 * in `panels` and are revealed inline when the copilot emits a panel event —
 * the chat stores only the key, so a router.refresh() after any write
 * re-renders every revealed panel with fresh data. Approval cards hold the
 * copilot's pre-filled ingestion draft; nothing is written until Approve.
 */

type ChatItem =
  | { kind: "panel"; key: string }
  | { kind: "approve"; proposal: IngestProposal };

type Msg = { role: "user" | "assistant"; content: string; items: ChatItem[] };

const STARTERS = [
  "Show me my goals",
  "What are visitors asking?",
  "Ingest a document",
  "Show my ingestion sources",
];

export function AdminChat({
  name,
  slug,
  menu,
  labels,
  panels,
}: {
  name: string;
  slug: string;
  menu: Array<{ key: string; label: string }>;
  labels: Record<string, string>;
  panels: Record<string, React.ReactNode>;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showStarters, setShowStarters] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /** Put a panel straight into the conversation — no model call, zero clicks wasted. */
  function reveal(key: string) {
    setMenuOpen(false);
    setMessages((m) => [...m, { role: "assistant", content: "", items: [{ kind: "panel", key }] }]);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((m) => [
      ...m,
      { role: "user", content: q, items: [] },
      { role: "assistant", content: "", items: [] },
    ]);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      const items: ChatItem[] = [];
      let wrote = false;

      const apply = () =>
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc, items: [...items] };
          return copy;
        });

      const flush = (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const obj = JSON.parse(l);
            if (obj.t === "text") acc += obj.v;
            else if (obj.t === "panel") items.push({ kind: "panel", key: String(obj.v) });
            else if (obj.t === "approve") items.push({ kind: "approve", proposal: obj.v });
            else if (obj.t === "goal") wrote = true;
          } catch {
            /* partial line — ignore */
          }
        }
        apply();
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        flush(decoder.decode(value, { stream: true }));
      }
      // A tool wrote data mid-chat: refresh so every revealed panel shows it.
      if (wrote) router.refresh();
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content: "Hmm, I hit a snag reaching the copilot. Try again in a moment.",
          items: [],
        };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* ── Header: menu (the classic pages), identity, logout ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 0 14px",
          borderBottom: "1px solid var(--border)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          style={{ ...(btnGhost as React.CSSProperties), fontWeight: 600 }}
        >
          ☰ Menu
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 16 }}>Control room</strong>
          <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginLeft: 8 }}>
            {name} · <a href={`/a/${slug}`}>/a/{slug}</a>
          </span>
        </div>
        <form action={logout}>
          <PendingButton pendingLabel="…" style={btnGhost as React.CSSProperties}>
            Log out
          </PendingButton>
        </form>

        {menuOpen && (
          <nav
            role="menu"
            data-fill="surface"
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              zIndex: 20,
              marginTop: 6,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 8,
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(140px, 1fr))",
              gap: 2,
              boxShadow: "var(--glow-primary)",
            }}
          >
            {menu.map((m) => (
              <button
                key={m.key}
                type="button"
                role="menuitem"
                onClick={() => reveal(m.key)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 14,
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                }}
              >
                {m.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      {/* ── Conversation ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, padding: "18px 0" }}>
        {messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", maxWidth: 480 }}>
            <h1 style={{ fontSize: 22, marginBottom: 6 }}>What do you want to do?</h1>
            <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14, marginBottom: 16 }}>
              Ask for any part of your control room and it appears right here —
              or just say the thing you want done.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  style={{ ...(btnGhost as React.CSSProperties), fontSize: 13 }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {m.role === "user" ? (
              <div
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "85%",
                  background: "var(--primary)",
                  color: "var(--on-primary)",
                  borderRadius: "var(--radius-md)",
                  padding: "9px 13px",
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.content}
              </div>
            ) : (
              <>
                {m.content && (
                  <div style={{ alignSelf: "flex-start", maxWidth: "85%", fontSize: 14 }}>
                    <Markdown text={m.content} />
                  </div>
                )}
                {m.items.map((item, j) =>
                  item.kind === "panel" ? (
                    <PanelBubble key={j} label={labels[item.key] ?? item.key}>
                      {panels[item.key] ?? (
                        <p style={{ fontStyle: "italic", fontSize: 13 }}>
                          That panel isn&apos;t available.
                        </p>
                      )}
                    </PanelBubble>
                  ) : (
                    <ApprovalCard
                      key={j}
                      proposal={item.proposal}
                      sourceLabel={labels[item.proposal.sourceKey] ?? item.proposal.sourceKey}
                      onDone={() => router.refresh()}
                    />
                  ),
                )}
                {i === messages.length - 1 && loading && !m.content && m.items.length === 0 && (
                  <span style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13 }}>
                    thinking…
                  </span>
                )}
              </>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* ── Composer, with the starter questions one tap away again ── */}
      <div style={{ position: "sticky", bottom: 0, paddingBottom: 8, background: "var(--bg, transparent)" }}>
        {showStarters && messages.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 0 10px" }}>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setShowStarters(false);
                  send(s);
                }}
                style={{ ...(btnGhost as React.CSSProperties), fontSize: 13 }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => setShowStarters((s) => !s)}
            aria-expanded={showStarters}
            aria-label="Show suggested questions"
            title="Suggested questions"
            style={{ ...(btnGhost as React.CSSProperties), fontSize: 15 }}
          >
            ✦
          </button>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send(input))}
          placeholder="Show me my goals · add a goal · ingest a document…"
          aria-label="Message the admin copilot"
          style={{ ...field, marginBottom: 0, flex: 1 }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 18px",
            background: "var(--primary)",
            color: "var(--on-primary)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontWeight: 600,
            opacity: loading ? 0.6 : 1,
          }}
        >
          Send
        </button>
      </form>
      </div>
    </>
  );
}

/** A dashboard panel revealed inline: label bar over the real panel. */
function PanelBubble({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
      <div
        data-fill="bg-soft"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "var(--bg-soft)",
          color: "var(--on-bg-soft)",
          borderBottom: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        <strong>{label}</strong>
      </div>
      <div style={{ padding: 4 }}>{children}</div>
    </div>
  );
}

/**
 * The one-click ingestion approval: the copilot's pre-filled draft, editable,
 * written only when Approve is clicked. File/image methods expose the picker —
 * the one field a model can't fill.
 */
function ApprovalCard({
  proposal,
  sourceLabel,
  onDone,
}: {
  proposal: IngestProposal;
  sourceLabel: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(proposal.title ?? "");
  const [url, setUrl] = useState(proposal.url ?? "");
  const [text, setText] = useState(proposal.text ?? "");
  const [caption, setCaption] = useState(proposal.caption ?? "");
  const [classification, setClassification] = useState(proposal.classification ?? "public");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<"pending" | "busy" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);

  const needsFile = proposal.method === "file" || proposal.method === "image";

  async function approve() {
    if (state === "busy" || state === "done") return;
    if (needsFile && !file) {
      setError("Pick the file first.");
      return;
    }
    setState("busy");
    setError(null);
    const fd = new FormData();
    fd.set("sourceKey", proposal.sourceKey);
    fd.set("method", proposal.method);
    fd.set("title", title);
    fd.set("url", url);
    fd.set("text", text);
    fd.set("caption", caption);
    fd.set("classification", classification);
    if (file) fd.set("file", file);
    try {
      const result = await approveIngestionAction(fd);
      if (result.ok) {
        setState("done");
        onDone();
      } else {
        setState("error");
        setError(result.error ?? "The ingestion failed.");
      }
    } catch {
      setState("error");
      setError("The ingestion failed.");
    }
  }

  const done = state === "done";
  return (
    <div
      data-fill="surface"
      style={{
        border: "1px solid var(--primary)",
        borderRadius: "var(--radius-md)",
        padding: 14,
        background: "var(--surface)",
        maxWidth: 560,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 14 }}>
          {done ? "Ingested ✓" : "Ready to ingest"} → {sourceLabel}
        </strong>
        <span style={{ fontSize: 12, color: "var(--on-surface)", fontStyle: "italic" }}>
          {proposal.method}
        </span>
      </div>

      {proposal.method === "url" && (
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={done}
          aria-label="URL to ingest"
          style={{ ...field, marginBottom: 8 }}
        />
      )}
      {(proposal.method === "text" || proposal.method === "file") && (
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          disabled={done}
          aria-label="Title"
          style={{ ...field, marginBottom: 8 }}
        />
      )}
      {proposal.method === "text" && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          disabled={done}
          aria-label="Text to ingest"
          style={{ ...field, marginBottom: 8, resize: "vertical" }}
        />
      )}
      {proposal.method === "image" && (
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption"
          disabled={done}
          aria-label="Caption"
          style={{ ...field, marginBottom: 8 }}
        />
      )}
      {needsFile && (
        <input
          type="file"
          accept={proposal.method === "image" ? "image/*" : ".pdf,.docx,.doc,.txt,.md"}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={done}
          aria-label="File to ingest"
          style={{ ...field, marginBottom: 8 }}
        />
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          disabled={done}
          aria-label="Classification"
          style={{ ...field, marginBottom: 0, width: "auto" }}
        >
          {Object.entries(CLASSIFICATION_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={approve}
          disabled={state === "busy" || done}
          style={{
            padding: "9px 20px",
            background: done ? "var(--bg-soft)" : "var(--primary)",
            color: done ? "var(--on-bg-soft)" : "var(--on-primary)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontWeight: 700,
            opacity: state === "busy" ? 0.6 : 1,
          }}
        >
          {state === "busy" ? "Ingesting…" : done ? "Done" : "Approve"}
        </button>
        {error && (
          <span style={{ color: "var(--danger-on-surface)", fontSize: 13 }}>{error}</span>
        )}
      </div>
    </div>
  );
}

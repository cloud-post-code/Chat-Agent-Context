"use client";

import { useRef, useState, useEffect } from "react";
import { Cards, type UiBlock } from "./cards/Cards";
import { Markdown } from "./Markdown";
import {
  listChats,
  loadMessages,
  saveChat,
  deleteChat,
  newChatId,
  type ChatMeta,
} from "@/lib/chatStore";

type Msg = {
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
};
type Starter = { q: string };

/** localStorage, or null when unavailable (private mode) — history is then off. */
function store(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    window.localStorage.getItem("chats:probe");
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function Chat({
  name,
  tagline,
  logo,
  starters,
  slug,
}: {
  name: string;
  tagline: string;
  logo?: string | null;
  starters: Starter[];
  /** Whose agent this page chats with — sent with every /api/chat call. */
  slug: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // One id per conversation: it doubles as the /api/chat sessionId, so each
  // sidebar chat is one ChatSession in the admin Activity tab.
  const [chatId, setChatId] = useState<string>(() => newChatId());
  const started = messages.length > 0;

  // Saved conversations for this agent, from the visitor's own localStorage.
  useEffect(() => {
    const s = store();
    if (s) setChats(listChats(s, slug));
  }, [slug]);

  // Persist the active chat once each exchange settles (not per stream chunk).
  // An emptied thread (New chat / Home) is not a chat — never save it.
  useEffect(() => {
    if (loading || messages.length === 0) return;
    const s = store();
    if (!s) return;
    try {
      saveChat(s, slug, chatId, messages);
      setChats(listChats(s, slug));
    } catch {
      /* quota full — the live conversation still works, history just lags */
    }
  }, [messages, loading, slug, chatId]);

  function openChat(id: string) {
    const s = store();
    if (!s) return;
    setChatId(id);
    setMessages(loadMessages(s, slug, id));
    setInput("");
    setSidebarOpen(false);
  }

  function startNewChat() {
    setChatId(newChatId());
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
  }

  function removeChat(id: string) {
    const s = store();
    if (!s) return;
    try {
      deleteChat(s, slug, id);
    } catch {
      /* storage failed — fall through, list refresh below reflects reality */
    }
    setChats(listChats(s, slug));
    if (id === chatId) startNewChat();
  }

  useEffect(() => {
    // Scroll the thread to the newest message after the DOM has painted it, so
    // a freshly added query (and its streaming answer) stays in view.
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [messages, loading]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setLoading(true);
    setMessages((m) => [...m, { role: "assistant", content: "", cards: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
          sessionId: chatId,
          slug,
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      const cards: UiBlock[] = [];

      const flush = (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const obj = JSON.parse(l);
            if (obj.t === "text") acc += obj.v;
            else if (obj.t === "card") cards.push(obj.v);
          } catch {
            /* partial line — ignore */
          }
        }
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc, cards: [...cards] };
          return copy;
        });
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        flush(decoder.decode(value, { stream: true }));
      }
    } catch {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = {
          role: "assistant",
          content:
            "Hmm, I hit a snag reaching my brain (the API). Try again in a moment — or use the contact info on this page.",
          cards: [],
        };
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  function goHome() {
    // The old thread is already saved; Home starts fresh so the next question
    // opens a new conversation instead of silently extending the last one.
    startNewChat();
  }

  const showSidebarToggle = chats.length > 0 || started;

  return (
    <main style={styles.shell}>
      {showSidebarToggle && (
        <button
          onClick={() => setSidebarOpen(true)}
          style={styles.sidebarToggle}
          title="Your chats"
          aria-label="Open chat history"
        >
          ☰ Chats
        </button>
      )}
      {sidebarOpen && (
        <>
          <div style={styles.sidebarBackdrop} onClick={() => setSidebarOpen(false)} />
          <aside style={styles.sidebar} data-fill="surface" aria-label="Chat history">
            <div style={styles.sidebarHeader}>
              <span style={styles.sidebarTitle}>Your chats</span>
              <button
                onClick={() => setSidebarOpen(false)}
                style={styles.sidebarClose}
                aria-label="Close chat history"
              >
                ✕
              </button>
            </div>
            <button onClick={startNewChat} style={styles.newChatBtn}>
              + New chat
            </button>
            <div style={styles.chatList}>
              {chats.length === 0 && <p style={styles.chatListEmpty}>Nothing yet — say hi!</p>}
              {chats.map((c) => (
                <div
                  key={c.id}
                  style={{
                    ...styles.chatItem,
                    ...(c.id === chatId ? styles.chatItemActive : {}),
                  }}
                >
                  <button onClick={() => openChat(c.id)} style={styles.chatItemBtn} title={c.title}>
                    {c.title}
                  </button>
                  <button
                    onClick={() => removeChat(c.id)}
                    style={styles.chatItemDelete}
                    title="Delete chat"
                    aria-label={`Delete chat: ${c.title}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
      {!started ? (
        <section style={styles.hero}>
          <h1 style={styles.h1}>
            Hey, I&apos;m {name}.<br />
            <span style={styles.h1accent}>Talk to me.</span>
          </h1>
          <p style={styles.sub}>{tagline}</p>

          <div style={styles.starters}>
            {starters.map((s) => (
              <button key={s.q} style={styles.chip} onClick={() => send(s.q)}>
                {s.q}
              </button>
            ))}
          </div>

          <Composer input={input} setInput={setInput} onSend={() => send(input)} loading={loading} big />
          <p style={styles.footnote}>
            This whole page is a conversation. An AI host answers as {name}, using only what
            they&apos;ve shared — and can show you cards, projects, and galleries right here.
          </p>
          {/* Other agents get the same host over A2A, not just people. */}
          <a href="/agent" style={styles.agentLink}>
            🪪 Agent card &amp; facts — this site is callable by other AI agents
          </a>
        </section>
      ) : (
        <section style={styles.chatWrap}>
          <div style={styles.chatHeader}>
            <button
              onClick={goHome}
              style={styles.homeBtn}
              title="Back to home"
              aria-label="Back to home"
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded file served from the app's own volume; next/image adds nothing here
                <img src={logo} alt={name} style={styles.headerAvatar} />
              ) : (
                <div style={styles.headerAvatarFallback}>{name.slice(0, 1)}</div>
              )}
              <span style={styles.homeLabel}>Home</span>
            </button>
            <a href="/agent" style={styles.headerAgentLink} title="Agent card & facts">
              🪪 Agent card
            </a>
          </div>
          <div ref={scrollRef} style={styles.thread}>
            {messages.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                content={m.content}
                cards={m.cards}
                loading={loading && i === messages.length - 1}
                slug={slug}
              />
            ))}
          </div>
          <div style={styles.composerDock}>
            <div style={styles.startersRow}>
              {starters.slice(0, 5).map((s) => (
                <button key={s.q} style={styles.chipSmall} onClick={() => send(s.q)} title={s.q}>
                  {s.q}
                </button>
              ))}
            </div>
            <Composer input={input} setInput={setInput} onSend={() => send(input)} loading={loading} />
          </div>
        </section>
      )}
    </main>
  );
}

function Composer({
  input,
  setInput,
  onSend,
  loading,
  big,
}: {
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  big?: boolean;
}) {
  return (
    <div data-fill="surface" style={{ ...styles.composer, ...(big ? styles.composerBig : {}) }}>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onSend()}
        placeholder="Ask me anything…"
        style={styles.input}
        autoFocus
      />
      <button
        onClick={onSend}
        disabled={loading || !input.trim()}
        style={{ ...styles.sendBtn, opacity: loading || !input.trim() ? 0.5 : 1 }}
      >
        {loading ? "…" : "Send ↵"}
      </button>
    </div>
  );
}

function Bubble({
  role,
  content,
  cards,
  loading,
  slug,
}: {
  role: "user" | "assistant";
  content: string;
  cards?: UiBlock[];
  loading: boolean;
  slug: string;
}) {
  const isUser = role === "user";
  const hasCards = !!cards && cards.length > 0;
  return (
    <div style={{ ...styles.row, flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {(content || !hasCards) && (
        <div data-fill="surface" style={isUser ? styles.userBubble : styles.botBubble}>
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
      {hasCards && (
        <div style={{ width: "100%", marginTop: 8 }}>
          {cards!.map((c, i) => (
            <Cards key={i} block={c} slug={slug} />
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100dvh", display: "flex", flexDirection: "column" },

  // ── Chat-history sidebar (overlay, so the centered layout is untouched) ──
  sidebarToggle: {
    position: "fixed",
    top: 14,
    left: 14,
    zIndex: 30,
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    color: "var(--on-bg-soft)",
    borderRadius: "var(--radius-pill)",
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
  },
  sidebarBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 40,
    background: "rgba(0,0,0,0.35)",
  },
  sidebar: {
    position: "fixed",
    top: 0,
    left: 0,
    bottom: 0,
    width: "min(300px, 85vw)",
    zIndex: 50,
    background: "var(--surface)",
    color: "var(--on-surface)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    padding: 14,
    gap: 10,
    overflowY: "auto",
  },
  sidebarHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  sidebarTitle: {
    fontFamily: "var(--font-heading), serif",
    fontWeight: 600,
    fontSize: 16,
  },
  sidebarClose: {
    background: "transparent",
    border: "none",
    color: "var(--on-surface)",
    fontSize: 14,
    cursor: "pointer",
    opacity: 0.7,
    padding: 4,
  },
  newChatBtn: {
    background: "var(--primary)",
    color: "var(--on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "10px 12px",
    fontWeight: 600,
    fontSize: 14,
    cursor: "pointer",
    textAlign: "left",
  },
  chatList: { display: "flex", flexDirection: "column", gap: 4, minHeight: 0 },
  chatListEmpty: { fontSize: 13, opacity: 0.6, fontStyle: "italic", margin: "6px 2px" },
  chatItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    borderRadius: "var(--radius-md)",
    border: "1px solid transparent",
  },
  chatItemActive: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
  },
  chatItemBtn: {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    color: "var(--on-surface)",
    textAlign: "left",
    fontSize: 13.5,
    lineHeight: 1.35,
    padding: "9px 10px",
    cursor: "pointer",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  chatItemDelete: {
    background: "transparent",
    border: "none",
    color: "var(--on-surface)",
    opacity: 0.45,
    fontSize: 12,
    cursor: "pointer",
    padding: "6px 8px",
    flexShrink: 0,
  },

  hero: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "40px 20px 80px",
    maxWidth: 720,
    margin: "0 auto",
    width: "100%",
  },
  h1: { fontSize: "clamp(40px, 8vw, 68px)", lineHeight: 1.02, marginBottom: 16 },
  h1accent: {
    // The accent as text on the page background — not --accent, which is a
    // fill and can sit too close to the background to read.
    color: "var(--accent-on-bg)",
  },
  sub: { color: "var(--text)", fontStyle: "italic", fontSize: 18, marginBottom: 36, maxWidth: 520 },

  composer: {
    display: "flex",
    gap: 8,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    padding: 8,
    width: "100%",
    boxShadow: "var(--glow-primary)",
  },
  composerBig: { maxWidth: 560, marginTop: 28 },
  input: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--on-surface)",
    fontSize: 16,
    padding: "12px 14px",
  },
  sendBtn: {
    background: "var(--primary)",
    color: "var(--on-primary)",
    border: "none",
    borderRadius: "var(--radius-md)",
    padding: "0 18px",
    fontWeight: 600,
    fontSize: 14,
  },

  starters: { display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", maxWidth: 620 },
  // Sized to its question rather than pinned to 340px: a fixed width left
  // short questions padded with empty space and long ones cramped.
  chip: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    color: "var(--on-bg-soft)",
    borderRadius: "var(--radius-pill)",
    padding: "10px 18px",
    fontSize: 14,
    lineHeight: 1.35,
    maxWidth: "100%",
    textAlign: "center",
  },
  footnote: { color: "var(--text)", fontStyle: "italic", fontSize: 13, marginTop: 32, maxWidth: 460 },
  // Quiet by design: a visitor is here to talk, not to read a protocol spec.
  agentLink: {
    color: "var(--accent-on-bg)",
    fontSize: 12.5,
    marginTop: 12,
    textDecoration: "none",
    opacity: 0.75,
  },
  headerAgentLink: {
    color: "var(--accent-on-bg)",
    fontSize: 12,
    textDecoration: "none",
    opacity: 0.7,
  },

  chatWrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    maxWidth: 820,
    width: "100%",
    margin: "0 auto",
    padding: "0 16px 16px",
    minHeight: 0,
  },
  chatHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "16px 0 8px",
  },
  homeBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    background: "transparent",
    border: "none",
    padding: 0,
    cursor: "pointer",
  },
  homeLabel: {
    color: "var(--text)",
    fontStyle: "italic",
    fontSize: 13,
    fontWeight: 500,
  },
  // "contain", never "cover": a company logo is usually a wordmark, and
  // cropping it to fill a circle cuts the ends off the name. Contain scales
  // the whole mark to fit, so the padding it leaves gets a surface behind it.
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: "var(--radius-pill)",
    objectFit: "contain",
    background: "var(--surface)",
    padding: 6,
    border: "2px solid var(--border)",
    boxShadow: "var(--glow-primary)",
  },
  headerAvatarFallback: {
    width: 72,
    height: 72,
    borderRadius: "var(--radius-pill)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 30,
    fontWeight: 600,
    color: "var(--on-primary)",
    background: "var(--primary)",
    border: "2px solid var(--border)",
  },
  thread: { flex: 1, overflowY: "auto", padding: "12px 4px", display: "flex", flexDirection: "column", gap: 14 },
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

  composerDock: { paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 },
  // Wraps rather than scrolling sideways: chips now carry whole questions, and
  // a horizontal scroller hides every chip past the first two.
  startersRow: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    flexWrap: "wrap",
    padding: "0 0 10px",
  },
  chipSmall: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    color: "var(--on-bg-soft)",
    borderRadius: "var(--radius-pill)",
    padding: "8px 16px",
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1.2,
    textAlign: "left",
    // One line each, elided if a question is unusually long — the full text
    // stays in the button's title attribute.
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
};

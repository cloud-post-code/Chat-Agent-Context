"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UiBlock } from "./cards/Cards";
import { readNdjson } from "@/lib/client/ndjson";
import { shownFromCards } from "./cards/shown";
import { Bubble } from "./ChatBubble";
import {
  listChats,
  loadMessages,
  saveChat,
  deleteChat,
  newChatId,
  type ChatMeta,
  type StoredMsg,
} from "@/lib/chatStore";
import { CHIP_COUNT, chipLabel } from "@/lib/chipLabel";

type Msg = StoredMsg;
/** `q` is the whole question a tap sends; `label` is the tab's short text. */
type Starter = { q: string; label?: string };
type HomePhoto = { src: string; alt: string };

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

type ChatProps = {
  name: string;
  tagline: string;
  logo?: string | null;
  starters: Starter[];
  /** Whose agent this page chats with — sent with every /api/chat call. */
  slug: string;
  /** The business's curated photos for the home screen's bottom strip. */
  photos?: HomePhoto[];
};

export default function Chat({ name, tagline, logo, starters, slug, photos = [] }: ChatProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  // A synchronous mirror of the message list, so a stream's updates compose
  // with each other. Every change goes through setMsgs, which updates the
  // mirror before React.
  const messagesRef = useRef<Msg[]>([]);
  const setMsgs = useCallback((fn: (m: Msg[]) => Msg[]) => {
    const next = fn(messagesRef.current);
    messagesRef.current = next;
    setMessages(next);
  }, []);
  // The assistant message a stream is filling right now; its bubble shows the dots.
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  // One id per conversation: it doubles as the /api/chat sessionId, so each
  // sidebar chat is one ChatSession in the admin Activity tab.
  const [chatId, setChatId] = useState<string>(() => newChatId());
  const started = messages.length > 0;
  // The starter tabs: never more than CHIP_COUNT, never more than three words
  // each — held here as well as in starterChipsFor, so no caller can hand the
  // home screen a wrapping stack of sentences again.
  const tabs = starters
    .slice(0, CHIP_COUNT)
    .map((s) => ({ q: s.q, label: chipLabel({ label: s.label, question: s.q }) }));

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
    setMsgs(() => loadMessages(s, slug, id));
    setInput("");
    setSidebarOpen(false);
  }

  function startNewChat() {
    setChatId(newChatId());
    setMsgs(() => []);
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
    const next: Msg[] = [...messagesRef.current, { id: newChatId(), role: "user", content: q }];
    setMsgs(() => next);
    setLoading(true);
    const aid = newChatId();
    setPendingId(aid);
    setMsgs((m) => [...m, { id: aid, role: "assistant", content: "", cards: [] }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Each assistant turn carries what its cards showed, so "the red
          // ones" after a gallery can resolve against the previous card.
          messages: next.map((m) => ({
            ...m,
            shown: m.role === "assistant" ? shownFromCards(m.cards) : undefined,
          })),
          sessionId: chatId,
          slug,
        }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text());

      let acc = "";
      const cards: UiBlock[] = [];

      const onEvent = (obj: { t: string; v?: unknown }) => {
        if (obj.t === "text") acc += String(obj.v ?? "");
        else if (obj.t === "card") cards.push(obj.v as UiBlock);
      };
      // By id, not position, so nothing else that moves the list can misfile it.
      const sync = () =>
        setMsgs((m) => m.map((x) => (x.id === aid ? { ...x, content: acc, cards: [...cards] } : x)));

      await readNdjson(res.body, onEvent, sync);
    } catch {
      setMsgs((m) =>
        m.map((x) =>
          x.id === aid
            ? {
                ...x,
                content:
                  "Hmm, I hit a snag reaching my brain (the API). Try again in a moment — or use the contact info on this page.",
                cards: [],
              }
            : x,
        ),
      );
    } finally {
      setLoading(false);
      setPendingId(null);
    }
  }

  function goHome() {
    // The old thread is already saved; Home starts fresh so the next question
    // opens a new conversation instead of silently extending the last one.
    startNewChat();
  }

  const showSidebarToggle = chats.length > 0 || started;

  // Once a conversation is open the shell is pinned to the viewport, so the
  // thread (flex: 1, overflow auto) is the thing that scrolls and auto-scroll
  // lands in it. The home screen keeps minHeight so a short viewport can
  // still scroll the page to the strip and footnote.
  return (
    <main style={started ? styles.shellChat : styles.shell}>
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
        <section ref={heroRef} style={styles.hero}>
          <div style={styles.heroMain}>
            <div className="home-rise" style={styles.titleBlock}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded file served from the app's own volume; next/image adds nothing here
                <img src={logo} alt="" style={styles.headerAvatar} />
              ) : (
                <div style={styles.headerAvatarFallback}>{name.slice(0, 1)}</div>
              )}
              <h1 style={styles.h1}>{name}</h1>
              <div style={styles.h1accent}>Ask me anything.</div>
              {tagline && <p style={styles.sub}>{tagline}</p>}
            </div>

            {/* Only when there are tabs, so an account with no starter questions
                gets no empty row. */}
            {tabs.length > 0 && (
              <div
                className="home-rise"
                data-starter-tabs="home"
                style={{ ...tabRow(tabs.length), animationDelay: "80ms" }}
              >
                {tabs.map((t) => (
                  <button key={t.q} style={styles.chip} onClick={() => send(t.q)} title={t.q}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="home-rise" style={{ ...styles.composerSlot, animationDelay: "160ms" }}>
              <Composer input={input} setInput={setInput} onSend={() => send(input)} loading={loading} big />
            </div>
            <p style={styles.footnote}>
              An AI host answers as {name}, using only what they&apos;ve shared.
            </p>
            {/* Other agents get the same host over A2A, not just people. */}
            <a href="/agent" style={styles.agentLink}>
              🪪 Agent card &amp; facts — this site is callable by other AI agents
            </a>
          </div>
          <PhotoStrip photos={photos} scope={heroRef} />
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
                key={m.id ?? i}
                id={m.id}
                role={m.role}
                content={m.content}
                cards={m.cards}
                loading={loading && (pendingId ? m.id === pendingId : i === messages.length - 1)}
                slug={slug}
              />
            ))}
          </div>
          <div style={styles.composerDock}>
            {/* Only when there are tabs: the row carries bottom padding, and an
                account with no starter questions must not show a stray gap. */}
            {tabs.length > 0 && (
              <div data-starter-tabs="dock" style={{ ...tabRow(tabs.length), ...styles.startersRow }}>
                {tabs.map((t) => (
                  <button key={t.q} style={styles.chipSmall} onClick={() => send(t.q)} title={t.q}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
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
        placeholder="Type your question…"
        style={{ ...styles.input, ...(big ? styles.inputBig : {}) }}
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

/**
 * The home screen's bottom band: the business's own photos in a sideways
 * strip, or a brand-color glow of the same height when there are none, so
 * every tenant's page has the same shape.
 */
function PhotoStrip({
  photos,
  scope,
}: {
  photos: HomePhoto[];
  /** The wheel is listened for across this element, not just the strip. */
  scope: React.RefObject<HTMLElement | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  // The mouse wheel moves the strip sideways. React's onWheel is passive, so
  // the listener is attached by hand to be allowed to preventDefault.
  useEffect(() => {
    const area = scope.current;
    const track = trackRef.current;
    if (!area || !track) return;
    const onWheel = (e: WheelEvent) => {
      // A sideways gesture (trackpad) already scrolls the strip natively.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (track.scrollWidth <= track.clientWidth) return;
      // Never trap a page that needs to scroll down: away from the strip, the
      // wheel is only taken over when there is nothing to scroll vertically.
      const overStrip = track.contains(e.target as Node);
      const pageScrolls = document.documentElement.scrollHeight > window.innerHeight + 1;
      if (!overStrip && pageScrolls) return;
      e.preventDefault();
      track.scrollLeft += e.deltaY;
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [scope]);

  if (photos.length === 0) {
    return (
      <div
        className="home-rise"
        data-home-strip="glow"
        aria-hidden
        style={{ ...styles.strip, ...styles.glowBand, animationDelay: "240ms" }}
      >
        <i style={{ ...styles.glowBlob, left: "12%", background: "var(--accent)" }} />
        <i style={{ ...styles.glowBlob, right: "12%", background: "var(--primary)" }} />
      </div>
    );
  }
  return (
    <div
      ref={trackRef}
      className="home-rise carousel-track"
      data-home-strip="photos"
      style={{ ...styles.strip, ...styles.stripTrack, animationDelay: "240ms" }}
    >
      <div style={styles.stripRow}>
        {photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- admin-uploaded file served from the app's own volume; next/image adds nothing here
          <img
            key={p.src}
            src={p.src}
            alt={p.alt}
            loading="lazy"
            draggable={false}
            style={{ ...styles.stripPhoto, marginTop: i % 2 ? STRIP_STAGGER : 0 }}
          />
        ))}
      </div>
    </div>
  );
}

/** The widest a starter tab grows — room for a three-word label on one line. */
const TAB_MAX_WIDTH = 190;

/** How far every other strip photo sits below its neighbours. */
const STRIP_STAGGER = 14;
const STRIP_PHOTO_HEIGHT = "clamp(104px, 19vh, 184px)";

const styles: Record<string, React.CSSProperties> = {
  shell: { minHeight: "100dvh", display: "flex", flexDirection: "column" },
  shellChat: { height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden" },

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

  hero: { flex: 1, display: "flex", flexDirection: "column", width: "100%", minWidth: 0 },
  heroMain: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    // Top padding clears the fixed "Chats" toggle on narrow screens.
    padding: "56px 20px 20px",
    maxWidth: 720,
    margin: "0 auto",
    width: "100%",
  },
  titleBlock: { display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28 },
  h1: { fontSize: "clamp(32px, 6vw, 52px)", lineHeight: 1.06, margin: "18px 0 8px" },
  h1accent: {
    // The accent as text on the page background — not --accent, which is a
    // fill and can sit too close to the background to read.
    color: "var(--accent-on-bg)",
    fontFamily: "var(--font-heading), serif",
    fontWeight: 600,
    fontSize: "clamp(18px, 2.6vw, 22px)",
  },
  sub: { color: "var(--text)", fontStyle: "italic", fontSize: 17, marginTop: 12, maxWidth: 520 },

  // ── Bottom strip: the business's photos, or a brand glow of the same height ──
  strip: {
    width: "100%",
    height: `calc(${STRIP_PHOTO_HEIGHT} + ${STRIP_STAGGER}px)`,
    marginBottom: 20,
    flexShrink: 0,
  },
  stripTrack: {
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
    maskImage: "linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)",
    WebkitMaskImage: "linear-gradient(to right, transparent, #000 7%, #000 93%, transparent)",
  },
  // max-content + auto margins: a short row sits centered, a long one scrolls.
  stripRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "max-content",
    margin: "0 auto",
    padding: "0 6vw",
  },
  stripPhoto: {
    height: STRIP_PHOTO_HEIGHT,
    width: `calc(${STRIP_PHOTO_HEIGHT} * 1.3)`,
    objectFit: "cover",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border)",
    flexShrink: 0,
    userSelect: "none",
  },
  glowBand: { position: "relative", overflow: "hidden" },
  glowBlob: {
    position: "absolute",
    bottom: "-60%",
    width: "38%",
    height: "140%",
    borderRadius: "50%",
    filter: "blur(60px)",
    opacity: 0.28,
  },

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
  composerBig: { maxWidth: 460 },
  composerSlot: { width: "100%", display: "flex", justifyContent: "center", marginTop: 24 },
  inputBig: { fontSize: 15, padding: "9px 12px" },
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

  // A starter tab: the size of the admin's own tabs, carrying a label of three
  // words at most. The row is a grid (tabRow), so the tabs are one width and
  // one height; on a phone a three-word label takes its second line inside the
  // tab rather than pushing a tab off the row.
  chip: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    color: "var(--on-bg-soft)",
    borderRadius: "var(--radius-pill)",
    // Type and side padding ease down with the viewport so a long word
    // ("testimonials") still fits a phone-width tab unbroken.
    padding: "8px clamp(6px, 2vw, 12px)",
    fontSize: "clamp(12.5px, 3.4vw, 14px)",
    fontWeight: 600,
    lineHeight: 1.2,
    minWidth: 0,
    textAlign: "center",
    overflowWrap: "anywhere",
  },
  footnote: { color: "var(--text)", fontStyle: "italic", fontSize: 13, marginTop: 20, maxWidth: 460 },
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
  // The bubbles themselves (row, user/bot bubble, typing dots) live in app/ChatBubble.tsx.
  thread: { flex: 1, overflowY: "auto", padding: "12px 4px", display: "flex", flexDirection: "column", gap: 14 },

  composerDock: { paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 },
  // The same tab row, docked above the composer once a conversation is going.
  startersRow: { gap: 6, margin: "0 auto", padding: "0 0 10px" },
  chipSmall: {
    background: "var(--bg-soft)",
    border: "1px solid var(--border)",
    color: "var(--on-bg-soft)",
    borderRadius: "var(--radius-pill)",
    padding: "6px clamp(6px, 2vw, 10px)",
    fontSize: "clamp(12px, 3.2vw, 13px)",
    fontWeight: 600,
    lineHeight: 1.2,
    minWidth: 0,
    textAlign: "center",
    overflowWrap: "anywhere",
  },
};

/**
 * The starter tabs' row: one line of equal-width tabs, always. A grid rather
 * than a wrapping flex row, so the tabs can never stack into extra lines and
 * push the composer down the first screen. Fewer than three tabs keep the
 * same tab width instead of stretching across the row.
 */
function tabRow(count: number): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
    gap: 8,
    width: "100%",
    maxWidth: count * TAB_MAX_WIDTH,
  };
}

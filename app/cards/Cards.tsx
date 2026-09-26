"use client";

import { useEffect, useRef, useState } from "react";
import { useChatThread, type ChatThread } from "@/app/ChatThread";
import type { CardStep, FlowField } from "@/lib/booking/flowSteps";
import type { BookingFlow } from "@/lib/booking/types";
import { toFlowFields } from "./booking/BookingFlowCard";
import { BookingSessionCard } from "./booking/BookingSessionCard";
import { BookingStepCard } from "./booking/BookingStepCard";
import { BookingThread } from "./booking/BookingThread";
import { Confirmed } from "./booking/Confirmed";
import { useBookingSession, useBookingSessions } from "./booking/session";
import { startOver, startSession } from "./booking/thread";
import type { BookingField } from "./BookingQuestion";

import { MenuCard, type MenuBlockView } from "./MenuCard";
import { CartCard } from "./CartCard";
import type { CartCheckout } from "@/lib/menu";
import { SocialCard } from "./SocialCard";
import type { ProjectCard, PhotoCard, ServiceCard, SocialItem } from "@/lib/cards.types";
export type { ProjectCard, PhotoCard, ServiceCard, SocialItem };
import { card, cf, linkBtn, liveBtn, textBtn, clamp2 } from "./styles";

export type { BookingField } from "./BookingQuestion";
// The card idiom lives in styles.ts; re-exported so existing imports still work.
export { card, cf } from "./styles";

/** Shared card block types (mirrors lib/cards.ts). */
export type ServiceBooking = { fields: BookingField[]; flow?: BookingFlow | null };
export type UiBlock =
  | { type: "projects"; title?: string; items: ProjectCard[] }
  | { type: "project"; item: ProjectCard | null }
  | { type: "gallery"; layout: "carousel" | "filmstrip"; title?: string; items: PhotoCard[] }
  | { type: "contact" }
  | {
      type: "services";
      title?: string;
      focusIds?: string[];
      items: ServiceCard[];
      booking: ServiceBooking | null;
    }
  // The server's booking block is the START of a booking conversation: the
  // chat gives it a sessionId the moment it arrives (or on load, for older
  // chats), then lays the steps out below it one card at a time.
  | { type: "booking"; fields: BookingField[]; flow?: BookingFlow | null; sessionId?: string; preselectServiceId?: string | null }
  // Client-side kinds the server never emits: one step of a booking session,
  // and the confirmation once it is booked.
  | { type: "booking_step"; sessionId: string; step: { kind: CardStep["kind"]; screen?: number } }
  | { type: "booking_confirmed"; sessionId: string }
  | ({ type: "menu" } & MenuBlockView)
  | { type: "cart"; checkout: CartCheckout }
  | { type: "social"; title?: string; items: SocialItem[] };

export function Cards({ block, slug }: { block: UiBlock; slug: string }) {
  if (block.type === "projects") {
    if (block.items.length === 0) return <Empty>No projects yet.</Empty>;
    return (
      <div>
        {block.title && <TitleHeading title={block.title} />}
        <div style={grid}>
          {block.items.map((p) => (
            <ProjectCardView key={p.id} p={p} />
          ))}
        </div>
      </div>
    );
  }
  if (block.type === "project") {
    if (!block.item) return <Empty>That project wasn&apos;t found.</Empty>;
    return (
      <div style={{ marginTop: 6 }}>
        <ProjectCardView p={block.item} big />
      </div>
    );
  }
  if (block.type === "gallery") {
    if (block.items.length === 0) return <Empty>No photos yet.</Empty>;
    return <GalleryCard layout={block.layout} title={block.title} items={block.items} />;
  }
  if (block.type === "services") {
    if (!Array.isArray(block.items) || block.items.length === 0) {
      return <Empty>No services listed yet.</Empty>;
    }
    return (
      <ServicesCard
        slug={slug}
        title={block.title}
        focusIds={block.focusIds}
        items={block.items}
        booking={block.booking}
      />
    );
  }
  if (block.type === "contact") {
    return <ContactForm slug={slug} />;
  }
  if (block.type === "booking") {
    return <BookingSessionCard block={block} slug={slug} />;
  }
  if (block.type === "booking_step") {
    return <BookingStepCard block={block} slug={slug} />;
  }
  if (block.type === "booking_confirmed") {
    return <BookingConfirmedCard sessionId={block.sessionId} />;
  }
  if (block.type === "menu") {
    return <MenuCard block={block} slug={slug} />;
  }
  if (block.type === "cart") {
    return <CartCard checkout={block.checkout} slug={slug} />;
  }
  if (block.type === "social") {
    return <SocialCard title={block.title} items={block.items} />;
  }
  return null;
}

/** Small heading shared by any card that gained an optional `title`. */
function TitleHeading({ title }: { title: string }) {
  return (
    <strong
      style={{
        display: "block",
        fontSize: 13,
        fontFamily: "var(--font-heading)",
        color: "var(--on-bg-soft)",
        opacity: 0.85,
        margin: "0 0 8px",
      }}
    >
      {title}
    </strong>
  );
}

/**
 * The end of a booking conversation: what was booked, read from the session's
 * store, and a way to start again — a fresh session below, this one locked.
 */
function BookingConfirmedCard({ sessionId }: { sessionId: string }) {
  const thread = useChatThread();
  const { sessions } = useBookingSessions();
  const { store, state } = useBookingSession(sessionId);
  const { flow, confirmed, selection } = state;
  if (!flow || !confirmed) return null;
  return (
    <div>
      <Confirmed
        flow={flow}
        result={confirmed.result}
        waitlisted={confirmed.waitlisted}
        service={flow.services.find((s) => s.id === selection.serviceId) ?? null}
        provider={flow.staff.find((s) => s.id === selection.staffId) ?? null}
        location={flow.locations.find((l) => l.id === selection.locationId) ?? null}
        selection={selection}
      />
      {thread && (
        <button type="button" onClick={() => startOver(thread, sessions, store)} style={{ ...textBtn, marginTop: 8 }}>
          Start over
        </button>
      )}
    </div>
  );
}

/**
 * Book, tapped inside a chat: the booking starts as a conversation below the
 * services card (which stays where it is). Mounted once per tap; the session
 * starts on mount and the thread carries it from there.
 */
function StartBookingInThread({
  thread,
  flow,
  fields,
  preselectServiceId,
}: {
  thread: ChatThread;
  flow: BookingFlow;
  fields: FlowField[];
  preselectServiceId?: string;
}) {
  const { sessions } = useBookingSessions();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    startSession(thread, sessions, { flow, fields, preselectServiceId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Past this many the list folds: a chat bubble is not a menu page. */
const SERVICES_SHOWN = 5;
/** Longer than this and a description clamps to two lines behind "More". */
const SERVICE_BLURB = 140;

/**
 * The tenant's services, with booking one tap away. In a chat, Book starts
 * the booking conversation below — the picked service's line and the next
 * step's card append at the bottom, and this card stays put. Outside a chat
 * (a server-rendered page), Book swaps the list for a booking thread of its
 * own, opened with that service already answered, so the visitor never
 * retypes what they just tapped. The block can come from a stored sample,
 * which is admin-typed JSON: a booking config that isn't a field list means
 * "no Book button", never a crash.
 */
function ServicesCard({
  slug,
  title,
  focusIds,
  items,
  booking,
}: {
  slug: string;
  title?: string;
  focusIds?: string[];
  items: ServiceCard[];
  booking: ServiceBooking | null;
}) {
  const thread = useChatThread();
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<ServiceCard | null>(null);
  // Every Book tap in a chat is a session of its own: the counter remounts the starter.
  const [started, setStarted] = useState<{ service: ServiceCard; n: number } | null>(null);
  const fields =
    booking && Array.isArray(booking.fields) && booking.fields.length > 0 ? booking.fields : null;
  const flow = booking?.flow ?? null;
  const canBook = !!(fields || flow);

  function book(s: ServiceCard) {
    if (thread && flow) {
      setStarted((prev) => ({ service: s, n: (prev?.n ?? 0) + 1 }));
      return;
    }
    setPicked(s);
  }

  if (picked && canBook) {
    const flowService = flow?.services.find((s) => s.id === picked.id) ?? null;
    return (
      <div>
        <p style={{ fontSize: 13, color: "var(--on-bg-soft)", margin: "0 0 10px" }}>
          Booking <strong>{picked.name}</strong>{" "}
          <button onClick={() => setPicked(null)} style={textBtn}>
            Change
          </button>
        </p>
        <BookingThread key={picked.id} slug={slug} fields={fields ?? []} flow={flow} preselectServiceId={flowService?.id} />
      </div>
    );
  }

  const focusSet = new Set(focusIds ?? []);
  const hasFocus = focusSet.size > 0;
  const focusItems = hasFocus ? items.filter((s) => focusSet.has(s?.id)) : [];
  const restItems = hasFocus ? items.filter((s) => !focusSet.has(s?.id)) : items;
  // A focused card, or one small enough to fit, never folds behind "Show all".
  const noFold = hasFocus || items.length <= SERVICES_SHOWN;
  const shownRest = noFold ? restItems : all ? restItems : restItems.slice(0, SERVICES_SHOWN);
  const bookHandler = (s: ServiceCard) => (canBook ? () => book(s) : undefined);

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 480 }}>
      {started && thread && flow && (
        <StartBookingInThread
          key={started.n}
          thread={thread}
          flow={flow}
          fields={toFlowFields(fields ?? [])}
          preselectServiceId={flow.services.find((s) => s.id === started.service.id)?.id}
        />
      )}
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>{title ?? "Services"}</strong>
      {canBook && (
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 13, margin: "6px 0 4px" }}>
          Tap Book on any service to pick a time.
        </p>
      )}
      {hasFocus && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
          {focusItems.map((s, i) => (
            <ServiceRow key={s?.id ?? `focus-${i}`} service={s} first={i === 0} onBook={bookHandler(s)} />
          ))}
        </ul>
      )}
      {hasFocus && restItems.length > 0 && (
        <span
          style={{
            display: "block",
            fontSize: 12,
            color: "var(--on-bg-soft)",
            opacity: 0.75,
            margin: "12px 0 2px",
          }}
        >
          Similar
        </span>
      )}
      <ul style={{ listStyle: "none", margin: hasFocus ? 0 : "8px 0 0", padding: 0 }}>
        {shownRest.map((s, i) => (
          <ServiceRow key={s?.id ?? i} service={s} first={i === 0 && !hasFocus} onBook={bookHandler(s)} />
        ))}
      </ul>
      {!noFold && restItems.length > SERVICES_SHOWN && (
        <button
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          style={{ ...linkBtn, cursor: "pointer", marginTop: 10 }}
        >
          {all ? "Show fewer ▴" : `Show all ${restItems.length} ▾`}
        </button>
      )}
    </div>
  );
}

function ServiceRow({
  service,
  first,
  onBook,
}: {
  service: ServiceCard;
  first: boolean;
  onBook?: () => void;
}) {
  const [open, setOpen] = useState(false);
  if (!service || typeof service.name !== "string" || !service.name) return null;
  const blurb = typeof service.description === "string" ? service.description : "";
  const long = blurb.length > SERVICE_BLURB;
  return (
    <li
      style={{
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 0",
        borderTop: first ? "none" : "1px solid var(--border)",
      }}
    >
      <div style={{ width: 56, height: 56, flex: "0 0 auto", borderRadius: "var(--radius-sm)", overflow: "hidden", background: "var(--bg)" }}>
        {service.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={service.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div
            aria-hidden
            data-testid="placeholder-image"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, var(--primary), var(--bg-soft))",
              color: "var(--on-primary)",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "var(--font-heading)",
            }}
          >
            {service.name[0]?.toUpperCase() ?? "?"}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-heading)" }}>
          {service.name}
        </div>
        {(service.priceLabel || service.duration) && (
          <div style={{ fontSize: 12, color: "var(--on-bg-soft)", marginTop: 1 }}>
            {[service.priceLabel, service.duration].filter(Boolean).join(" · ")}
          </div>
        )}
        {blurb && (
          <p
            style={{
              fontSize: 13,
              color: "var(--on-bg-soft)",
              lineHeight: 1.5,
              margin: "3px 0 0",
              ...(long && !open ? clamp2 : {}),
            }}
          >
            {blurb}
          </p>
        )}
        {long && (
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} style={{ ...textBtn, marginTop: 3 }}>
            {open ? "Less" : "More"}
          </button>
        )}
      </div>
      {onBook && (
        <button
          onClick={onBook}
          aria-label={`Book ${service.name}`}
          style={{ ...linkBtn, ...liveBtn, cursor: "pointer", flex: "0 0 auto" }}
        >
          Book
        </button>
      )}
    </li>
  );
}

function ContactForm({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function submit() {
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, message, slug }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Something went wrong.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setError("Network error. Try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div data-fill="bg-soft" style={{ ...card, borderColor: "var(--success-on-bg-soft)" }}>
        <strong style={{ fontSize: 15 }}>Got it — thank you.</strong>
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14, marginTop: 6 }}>
          Your message was delivered. You&apos;ll hear back at {email}.
        </p>
      </div>
    );
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>Leave your details</strong>
      <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 13, margin: "6px 0 12px" }}>
        Drop your info and a note — it goes straight to Blake.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        style={cf}
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Your email"
        type="email"
        style={cf}
      />
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Your message"
        rows={3}
        style={{ ...cf, resize: "vertical" }}
      />
      {state === "error" && (
        <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{error}</p>
      )}
      <button
        onClick={submit}
        disabled={state === "sending" || !name || !email || !message}
        style={{
          ...linkBtn,
          ...liveBtn,
          padding: "10px 18px",
          opacity: state === "sending" || !name || !email || !message ? 0.55 : 1,
        }}
      >
        {state === "sending" ? "Sending…" : "Send to Blake"}
      </button>
    </div>
  );
}

function ProjectCardView({ p, big }: { p: ProjectCard; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!p.detail && p.detail.trim().length > 0;
  return (
    <div data-fill="bg-soft" style={{ ...card, ...(big ? { maxWidth: 480 } : {}) }}>
      {p.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt={p.name} style={{ width: "100%", borderRadius: "var(--radius-sm)", marginBottom: 10 }} />
      )}
      <h3 style={{ fontSize: 17, marginBottom: 6, fontFamily: "var(--font-heading)" }}>{p.name}</h3>
      <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14, marginBottom: 10 }}>{p.blurb}</p>
      {open && hasDetail && (
        <p style={{ color: "var(--on-bg-soft)", fontSize: 14, lineHeight: 1.55, marginBottom: 10 }}>
          {p.detail}
        </p>
      )}
      {p.tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {p.tags.map((t) => (
            <span key={t} style={{ fontSize: 11, color: "var(--accent-on-bg-soft)" }}>
              #{t}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {hasDetail && (
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{ ...linkBtn, cursor: "pointer" }}
          >
            {open ? "Show less ▴" : "Learn more ▾"}
          </button>
        )}
        {p.githubUrl && (
          <a href={p.githubUrl} target="_blank" rel="noreferrer" style={linkBtn}>
            ⌥ GitHub
          </a>
        )}
        {p.liveUrl && (
          <a href={p.liveUrl} target="_blank" rel="noreferrer" style={{ ...linkBtn, ...liveBtn }}>
            ↗ Live
          </a>
        )}
      </div>
    </div>
  );
}

function Carousel({ items }: { items: PhotoCard[] }) {
  // Every photo stays mounted in a horizontal scroll-snap track. Navigation
  // smooth-scrolls the track instead of swapping one <img>'s src, so there is
  // no blank frame while the next photo loads and no height jump between
  // photos with different aspect ratios.
  const [i, setI] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const scrollTo = (idx: number) => {
    const el = track.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: idx * el.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };
  const go = (d: number) => scrollTo((i + d + items.length) % items.length);
  const onScroll = () => {
    const el = track.current;
    if (!el || el.clientWidth === 0) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== i) setI(Math.max(0, Math.min(items.length - 1, idx)));
  };
  const ph = items[i];
  return (
    <div data-fill="bg-soft" style={card}>
      <div style={{ position: "relative" }}>
        <div ref={track} onScroll={onScroll} className="carousel-track" style={carouselTrack}>
          {items.map((it, idx) => (
            <div key={it.id ?? idx} style={carouselSlide} aria-hidden={idx !== i}>
              {/* Blurred copy fills the letterbox behind photos whose aspect
                  ratio differs from the slide, so nothing is cropped and no
                  slide shows a blank slab. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.src} alt="" aria-hidden draggable={false} style={carouselBackdrop} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.src} alt={it.description} draggable={false} style={carouselImg} />
            </div>
          ))}
        </div>
        {items.length > 1 && (
          <>
            <button style={{ ...navArrow, left: 8 }} onClick={() => go(-1)} aria-label="Previous">
              ‹
            </button>
            <button style={{ ...navArrow, right: 8 }} onClick={() => go(1)} aria-label="Next">
              ›
            </button>
          </>
        )}
      </div>
      {ph.description && (
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14, marginTop: 10 }}>{ph.description}</p>
      )}
      {items.length > 1 && (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
          {items.map((_, idx) => (
            <button
              key={idx}
              onClick={() => scrollTo(idx)}
              aria-label={`Go to photo ${idx + 1}`}
              aria-current={idx === i}
              style={{
                width: 8,
                height: 8,
                padding: 0,
                borderRadius: 999,
                border: "none",
                cursor: "pointer",
                background: idx === i ? "var(--primary)" : "var(--border)",
                transition: "background 200ms ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Small sets (≤3) and larger sets share this lightbox, opened by thumbnail index. */
function PhotoLightbox({ items, open, onClose }: { items: PhotoCard[]; open: number | null; onClose: () => void }) {
  if (open === null) return null;
  const ph = items[open];
  return (
    <div style={lightbox} onClick={onClose}>
      <div data-fill="surface" style={lightboxInner} onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ph.src} alt={ph.description} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: "var(--radius-sm)" }} />
        {ph.description && <p style={{ color: "var(--on-surface)", fontSize: 15, marginTop: 12 }}>{ph.description}</p>}
        <button style={{ ...linkBtn, marginTop: 14 }} onClick={onClose}>
          Close ✕
        </button>
      </div>
    </div>
  );
}

/** Above this count a compact thumbnail row gives way to Carousel/Filmstrip. */
const COMPACT_GALLERY_MAX = 3;

/**
 * Gallery dispatch: an optional `title`, then a compact thumbnail row for
 * small sets (no carousel prev/next controls, regardless of `layout`) or the
 * existing Carousel/Filmstrip for larger ones.
 */
function GalleryCard({
  layout,
  title,
  items,
}: {
  layout: "carousel" | "filmstrip";
  title?: string;
  items: PhotoCard[];
}) {
  return (
    <div>
      {title && <TitleHeading title={title} />}
      {items.length <= COMPACT_GALLERY_MAX ? (
        <CompactPhotoRow items={items} />
      ) : layout === "carousel" ? (
        <Carousel items={items} />
      ) : (
        <Filmstrip items={items} />
      )}
    </div>
  );
}

/** A row of full-size thumbnails, each opening the shared lightbox. No nav controls. */
function CompactPhotoRow({ items }: { items: PhotoCard[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div data-fill="bg-soft" style={card}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {items.map((ph, idx) => (
          <button
            key={ph.id}
            onClick={() => setOpen(idx)}
            style={{ flex: "0 0 auto", border: "none", background: "none", padding: 0, cursor: "pointer" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ph.src}
              alt={ph.description}
              style={{ height: 140, width: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
            />
          </button>
        ))}
      </div>
      <PhotoLightbox items={items} open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Filmstrip({ items }: { items: PhotoCard[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div data-fill="bg-soft" style={card}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6 }}>
        {items.map((ph, idx) => (
          <button
            key={ph.id}
            onClick={() => setOpen(idx)}
            style={{ flex: "0 0 auto", border: "none", background: "none", padding: 0, cursor: "pointer" }}
          >
            {/* Fixed height, natural width: thumbnails keep their aspect
                ratio instead of being cover-cropped into squares. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={ph.src}
              alt={ph.description}
              style={{ height: 96, width: "auto", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
            />
          </button>
        ))}
      </div>
      <PhotoLightbox items={items} open={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div data-fill="bg-soft" style={{ ...card, color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14 }}>{children}</div>
  );
}

const chipRow: React.CSSProperties = {
  display: "flex",
  gap: 6,
  flexWrap: "wrap",
};
const grid: React.CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
};
const carouselTrack: React.CSSProperties = {
  display: "flex",
  overflowX: "auto",
  overflowY: "hidden",
  scrollSnapType: "x mandatory",
  scrollbarWidth: "none",
  borderRadius: "var(--radius-sm)",
  // WebkitOverflowScrolling is not in React's CSSProperties typings; the
  // touch momentum default is already fine on modern iOS.
};
const carouselSlide: React.CSSProperties = {
  position: "relative",
  flex: "0 0 100%",
  width: "100%",
  aspectRatio: "16 / 10",
  overflow: "hidden",
  scrollSnapAlign: "start",
  scrollSnapStop: "always",
  background: "var(--bg)",
};
const carouselBackdrop: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  filter: "blur(28px) saturate(1.2)",
  transform: "scale(1.15)",
  opacity: 0.55,
  pointerEvents: "none",
};
const carouselImg: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
  userSelect: "none",
};
const navArrow: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 34,
  height: 34,
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--on-surface)",
  fontSize: 20,
  lineHeight: 1,
};
const lightbox: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(5,8,18,0.85)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 50,
};
const lightboxInner: React.CSSProperties = {
  maxWidth: 720,
  width: "100%",
  textAlign: "center",
  background: "var(--surface)",
  color: "var(--on-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
};

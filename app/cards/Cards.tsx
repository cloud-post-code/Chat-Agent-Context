"use client";

import { useRef, useState } from "react";
import { SocialCard } from "./SocialCard";
import { HtmlFrame } from "./HtmlFrame";
import type { ProjectCard, PhotoCard, CustomElement, SocialItem } from "@/lib/cards.types";
export type { ProjectCard, PhotoCard, CustomElement, SocialItem };
import { card, cf, linkBtn, liveBtn } from "./styles";

// The card idiom lives in styles.ts; re-exported so existing imports still work.
export { card, cf } from "./styles";

/** Shared A2UI block types (mirrors lib/cards.ts). */
export type UiBlock =
  | { type: "projects"; title?: string; items: ProjectCard[] }
  | { type: "project"; item: ProjectCard | null }
  | { type: "gallery"; layout: "carousel" | "filmstrip"; title?: string; items: PhotoCard[] }
  | { type: "contact" }
  | { type: "custom"; title?: string; elements: CustomElement[] }
  | { type: "html"; html: string; height?: number }
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
  if (block.type === "contact") {
    return <ContactForm slug={slug} />;
  }
  if (block.type === "custom") {
    return <CustomCard title={block.title} elements={block.elements} />;
  }
  if (block.type === "html") {
    return <HtmlCard html={block.html} height={block.height} />;
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
 * A card the builder CODED — model-written HTML with inline CSS, rendered in a
 * sealed sandbox. Two independent walls stand between that code and the
 * visitor: the iframe sandbox (no scripts, no same-origin — popups only, so
 * target="_blank" links still work), and a CSP baked into the document that
 * allows inline styles and data: images and nothing else, so it cannot phone
 * out to any external host. Validation upstream also refuses to store markup
 * that even looks executable; this is the belt to that suspender.
 *
 * The site's theme variables are resolved here and injected into the document,
 * because a sandboxed iframe inherits nothing — without this, coded cards
 * would go off-palette the moment the admin changes the theme.
 */
function HtmlCard({ html, height }: { html: string; height?: number }) {
  const h = typeof height === "number" && height >= 40 && height <= 1200 ? height : 300;
  return <HtmlFrame html={html} height={h} title="Custom card" tone="bg-soft" style={{ maxWidth: 480, background: "var(--bg-soft)" }} />;
}

/**
 * A card composed in the admin card builder from the CustomElement vocabulary.
 * Rendered defensively: the elements come from stored model output, so an
 * unknown kind or a malformed entry is skipped, never a crash in a visitor's
 * chat. External links open in a new tab like every other card link here.
 */
function CustomCard({ title, elements }: { title?: string; elements: CustomElement[] }) {
  if (!Array.isArray(elements)) return null;
  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 480 }}>
      {title && (
        <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)", display: "block", marginBottom: 8 }}>
          {title}
        </strong>
      )}
      {elements.map((el, i) => (
        <CustomEl key={i} el={el} />
      ))}
    </div>
  );
}

function CustomEl({ el }: { el: CustomElement }) {
  if (!el || typeof el !== "object") return null;
  switch (el.kind) {
    case "heading":
      return (
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-heading)", margin: "10px 0 4px" }}>
          {el.text}
        </div>
      );
    case "text":
      return (
        <p style={{ fontSize: 14, color: "var(--on-bg-soft)", lineHeight: 1.55, margin: "4px 0" }}>{el.text}</p>
      );
    case "list":
      if (!Array.isArray(el.items)) return null;
      return (
        <ul style={{ margin: "4px 0", paddingLeft: 18 }}>
          {el.items.map((it, i) => (
            <li key={i} style={{ fontSize: 14, color: "var(--on-bg-soft)", lineHeight: 1.55 }}>
              {it}
            </li>
          ))}
        </ul>
      );
    case "badges":
      if (!Array.isArray(el.items)) return null;
      return (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
          {el.items.map((it, i) => (
            <span key={i} style={{ fontSize: 11, color: "var(--accent-on-bg-soft)" }}>
              #{it}
            </span>
          ))}
        </div>
      );
    case "stats":
      if (!Array.isArray(el.items)) return null;
      return (
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "8px 0" }}>
          {el.items.map((s, i) => (
            <div key={i}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--on-bg-soft)" }}>{s?.value}</div>
              <div style={{ fontSize: 11, color: "var(--on-bg-soft)", opacity: 0.75 }}>{s?.label}</div>
            </div>
          ))}
        </div>
      );
    case "buttons":
      if (!Array.isArray(el.items)) return null;
      return (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0 2px" }}>
          {el.items.map((b, i) => (
            <a key={i} href={b?.url} target="_blank" rel="noreferrer" style={{ ...linkBtn, ...(i === 0 ? liveBtn : {}) }}>
              {b?.label}
            </a>
          ))}
        </div>
      );
    case "image":
      if (!el.src) return null;
      // eslint-disable-next-line @next/next/no-img-element
      return <img src={el.src} alt={el.alt ?? ""} style={{ width: "100%", borderRadius: "var(--radius-sm)", margin: "6px 0" }} />;
    case "quote":
      return (
        <blockquote
          style={{
            margin: "8px 0",
            paddingLeft: 12,
            borderLeft: "2px solid var(--accent-on-bg-soft)",
            fontStyle: "italic",
            fontSize: 14,
            color: "var(--on-bg-soft)",
          }}
        >
          {el.text}
          {el.by && <div style={{ fontSize: 12, marginTop: 4, fontStyle: "normal", opacity: 0.75 }}>— {el.by}</div>}
        </blockquote>
      );
    case "divider":
      return <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "10px 0" }} />;
    default:
      return null;
  }
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

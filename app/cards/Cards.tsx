"use client";

import { useEffect, useRef, useState } from "react";
import { resolveAnswer } from "@/lib/appointmentTypes";
import {
  QuestionInput,
  answerLines,
  answerTotal,
  hasAnswer,
  type Answers,
  type BookingField,
} from "./BookingQuestion";

export type { BookingField } from "./BookingQuestion";

/** Shared A2UI block types (mirrors lib/cards.ts). */
export type ProjectCard = {
  id: string;
  name: string;
  blurb: string;
  detail: string | null;
  githubUrl: string | null;
  liveUrl: string | null;
  imageUrl: string | null;
  tags: string[];
};
export type PhotoCard = {
  id: string;
  src: string;
  description: string;
  caption: string | null;
};
export type CustomElement =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "badges"; items: string[] }
  | { kind: "stats"; items: { label: string; value: string }[] }
  | { kind: "buttons"; items: { label: string; url: string }[] }
  | { kind: "image"; src: string; alt?: string }
  | { kind: "quote"; text: string; by?: string }
  | { kind: "divider" };
export type ServiceCard = {
  id: string;
  name: string;
  description: string;
};
export type ServiceBooking = { fields: BookingField[]; serviceKey: string | null };
export type UiBlock =
  | { type: "projects"; items: ProjectCard[] }
  | { type: "project"; item: ProjectCard | null }
  | { type: "gallery"; layout: "carousel" | "filmstrip"; items: PhotoCard[] }
  | { type: "contact" }
  | { type: "services"; items: ServiceCard[]; booking: ServiceBooking | null }
  | { type: "custom"; title?: string; elements: CustomElement[] }
  | { type: "html"; html: string; height?: number }
  | { type: "booking"; fields: BookingField[] };

export function Cards({ block, slug }: { block: UiBlock; slug: string }) {
  if (block.type === "projects") {
    if (block.items.length === 0) return <Empty>No projects yet.</Empty>;
    return (
      <div style={grid}>
        {block.items.map((p) => (
          <ProjectCardView key={p.id} p={p} />
        ))}
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
    return block.layout === "carousel" ? (
      <Carousel items={block.items} />
    ) : (
      <Filmstrip items={block.items} />
    );
  }
  if (block.type === "services") {
    if (!Array.isArray(block.items) || block.items.length === 0) {
      return <Empty>No services listed yet.</Empty>;
    }
    return <ServicesCard slug={slug} items={block.items} booking={block.booking} />;
  }
  if (block.type === "contact") {
    return <ContactForm slug={slug} />;
  }
  if (block.type === "booking") {
    return <BookingCard slug={slug} fields={block.fields} />;
  }
  if (block.type === "custom") {
    return <CustomCard title={block.title} elements={block.elements} />;
  }
  if (block.type === "html") {
    return <HtmlCard html={block.html} height={block.height} />;
  }
  return null;
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
  const [themeCss, setThemeCss] = useState("");
  useEffect(() => {
    // The COMPLETE live token set, so coded cards see the same design system
    // the rest of the site computes — including per-theme readable-on variants.
    const root = getComputedStyle(document.documentElement);
    const names = [
      "--bg", "--bg-soft", "--surface", "--border", "--text",
      "--primary", "--accent", "--on-primary", "--on-accent",
      "--on-surface", "--on-bg-soft",
      "--accent-on-bg", "--accent-on-bg-soft", "--accent-on-surface",
      "--danger-on-bg-soft", "--danger-on-surface",
      "--success-on-bg-soft", "--success-on-surface",
      "--font-heading", "--heading-weight",
      "--radius-sm", "--radius-md", "--radius-lg", "--radius-pill",
    ];
    const vars = names.map((n) => `${n}:${root.getPropertyValue(n)};`).join("");
    const font = getComputedStyle(document.body).fontFamily;
    // Base element styles mirroring the site's card idiom, so even markup the
    // model leaves unstyled lands on-theme: body text 14/1.55 in the body
    // font, headings in the heading font at the site's card sizes, links in
    // the accent that is readable on this exact background.
    setThemeCss(
      `:root{${vars}}` +
        `body{margin:0;background:transparent;color:var(--on-bg-soft);font-family:${font};font-size:14px;line-height:1.55;}` +
        `h1,h2,h3,h4{font-family:var(--font-heading),${font};font-weight:var(--heading-weight,700);margin:0 0 8px;}` +
        `h1{font-size:17px}h2{font-size:15px}h3,h4{font-size:14px}` +
        `a{color:var(--accent-on-bg-soft);}`,
    );
  }, []);

  const doc =
    `<!doctype html><html><head>` +
    // img-src also allows this origin, so a coded card can show a real photo
    // from the owner's library or one the builder generated — both are served
    // from /api/uploads on our own host. Everything else stays denied, so the
    // card still cannot phone out to a third party.
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self';">` +
    `<style>${themeCss}</style></head><body>${html}</body></html>`;
  const h = typeof height === "number" && height >= 40 && height <= 1200 ? height : 300;

  return (
    <iframe
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      title="Custom card"
      style={{
        width: "100%",
        maxWidth: 480,
        height: h,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        background: "var(--bg-soft)",
        display: "block",
      }}
    />
  );
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

/**
 * The booking wizard: one question per configured field, then a date-and-time
 * step, then review + confirm. All state is local until the single POST at
 * the end; a rejected submit shows the server's reason on the review step
 * with every answer intact. The server re-validates everything — this
 * component is convenience, not enforcement.
 *
 * The services card opens it with `prefill`: the service the visitor tapped
 * is already that question's answer. A single-answer question is then not
 * asked at all; a pick-any menu keeps its step, with the service pre-ticked.
 */
function BookingCard({
  slug,
  fields,
  prefill,
  intro,
}: {
  slug: string;
  fields: BookingField[];
  /** Answers the visitor already gave by other means (the service they tapped). */
  prefill?: Record<string, string>;
  /** Shown above every step — what is being booked, and the way back out. */
  intro?: React.ReactNode;
}) {
  // A pre-answered question is not asked again; it still shows on the review.
  // The exception is a pick-any menu: there the prefill is a first pick, and
  // the question is still asked so the visitor can add to it.
  const asked = fields.filter((f) => f.type === "multi_select" || !(prefill?.[f.key] ?? "").trim());
  // 0..asked.length-1 = questions, asked.length = time, +1 = review.
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(prefill ?? {});
  const [when, setWhen] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");

  const timeStep = asked.length;
  const reviewStep = asked.length + 1;
  const startsAt = when ? new Date(when) : null;
  const timeOk = !!startsAt && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now();

  async function submit() {
    if (state === "sending" || !startsAt) return;
    setState("sending");
    setError("");
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, startsAt: startsAt.toISOString(), answers }),
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

  if (state === "done" && startsAt) {
    return (
      <div data-fill="bg-soft" style={{ ...card, borderColor: "var(--success-on-bg-soft)" }}>
        <strong style={{ fontSize: 15 }}>You&apos;re booked.</strong>
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 14, marginTop: 6 }}>
          {startsAt.toLocaleString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          — your local time.
        </p>
      </div>
    );
  }

  const back = step > 0 && (
    <button onClick={() => setStep(step - 1)} style={{ ...linkBtn, cursor: "pointer" }}>
      Back
    </button>
  );
  const progress = (
    <>
      {intro}
      <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 12, margin: "0 0 10px" }}>
        Step {Math.min(step, reviewStep) + 1} of {reviewStep + 1}
      </p>
    </>
  );

  if (step < timeStep) {
    const f = asked[step];
    const v = answers[f.key];
    const answered = hasAnswer(f, v);
    // The server's own rule, run early: a count outside its bounds is caught
    // here, on its question, rather than three steps later at the confirm.
    const verdict = resolveAnswer({ label: f.label, type: f.type, config: f.config ?? {} }, v);
    const canNext = verdict.ok && (!f.required || answered);
    const next = () => canNext && setStep(step + 1);
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        {progress}
        <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>{f.label}</strong>
        <div style={{ marginTop: 10 }}>
          {/* Keyed by question so one step's open "something else" box or
              focus never carries into the next. The control drawn is chosen
              by the field's type and config — see BookingQuestion.tsx. */}
          <QuestionInput
            key={f.key}
            field={f}
            value={v}
            onChange={(a) => setAnswers({ ...answers, [f.key]: a })}
            onEnter={next}
            inputStyle={cf}
          />
        </div>
        {!verdict.ok && (
          <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{verdict.error}</p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {back}
          <button
            onClick={next}
            disabled={!canNext}
            style={{ ...linkBtn, ...liveBtn, cursor: "pointer", opacity: canNext ? 1 : 0.55 }}
          >
            {answered || f.required ? "Next" : "Skip"}
          </button>
        </div>
      </div>
    );
  }

  if (step === timeStep) {
    return (
      <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
        {progress}
        <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>
          When works for you?
        </strong>
        <div style={{ marginTop: 10 }}>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            style={cf}
          />
        </div>
        {when && !timeOk && (
          <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>
            Pick a time in the future.
          </p>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          {back}
          <button
            onClick={() => timeOk && setStep(reviewStep)}
            disabled={!timeOk}
            style={{ ...linkBtn, ...liveBtn, cursor: "pointer", opacity: timeOk ? 1 : 0.55 }}
          >
            Next
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 440 }}>
      {progress}
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>Confirm your booking</strong>
      <dl style={{ margin: "10px 0", fontSize: 13 }}>
        {fields
          .filter((f) => hasAnswer(f, answers[f.key]))
          .map((f) => {
            // A menu answer lists each pick with its price, then what they
            // add up to — the visitor confirms a figure, not just names.
            const lines = answerLines(f, answers[f.key]);
            const total = lines.length > 1 ? answerTotal(f, answers[f.key]) : "";
            return (
              <div key={f.key} style={{ marginBottom: 6 }}>
                <dt style={{ color: "var(--on-bg-soft)", fontSize: 12 }}>{f.label}</dt>
                {lines.map((line) => (
                  <dd key={line} style={{ margin: 0 }}>
                    {line}
                  </dd>
                ))}
                {total && <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>Estimated total: {total}</dd>}
              </div>
            );
          })}
        <div>
          <dt style={{ color: "var(--on-bg-soft)", fontSize: 12 }}>Time</dt>
          <dd style={{ margin: 0 }}>
            {startsAt?.toLocaleString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      {state === "error" && (
        <p style={{ color: "var(--danger-on-bg-soft)", fontSize: 13, marginBottom: 8 }}>{error}</p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        {back}
        <button
          onClick={submit}
          disabled={state === "sending"}
          style={{
            ...linkBtn,
            ...liveBtn,
            padding: "10px 18px",
            cursor: "pointer",
            opacity: state === "sending" ? 0.55 : 1,
          }}
        >
          {state === "sending" ? "Booking…" : "Confirm booking"}
        </button>
      </div>
    </div>
  );
}

/** Past this many the list folds: a chat bubble is not a menu page. */
const SERVICES_SHOWN = 5;
/** Longer than this and a description clamps to two lines behind "More". */
const SERVICE_BLURB = 140;

/**
 * The tenant's services, with booking one tap away. Book swaps the list for
 * the same wizard show_booking draws, opened with that service already
 * answered, so the visitor never retypes what they just tapped. The block can
 * come from a stored sample, which is admin-typed JSON: a booking config that
 * isn't a field list means "no Book button", never a crash.
 */
function ServicesCard({
  slug,
  items,
  booking,
}: {
  slug: string;
  items: ServiceCard[];
  booking: ServiceBooking | null;
}) {
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<ServiceCard | null>(null);
  const fields =
    booking && Array.isArray(booking.fields) && booking.fields.length > 0 ? booking.fields : null;

  if (picked && fields) {
    return (
      <BookingCard
        key={picked.id}
        slug={slug}
        fields={fields}
        prefill={booking?.serviceKey ? { [booking.serviceKey]: picked.name } : undefined}
        intro={
          <p style={{ fontSize: 13, color: "var(--on-bg-soft)", margin: "0 0 10px" }}>
            Booking <strong>{picked.name}</strong>{" "}
            <button onClick={() => setPicked(null)} style={textBtn}>
              Change
            </button>
          </p>
        }
      />
    );
  }

  const shown = all ? items : items.slice(0, SERVICES_SHOWN);
  return (
    <div data-fill="bg-soft" style={{ ...card, maxWidth: 480 }}>
      <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>Services</strong>
      {fields && (
        <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 13, margin: "6px 0 4px" }}>
          Tap Book on any service to pick a time.
        </p>
      )}
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {shown.map((s, i) => (
          <ServiceRow
            key={s?.id ?? i}
            service={s}
            first={i === 0}
            onBook={fields ? () => setPicked(s) : undefined}
          />
        ))}
      </ul>
      {items.length > SERVICES_SHOWN && (
        <button
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          style={{ ...linkBtn, cursor: "pointer", marginTop: 10 }}
        >
          {all ? "Show fewer ▴" : `Show all ${items.length} ▾`}
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-heading)" }}>
          {service.name}
        </div>
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
      {open !== null && (
        <div style={lightbox} onClick={() => setOpen(null)}>
          <div data-fill="surface" style={lightboxInner} onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={items[open].src} alt={items[open].description} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: "var(--radius-sm)" }} />
            {items[open].description && (
              <p style={{ color: "var(--on-surface)", fontSize: 15, marginTop: 12 }}>{items[open].description}</p>
            )}
            <button style={{ ...linkBtn, marginTop: 14 }} onClick={() => setOpen(null)}>
              Close ✕
            </button>
          </div>
        </div>
      )}
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
// Exported: the onboarding chat renders its own entry elements in this exact
// A2UI card idiom (same styles, not a copy).
export const card: React.CSSProperties = {
  background: "var(--bg-soft)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--on-bg-soft)",
  padding: 16,
};
const linkBtn: React.CSSProperties = {
  fontSize: 13,
  padding: "7px 12px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  color: "var(--on-surface)",
  background: "var(--surface)",
  textDecoration: "none",
};
export const cf: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  marginBottom: 10,
  outline: "none",
  fontSize: 14,
  color: "var(--on-surface)",
};
const liveBtn: React.CSSProperties = {
  background: "var(--primary)",
  color: "var(--on-primary)",
  border: "none",
};
const textBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  fontSize: 13,
  color: "var(--accent-on-bg-soft)",
  textDecoration: "underline",
  cursor: "pointer",
};
const clamp2: React.CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
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

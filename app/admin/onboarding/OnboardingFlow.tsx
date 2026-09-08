"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { panel, btn, btnGhost } from "../ui";
import { card as a2uiCard, cf as a2uiField } from "@/app/cards/Cards";
import { FONT_OPTIONS, BODY_FONT_OPTIONS } from "@/lib/fonts";
import { RADIUS_OPTIONS, type ThemeColors } from "@/lib/theme";
import { ThemePicker } from "../ThemePicker";
import { FormCard, type FieldSpec } from "./FormCard";
import { GalleryCard, type GalleryItem } from "./GalleryCard";

/**
 * Onboarding as a conversation: the assistant asks for the website link, then
 * walks through the stages one message at a time — contact info (with one
 * form per location), theme (the dashboard's own ThemePicker), then a
 * pick-what-you-have knowledge extraction that keeps running while the user
 * heads to the dashboard. Extraction pre-fills every form before it shows,
 * and the loading state streams the job's REAL activity log.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type LocationForm = { address: string; phone: string } & Record<string, string>;

type Status = {
  phase: string; progress: number; log?: string[]; error?: string;
  step1?: Record<string, unknown>; step2?: Record<string, unknown>;
  stepLoc?: { locations?: Record<string, unknown>[] };
  stepSocial?: { links?: { platform?: string; url?: string }[] };
  stepImages?: { images?: { src?: string; caption?: string }[] };
  stepBrand?: { tagline?: string; taglineSource?: string; values?: string[]; tone?: string };
  chunkCount?: number;
  report?: {
    blog?: { postsSaved: number; existed: boolean };
    testimonials?: { count: number; embeddedWidget?: boolean };
    team?: { blocks: number };
    services?: { services: number };
    sweep?: { pages: string[] };
  };
  graph?: { entities: number; relations: number };
};

type Step =
  | "ask-url" | "core-running" | "review-contact"
  | "locations-running" | "review-locations"
  | "social-running" | "review-social"
  | "images-running" | "review-images"
  | "theme-running" | "review-theme"
  | "select-knowledge" | "knowledge-running";

const COMPANY_FIELDS: FieldSpec[] = [
  { kind: "text", key: "company_name", label: "Company name" },
  { kind: "text", key: "owner_name", label: "Owner name" },
  { kind: "text", key: "company_phone_number", label: "Company phone number" },
  { kind: "text", key: "company_email", label: "Company email" },
];

// ── Hours dropdown ──
// One select per day: Closed, 24 hours, and every whole-hour open–close range.
// Everything is still stored as plain text (the save route flattens hours into
// the Profile), so the dropdown just constrains what that text can be.
const hourLabel = (h: number): string => {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${h < 12 || h === 24 ? "AM" : "PM"}`;
};
const HOUR_RANGE_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let open = 6; open <= 12; open++)
    for (let close = Math.max(open + 1, 12); close <= 24; close++)
      out.push(`${hourLabel(open)} – ${hourLabel(close)}`);
  return out;
})();

/** Snap extracted free text ("9 AM–7:00 pm") onto a dropdown option; unmappable text is kept as-is. */
function normalizeHours(raw: string): string {
  const t = raw.trim();
  if (!t || /^closed?$/i.test(t)) return "";
  if (/24\s*h|24[/ -]?7|always open/i.test(t)) return "Open 24 hours";
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–—~]|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!m || (m[2] && m[2] !== "00") || (m[5] && m[5] !== "00")) return t;
  let open = parseInt(m[1], 10) % 12;
  if ((m[3] ?? "am").toLowerCase() === "pm") open += 12;
  let close = parseInt(m[4], 10) % 12;
  if (m[6].toLowerCase() === "pm") close += 12;
  if (close === 0) close = 24; // "12 AM" close means midnight
  const label = `${hourLabel(open)} – ${hourLabel(close)}`;
  return HOUR_RANGE_OPTIONS.includes(label) ? label : t;
}

/** Per-day options; a value the presets don't cover is kept as its own option. */
const hoursOptions = (current: string) => [
  { value: "", label: "Closed" },
  ...(current && current !== "Open 24 hours" && !HOUR_RANGE_OPTIONS.includes(current)
    ? [{ value: current, label: `${current} (from your site)` }]
    : []),
  { value: "Open 24 hours", label: "Open 24 hours" },
  ...HOUR_RANGE_OPTIONS.map((r) => ({ value: r, label: r })),
];

const locationFields = (loc: LocationForm): FieldSpec[] => [
  { kind: "text", key: "address", label: "Address" },
  { kind: "text", key: "phone", label: "Phone (this location)" },
  ...DAYS.map<FieldSpec>((d) => ({
    kind: "select", key: `hours_${d}`,
    label: `Hours — ${d[0].toUpperCase()}${d.slice(1)}`,
    options: hoursOptions(loc[`hours_${d}`] ?? ""),
  })),
];

const emptyLocation = (): LocationForm =>
  ({ address: "", phone: "", ...Object.fromEntries(DAYS.map((d) => [`hours_${d}`, ""])) }) as LocationForm;

type SocialForm = { platform: string; url: string };

const SOCIAL_FIELDS: FieldSpec[] = [
  { kind: "text", key: "platform", label: "Platform", placeholder: "instagram" },
  { kind: "text", key: "url", label: "Profile link", placeholder: "https://instagram.com/yourbusiness" },
];

const EXTRACTOR_OPTIONS = [
  { key: "blog", label: "Blog / news posts" },
  { key: "testimonials", label: "Testimonials / reviews" },
  { key: "team", label: "Team / about page" },
  { key: "services", label: "Services & how you take bookings" },
  { key: "sweep", label: "Everything else (pricing, policies…)" },
];

type ThemeInitial = {
  themeFont: string; themeBodyFont: string; themeRadius: string;
  themeFontSize: string; themeHeadingWeight: string; colors: ThemeColors;
};
const defaultTheme = (): ThemeInitial => ({
  themeFont: "space-grotesk", themeBodyFont: "inter", themeRadius: "rounded",
  themeFontSize: "16", themeHeadingWeight: "700", colors: {},
});

/** Lemonade-style letter-by-letter text for assistant messages. Progress is
 *  derived from elapsed time, not tick counts, so a backgrounded tab (whose
 *  timers the browser throttles) catches up instantly instead of stalling. */
/**
 * What the run actually found. Only non-zero categories are listed: a site
 * with no blog is the normal case for a small business, and printing
 * "0 blog posts, 0 testimonials, 0 team bios" next to a healthy chunk count
 * reads as a failure when nothing failed.
 */
function summarizeFound(status: Status): string[] {
  const r = status.report;
  if (!r) return [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (r.blog?.postsSaved) parts.push(plural(r.blog.postsSaved, "blog post", "blog posts"));
  if (r.services?.services) parts.push(plural(r.services.services, "service", "services"));
  if (r.testimonials?.count) parts.push(plural(r.testimonials.count, "testimonial", "testimonials"));
  if (r.team?.blocks) parts.push(plural(r.team.blocks, "team bio", "team bios"));
  if (r.sweep?.pages.length) parts.push(plural(r.sweep.pages.length, "page", "pages"));
  return parts;
}

/**
 * Why a category came back empty, when the reason is knowable. The extractors
 * already distinguish "no blog on this site" from "a blog with no posts" and
 * flag third-party review widgets; without this that detail is captured and
 * then thrown away at render time, leaving the user to guess.
 */
function summarizeAbsent(status: Status): string[] {
  const r = status.report;
  if (!r) return [];
  const notes: string[] = [];
  if (r.blog && !r.blog.postsSaved) {
    notes.push(r.blog.existed
      ? "Your blog page is set up but has no posts published yet."
      : "I didn't find a blog on this site.");
  }
  if (r.testimonials && !r.testimonials.count) {
    notes.push(r.testimonials.embeddedWidget
      ? "Your reviews load through a third-party widget, so they aren't in the page itself."
      : "No customer testimonials were written on the site.");
  }
  if (r.team && !r.team.blocks) notes.push("No team members were introduced by name.");
  return notes;
}

function Typewriter({ text, speed = 14, onDone }: { text: string; speed?: number; onDone?: () => void }) {
  const [shown, setShown] = useState(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    setShown(0);
    const startedAt = Date.now();
    const t = setInterval(() => {
      const n = Math.min(text.length, Math.floor((Date.now() - startedAt) / speed));
      setShown(n);
      if (n >= text.length) clearInterval(t);
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  // Completion is signaled from an effect, not from inside the interval's
  // state updater — updating the parent mid-render is a React error.
  useEffect(() => {
    if (text.length > 0 && shown >= text.length) onDoneRef.current?.();
  }, [shown, text]);
  return <>{text.slice(0, shown)}</>;
}

/**
 * The live extraction feed: REAL activity lines from the job (pages being
 * read, values found, sections that don't exist), streamed in order. The
 * newest line types in; earlier ones stay dimmed above it.
 */
function ActivityStream({ lines, progress }: { lines: string[]; progress: number }) {
  const tail = lines.slice(-5);
  return (
    <div aria-live="polite">
      <div style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 10, minHeight: 22 }}>
        {tail.map((l, i) => (
          <div key={`${lines.length - tail.length + i}`} style={{ opacity: i === tail.length - 1 ? 1 : 0.55 }}>
            {i === tail.length - 1 ? <Typewriter text={l} /> : l}
          </div>
        ))}
      </div>
      <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(progress, 3)}%`, height: "100%", background: "var(--primary)", transition: "width .6s" }} />
      </div>
    </div>
  );
}

/**
 * The user's side of the conversation: entry forms and cards render as a
 * right-aligned panel — the place the user answers from — instead of living
 * inside the assistant's ask bubble. Appears only after the assistant's text
 * has finished typing.
 */
function UserEntry({ children, maxWidth = 560 }: { children: React.ReactNode; maxWidth?: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end" }}>
      <div
        className="onboard-phase-in"
        style={{ ...panel, ...a2uiCard, width: "100%", maxWidth, marginBottom: 14 }}
      >
        {children}
      </div>
    </div>
  );
}

function Bubble({ who, children }: { who: "assistant" | "user"; children: React.ReactNode }) {
  const mine = who === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div
        className="onboard-phase-in"
        style={{
          ...panel,
          maxWidth: mine ? 560 : 680,
          marginBottom: 14,
          ...(mine ? { background: "var(--primary)", color: "var(--on-primary, #fff)", border: "none" } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("ask-url");
  const [manual, setManual] = useState(false);
  const [url, setUrl] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [company, setCompany] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<LocationForm[]>([emptyLocation()]);
  const [noInPerson, setNoInPerson] = useState(false);
  // Whether extraction actually found locations: decides the question's
  // wording and whether the online-only checkbox is offered at all.
  const [foundLocations, setFoundLocations] = useState(false);
  const [socials, setSocials] = useState<SocialForm[]>([]);
  // Whether extraction actually found profiles: decides the question's wording.
  const [foundSocials, setFoundSocials] = useState(false);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [themeInitial, setThemeInitial] = useState<ThemeInitial>(defaultTheme());
  const [logo, setLogo] = useState("");
  // Brand voice, extracted with the theme. The source flag records where the
  // PREFILL came from; editing the tagline text makes it the user's own.
  const [tagline, setTagline] = useState("");
  const [taglineSource, setTaglineSource] = useState("");
  const [extractedTagline, setExtractedTagline] = useState("");
  const [brandValues, setBrandValues] = useState("");
  const [tone, setTone] = useState("");
  const [picked, setPicked] = useState<string[]>(EXTRACTOR_OPTIONS.map((o) => o.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The entry panel for the current step shows only once the assistant's
  // message has fully typed out.
  const [textDone, setTextDone] = useState(false);
  // The greeting types exactly once, so its flag is never reset — the URL
  // card must come back if the user retries after a failed extraction.
  const [greetingDone, setGreetingDone] = useState(false);
  const themeFormRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const running =
    step === "core-running" || step === "locations-running" ||
    step === "social-running" || step === "images-running" ||
    step === "theme-running" || step === "knowledge-running";

  useEffect(() => {
    setTextDone(false);
  }, [step]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [step, status?.phase, textDone, greetingDone]);

  // One poller drives every running stage; step transitions happen on the
  // phase the backend reports, and each form is pre-filled before it shows.
  useEffect(() => {
    if (!jobId || !running) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/onboarding/status?jobId=${jobId}`);
      if (!res.ok) return;
      const s: Status = await res.json();
      setStatus(s);
      if (s.phase === "failed") return;
      if (step === "core-running" && s.phase === "core-done" && s.step1) {
        const p = s.step1 as Record<string, unknown>;
        setCompany({
          company_name: String(p.company_name ?? ""),
          owner_name: String(p.owner_name ?? ""),
          company_phone_number: String(p.company_phone_number ?? ""),
          company_email: String(p.company_email ?? ""),
        });
        setStep("review-contact");
      }
      if (step === "locations-running" && s.phase === "locations-done") {
        const found = s.stepLoc?.locations ?? [];
        setFoundLocations(found.length > 0);
        if (found.length) {
          setLocations(found.map((l) => {
            const hours = (l.hours ?? {}) as Record<string, string>;
            return {
              address: String(l.address ?? ""),
              phone: String(l.phone ?? ""),
              ...Object.fromEntries(DAYS.map((d) => [`hours_${d}`, normalizeHours(hours[d] ?? "")])),
            } as LocationForm;
          }));
        }
        setStep("review-locations");
      }
      if (step === "social-running" && s.phase === "social-done") {
        const links = (s.stepSocial?.links ?? [])
          .map((l) => ({ platform: String(l.platform ?? ""), url: String(l.url ?? "") }))
          .filter((l) => l.url);
        setFoundSocials(links.length > 0);
        if (links.length) setSocials(links);
        setStep("review-social");
      }
      if (step === "images-running" && s.phase === "images-done") {
        const imgs = (s.stepImages?.images ?? []).map((i) => ({
          src: String(i.src ?? ""), caption: String(i.caption ?? ""),
        })).filter((i) => i.src);
        if (imgs.length === 0) {
          // Nothing to review — move straight on to the theme.
          await post("/api/admin/onboarding/advance", { jobId, stage: "theme" });
          setStep("theme-running");
        } else {
          setGallery(imgs);
          setStep("review-images");
        }
      }
      if (step === "theme-running" && s.phase === "theme-done" && s.step2) {
        const t2 = s.step2 as Record<string, unknown>;
        const colors = (t2.themeColors ?? {}) as Record<string, string>;
        setThemeInitial({
          themeFont: "space-grotesk",
          themeBodyFont: String(t2.themeBodyFont ?? "inter"),
          themeRadius: String(t2.themeRadius ?? "rounded"),
          themeFontSize: String(t2.themeFontSize ?? "") || "16",
          themeHeadingWeight: String(t2.themeHeadingWeight ?? "") || "700",
          // The extractor already normalizes into the full seven-role
          // palette (readable, near-neutral bg), so roles pass straight through.
          colors: Object.fromEntries(
            ["bg", "text", "surface", "surfaceText", "accent", "accentText", "border"]
              .filter((k) => colors[k])
              .map((k) => [k, colors[k]]),
          ),
        });
        setLogo(String(t2.themeLogo ?? ""));
        const b = s.stepBrand ?? {};
        setTagline(String(b.tagline ?? ""));
        setExtractedTagline(String(b.tagline ?? ""));
        setTaglineSource(String(b.taglineSource ?? ""));
        setBrandValues((Array.isArray(b.values) ? b.values : []).join("\n"));
        setTone(String(b.tone ?? ""));
        setStep("review-theme");
      }
    }, 1500);
    return () => clearInterval(t);
  }, [jobId, running, step]);

  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function startExtraction() {
    setError("");
    const res = await post("/api/admin/onboarding/start", { url });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    const started = (await res.json()) as { jobId: string };
    setJobId(started.jobId);
    setStep("core-running");
  }

  async function saveContact() {
    setBusy(true);
    setError("");
    const profile = {
      company_name: company.company_name ?? "",
      owner_name: company.owner_name ?? "",
      company_phone_number: company.company_phone_number ?? "",
      company_email: company.company_email ?? "",
    };
    const res = await post("/api/admin/onboarding/save", { profile });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      setStep("review-locations");
    } else {
      await post("/api/admin/onboarding/advance", { jobId, stage: "locations" });
      setStep("locations-running");
    }
    setBusy(false);
  }

  async function saveLocations() {
    setBusy(true);
    setError("");
    const res = await post("/api/admin/onboarding/save", {
      locations: {
        no_in_person: noInPerson,
        locations: noInPerson ? [] : locations.map((l) => ({
          address: l.address,
          phone: l.phone,
          hours: Object.fromEntries(DAYS.map((d) => [d, l[`hours_${d}`] ?? ""])),
        })),
      },
    });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      setStep("review-social");
    } else {
      await post("/api/admin/onboarding/advance", { jobId, stage: "social" });
      setStep("social-running");
    }
    setBusy(false);
  }

  async function saveSocials() {
    setBusy(true);
    setError("");
    const res = await post("/api/admin/onboarding/save", {
      social: { links: socials.filter((l) => l.url.trim()) },
    });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      setStep("review-theme");
    } else {
      await post("/api/admin/onboarding/advance", { jobId, stage: "images" });
      setStep("images-running");
    }
    setBusy(false);
  }

  async function saveGallery() {
    setBusy(true);
    setError("");
    const res = await post("/api/admin/onboarding/save", { gallery: { images: gallery } });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    await post("/api/admin/onboarding/advance", { jobId, stage: "theme" });
    setStep("theme-running");
    setBusy(false);
  }

  async function skipGallery() {
    setBusy(true);
    setError("");
    await post("/api/admin/onboarding/advance", { jobId, stage: "theme" });
    setStep("theme-running");
    setBusy(false);
  }

  async function saveTheme() {
    const form = themeFormRef.current;
    if (!form) return;
    setBusy(true);
    setError("");
    // ThemePicker maintains hidden inputs for every value — read them back
    // exactly as the dashboard's save action would.
    const fd = new FormData(form);
    const v = (k: string) => String(fd.get(k) ?? "");
    const colorKeys = ["bg", "text", "surface", "surfaceText", "accent", "accentText", "border"];
    const themeColors: Record<string, string> = {};
    for (const k of colorKeys) {
      const val = v(`color_${k}`);
      if (val) themeColors[k] = val;
    }
    const res = await post("/api/admin/onboarding/save", {
      theme: {
        themeFont: v("themeFont"),
        themeBodyFont: v("themeBodyFont"),
        themeRadius: v("themeRadius"),
        themeFontSize: v("themeFontSize"),
        themeHeadingWeight: v("themeHeadingWeight"),
        themeColors,
        themeLogo: logo,
      },
      brand: {
        tagline,
        // Edited text is the user's own wording — the provenance flag only
        // survives while the tagline is exactly what extraction produced.
        taglineSource: tagline === extractedTagline ? taglineSource : "",
        values: brandValues.split("\n").map((s) => s.trim()).filter(Boolean),
        tone,
      },
    });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      await post("/api/admin/onboarding/complete", { mode: "manual" });
      router.push("/admin/chat");
      return;
    }
    setStep("select-knowledge");
    setBusy(false);
  }

  async function startKnowledge() {
    setBusy(true);
    setError("");
    const res = await post("/api/admin/onboarding/advance", {
      jobId, stage: "knowledge", extractors: picked,
    });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    // The user is set up from here — knowledge keeps extracting on its own.
    await post("/api/admin/onboarding/complete", { mode: "site" });
    setStep("knowledge-running");
    setBusy(false);
  }

  async function skipToDashboard(mode: "site" | "manual") {
    await post("/api/admin/onboarding/complete", { mode });
    router.push("/admin/chat");
  }

  return (
    <div>
      <Bubble who="assistant">
        <p style={{ margin: 0, minHeight: 42 }}>
          <Typewriter
            text="Hi! I'll set up your agent page with you right here. First: what's your website link? I'll read it and fill everything in for you."
            onDone={() => setGreetingDone(true)}
          />
        </p>
      </Bubble>

      {step === "ask-url" && greetingDone && (
        // The link entry is an A2UI card element on the user's side of the
        // chat — it appears only once the greeting has finished typing.
        <UserEntry maxWidth={460}>
          <strong style={{ fontSize: 15, fontFamily: "var(--font-heading)" }}>
            Add your website
          </strong>
          <p style={{ fontStyle: "italic", fontSize: 13, margin: "6px 0 12px", opacity: 0.8 }}>
            Paste the link to your existing site and I&apos;ll read it for you.
          </p>
          <input
            style={a2uiField}
            placeholder="https://your-current-site.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url.trim() && startExtraction()}
          />
          <button style={btn} onClick={startExtraction} disabled={!url.trim()}>
            Extract my site
          </button>
          <button
            style={{ ...btnGhost, marginLeft: 10 }}
            onClick={() => { setManual(true); setStep("review-contact"); }}
          >
            I don&apos;t have a site — set up manually
          </button>
        </UserEntry>
      )}

      {(manual || url) && step !== "ask-url" && (
        <Bubble who="user">{manual ? "I'll set it up manually." : url}</Bubble>
      )}

      {step === "core-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            <Typewriter text="On it — extracting your contact info now." />
          </p>
          <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
        </Bubble>
      )}

      {step === "review-contact" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text={manual
                  ? "No problem — fill in your business details on the right."
                  : "Here's what I found. Fix anything that's off, then hit Done."}
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry>
              <FormCard
                fields={COMPANY_FIELDS}
                values={company}
                onChange={(k, v) => setCompany({ ...company, [k]: v })}
                onDone={saveContact}
                doneLabel="Done — looks right"
                busy={busy}
              />
            </UserEntry>
          )}
        </>
      )}

      {step === "locations-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            <Typewriter text="Now — where can customers find you? I'm reading your location and hours pages." />
          </p>
          <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
        </Bubble>
      )}

      {step === "review-locations" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text={manual
                  ? "Where can customers find you? Add each location with its hours — or tick online-only."
                  : foundLocations
                    ? "Here are the locations and hours I found. Fix anything, add what I missed, then hit Done."
                    : "I found no locations on your site. Add each location with its hours — or tick online-only."}
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry>
              {/* The online-only escape hatch is only offered when extraction
                  found nothing (or in manual setup) — a site with locations
                  already answered the question. */}
              {!foundLocations && (
                <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "4px 0 14px", fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={noInPerson}
                    onChange={(e) => setNoInPerson(e.target.checked)}
                  />
                  No in-person location (online only)
                </label>
              )}
              {!noInPerson && locations.map((loc, i) => (
                <div
                  key={i}
                  className="onboard-phase-in"
                  style={{ ...a2uiCard, background: "transparent", color: "inherit", marginBottom: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 14, fontFamily: "var(--font-heading)" }}>
                      Location {i + 1}
                    </strong>
                    {locations.length > 1 && (
                      <button
                        style={btnGhost}
                        onClick={() => setLocations(locations.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <FormCard
                    fields={locationFields(loc)}
                    values={loc}
                    onChange={(k, v) =>
                      setLocations(locations.map((l, j) => (j === i ? { ...l, [k]: v } : l)))}
                    busy={busy}
                  />
                </div>
              ))}
              {!noInPerson && (
                <button
                  style={{ ...btnGhost, marginBottom: 14 }}
                  onClick={() => setLocations([...locations, emptyLocation()])}
                >
                  + Add another location
                </button>
              )}
              <div>
                <button style={btn} onClick={saveLocations} disabled={busy}>
                  {busy ? "Saving…" : "Done — locations are right"}
                </button>
              </div>
            </UserEntry>
          )}
        </>
      )}

      {step === "social-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            <Typewriter text="Saved. Now I'm checking your site for your social media profiles." />
          </p>
          <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
        </Bubble>
      )}

      {step === "review-social" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text={manual
                  ? "Where can customers follow you? Add your social media profiles — or skip if you don't use them."
                  : foundSocials
                    ? "Here are the social media profiles I found on your site. Fix anything, add what I missed, then hit Done."
                    : "I found no social media links on your site. Add your profiles — or skip if you don't use them."}
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry>
              {socials.map((s, i) => (
                <div
                  key={i}
                  className="onboard-phase-in"
                  style={{ ...a2uiCard, background: "transparent", color: "inherit", marginBottom: 12 }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <strong style={{ fontSize: 14, fontFamily: "var(--font-heading)" }}>
                      Profile {i + 1}
                    </strong>
                    <button
                      style={btnGhost}
                      onClick={() => setSocials(socials.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                  <FormCard
                    fields={SOCIAL_FIELDS}
                    values={s as unknown as Record<string, string>}
                    onChange={(k, v) =>
                      setSocials(socials.map((l, j) => (j === i ? { ...l, [k]: v } : l)))}
                    busy={busy}
                  />
                </div>
              ))}
              <button
                style={{ ...btnGhost, marginBottom: 14 }}
                onClick={() => setSocials([...socials, { platform: "", url: "" }])}
              >
                + Add a profile
              </button>
              <div>
                <button style={btn} onClick={saveSocials} disabled={busy}>
                  {busy
                    ? "Saving…"
                    : socials.some((l) => l.url.trim())
                      ? "Done — profiles are right"
                      : "No social media — continue"}
                </button>
              </div>
            </UserEntry>
          )}
        </>
      )}

      {step === "images-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            <Typewriter text="Saved. Now let me gather photos from your site for your gallery." />
          </p>
          <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
        </Bubble>
      )}

      {step === "review-images" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text={`I found ${gallery.length} photo${gallery.length === 1 ? "" : "s"} on your site. Check the captions, drop any you don't want, then hit Done.`}
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry maxWidth={620}>
              <GalleryCard
                images={gallery}
                onCaption={(i, caption) =>
                  setGallery(gallery.map((g, j) => (j === i ? { ...g, caption } : g)))}
                onRemove={(i) => setGallery(gallery.filter((_, j) => j !== i))}
                busy={busy}
              />
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button style={btn} onClick={saveGallery} disabled={busy || gallery.length === 0}>
                  {busy ? "Saving…" : "Done — save these photos"}
                </button>
                <button style={btnGhost} onClick={skipGallery} disabled={busy}>
                  Skip photos
                </button>
              </div>
            </UserEntry>
          )}
        </>
      )}

      {step === "theme-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            <Typewriter text="Saved. I'll now extract your theme — colors, fonts, corners, and logo." />
          </p>
          <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
        </Bubble>
      )}

      {step === "review-theme" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text={manual
                  ? "Pick the look for your agent page, and tell me about your brand voice."
                  : "Here's the look and brand voice I pulled from your site — tweak them to taste."}
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry maxWidth={680}>
              {logo && (
                <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data-dir upload, unoptimized preview */}
                  <img src={logo} alt="Imported logo" style={{ height: 32, verticalAlign: "middle", marginRight: 8 }} />
                  Logo imported from your site.
                </p>
              )}
              {/* Brand voice: tagline (with its provenance), values, tone. */}
              <div style={{ marginBottom: 16 }}>
                <strong style={{ fontSize: 14, fontFamily: "var(--font-heading)" }}>Brand voice</strong>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
                    Tagline
                    {tagline && tagline === extractedTagline && taglineSource === "suggested" && (
                      <span
                        style={{
                          marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999,
                          background: "var(--bg-soft)", border: "1px solid var(--border)",
                          fontStyle: "italic",
                        }}
                        title="Your site doesn't state a tagline, so this one was written from your site's own copy. Edit it or keep it."
                      >
                        suggested — not from your site
                      </span>
                    )}
                  </label>
                  <input
                    style={a2uiField}
                    value={tagline}
                    placeholder="A one-line motto for your business"
                    onChange={(e) => setTagline(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
                    Brand values (one per line)
                  </label>
                  <textarea
                    style={{ ...a2uiField, resize: "vertical" }}
                    rows={3}
                    value={brandValues}
                    placeholder={"Local first\nHonest craftsmanship"}
                    onChange={(e) => setBrandValues(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 13, display: "block", marginBottom: 4 }}>
                    Tone of voice (how your agent should write)
                  </label>
                  <textarea
                    style={{ ...a2uiField, resize: "vertical" }}
                    rows={2}
                    value={tone}
                    placeholder="Warm and conversational; short sentences; no jargon."
                    onChange={(e) => setTone(e.target.value)}
                  />
                </div>
              </div>
              {/* The dashboard's own Theme panel, pre-filled by extraction. */}
              <form ref={themeFormRef} onSubmit={(e) => { e.preventDefault(); void saveTheme(); }}>
                <ThemePicker
                  key={JSON.stringify(themeInitial)}
                  fontOptions={FONT_OPTIONS}
                  bodyFontOptions={BODY_FONT_OPTIONS}
                  radiusOptions={RADIUS_OPTIONS}
                  initial={themeInitial}
                />
                <button type="submit" style={{ ...btn, marginTop: 14 }} disabled={busy}>
                  {busy ? "Saving…" : "Done — use this theme"}
                </button>
              </form>
            </UserEntry>
          )}
        </>
      )}

      {step === "select-knowledge" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>
              <Typewriter
                text="Last step: which of these does your site have? I'll extract what you pick into your agent's knowledge."
                onDone={() => setTextDone(true)}
              />
            </p>
          </Bubble>
          {textDone && (
            <UserEntry maxWidth={460}>
              {EXTRACTOR_OPTIONS.map((o) => (
                <label key={o.key} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={picked.includes(o.key)}
                    onChange={(e) =>
                      setPicked(e.target.checked ? [...picked, o.key] : picked.filter((k) => k !== o.key))}
                  />
                  {o.label}
                </label>
              ))}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <button style={btn} onClick={startKnowledge} disabled={busy || picked.length === 0}>
                  Start extraction
                </button>
                <button style={btnGhost} onClick={() => skipToDashboard("site")} disabled={busy}>
                  Skip this
                </button>
              </div>
            </UserEntry>
          )}
        </>
      )}

      {step === "knowledge-running" && (
        <>
          <Bubble who="assistant">
            {status?.phase === "done" ? (
              <div>
                <p style={{ margin: 0 }}>
                  All done — I saved <strong>{status.chunkCount ?? 0}</strong> knowledge chunks
                  {summarizeFound(status).length
                    ? ` (${summarizeFound(status).join(", ")}).`
                    : "."}
                  {status.graph?.entities
                    ? ` I also connected ${status.graph.entities} thing${status.graph.entities === 1 ? "" : "s"} across ${status.graph.relations} relationship${status.graph.relations === 1 ? "" : "s"}.`
                    : ""}
                </p>
                {summarizeAbsent(status).length > 0 && (
                  <p style={{ margin: "8px 0 0", opacity: 0.75, fontSize: 14 }}>
                    {summarizeAbsent(status).join(" ")}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p style={{ margin: "0 0 10px" }}>
                  <Typewriter
                    text="Extracting now. This can take a few minutes on a big site — you don't need to wait, I'll keep going in the background."
                    onDone={() => setTextDone(true)}
                  />
                </p>
                <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
              </div>
            )}
          </Bubble>
          {(textDone || status?.phase === "done") && (
            <UserEntry maxWidth={360}>
              <button style={btn} onClick={() => router.push("/admin/chat")}>
                Continue to chat →
              </button>
            </UserEntry>
          )}
        </>
      )}

      {status?.phase === "failed" && (
        <>
          <Bubble who="assistant">
            <p style={{ margin: 0 }}>{status.error || "Extraction failed."}</p>
          </Bubble>
          <UserEntry maxWidth={360}>
            <button
              style={btnGhost}
              onClick={() => { setStep("ask-url"); setStatus(null); setJobId(null); }}
            >
              Try another URL or set up manually
            </button>
          </UserEntry>
        </>
      )}

      {error && <p style={{ color: "var(--danger, #f66)" }}>{error}</p>}
      <div ref={endRef} />
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { panel, btn, btnGhost, Label } from "../ui";
import { card as a2uiCard, cf as a2uiField } from "@/app/cards/Cards";
import { FONT_OPTIONS, BODY_FONT_OPTIONS } from "@/lib/fonts";
import { RADIUS_OPTIONS, type ThemeColors } from "@/lib/theme";
import { ThemePicker } from "../ThemePicker";
import { FormCard, type FieldSpec } from "./FormCard";

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
  chunkCount?: number;
  report?: { blog?: { postsSaved: number }; testimonials?: { count: number }; team?: { blocks: number } };
};

type Step =
  | "ask-url" | "core-running" | "review-contact"
  | "theme-running" | "review-theme"
  | "select-knowledge" | "knowledge-running";

const COMPANY_FIELDS: FieldSpec[] = [
  { kind: "text", key: "company_name", label: "Company name" },
  { kind: "text", key: "owner_name", label: "Owner name" },
  { kind: "text", key: "company_phone_number", label: "Company phone number" },
  { kind: "text", key: "company_email", label: "Company email" },
];

const locationFields = (): FieldSpec[] => [
  { kind: "text", key: "address", label: "Address" },
  { kind: "text", key: "phone", label: "Phone (this location)" },
  ...DAYS.map<FieldSpec>((d) => ({
    kind: "text", key: `hours_${d}`,
    label: `Hours — ${d[0].toUpperCase()}${d.slice(1)}`, placeholder: "closed",
  })),
];

const emptyLocation = (): LocationForm =>
  ({ address: "", phone: "", ...Object.fromEntries(DAYS.map((d) => [`hours_${d}`, ""])) }) as LocationForm;

const EXTRACTOR_OPTIONS = [
  { key: "blog", label: "Blog / news posts" },
  { key: "testimonials", label: "Testimonials / reviews" },
  { key: "team", label: "Team / about page" },
  { key: "sweep", label: "Everything else on the sitemap" },
];

type ThemeInitial = {
  themeFont: string; themeBodyFont: string; themeRadius: string;
  themeFontSize: string; themeHeadingWeight: string; colors: ThemeColors;
};
const defaultTheme = (): ThemeInitial => ({
  themeFont: "space-grotesk", themeBodyFont: "inter", themeRadius: "rounded",
  themeFontSize: "16", themeHeadingWeight: "700", colors: {},
});

/** Lemonade-style letter-by-letter text for assistant messages. */
function Typewriter({ text, speed = 14 }: { text: string; speed?: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(t);
          return n;
        }
        return n + 1;
      });
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
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
  const [themeInitial, setThemeInitial] = useState<ThemeInitial>(defaultTheme());
  const [logo, setLogo] = useState("");
  const [picked, setPicked] = useState<string[]>(EXTRACTOR_OPTIONS.map((o) => o.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const themeFormRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const running = step === "core-running" || step === "theme-running" || step === "knowledge-running";

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [step, status?.phase]);

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
        const found = Array.isArray(p.locations) ? (p.locations as Record<string, unknown>[]) : [];
        if (found.length) {
          setLocations(found.map((l) => {
            const hours = (l.hours ?? {}) as Record<string, string>;
            return {
              address: String(l.address ?? ""),
              phone: String(l.phone ?? ""),
              ...Object.fromEntries(DAYS.map((d) => [`hours_${d}`, hours[d] ?? ""])),
            } as LocationForm;
          }));
        }
        setStep("review-contact");
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
          // The extractor's "primary" is the brand color; surface is the fill
          // cards and primary buttons share, so it lands there.
          colors: {
            ...(colors.bg ? { bg: colors.bg } : {}),
            ...(colors.text ? { text: colors.text } : {}),
            ...(colors.primary ? { surface: colors.primary } : {}),
          },
        });
        setLogo(String(t2.themeLogo ?? ""));
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
      no_in_person: noInPerson,
      locations: noInPerson ? [] : locations.map((l) => ({
        address: l.address,
        phone: l.phone,
        hours: Object.fromEntries(DAYS.map((d) => [d, l[`hours_${d}`] ?? ""])),
      })),
    };
    const res = await post("/api/admin/onboarding/save", { profile });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      setStep("review-theme");
    } else {
      await post("/api/admin/onboarding/advance", { jobId, stage: "theme" });
      setStep("theme-running");
    }
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
    });
    if (!res.ok) {
      setError(await res.text());
      setBusy(false);
      return;
    }
    if (manual) {
      await post("/api/admin/onboarding/complete", { mode: "manual" });
      router.push("/admin/dashboard");
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
    router.push("/admin/dashboard");
  }

  return (
    <div>
      <Bubble who="assistant">
        <p style={{ margin: 0, minHeight: 42 }}>
          <Typewriter text="Hi! I'll set up your agent page with you right here. First: what's your website link? I'll read it and fill everything in for you." />
        </p>
        {step === "ask-url" && (
          // The link entry is an A2UI card element, the same idiom (and the
          // same exported styles) the agent's in-chat cards use. It phases in
          // after the greeting starts typing, on the bubble's own background
          // so the chat reads as one surface.
          <div
            className="onboard-phase-in-late"
            style={{ ...a2uiCard, background: "transparent", color: "inherit", maxWidth: 440, marginTop: 14 }}
          >
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
          </div>
        )}
      </Bubble>

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
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            <Typewriter
              text={manual
                ? "No problem — fill in your business details below."
                : "Here's what I found. Fix anything that's off, then hit Done."}
            />
          </p>
          <FormCard
            fields={COMPANY_FIELDS}
            values={company}
            onChange={(k, v) => setCompany({ ...company, [k]: v })}
            busy={busy}
          />
          <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "4px 0 14px", fontSize: 14 }}>
            <input
              type="checkbox"
              checked={noInPerson}
              onChange={(e) => setNoInPerson(e.target.checked)}
            />
            No in-person location (online only)
          </label>
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
                fields={locationFields()}
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
            <button style={btn} onClick={saveContact} disabled={busy}>
              {busy ? "Saving…" : "Done — looks right"}
            </button>
          </div>
        </Bubble>
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
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            <Typewriter
              text={manual
                ? "Pick the look for your agent page."
                : "Here's the look I pulled from your site — tweak it to taste."}
            />
          </p>
          {logo && (
            <p style={{ fontSize: 13, opacity: 0.75 }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data-dir upload, unoptimized preview */}
              <img src={logo} alt="Imported logo" style={{ height: 32, verticalAlign: "middle", marginRight: 8 }} />
              Logo imported from your site.
            </p>
          )}
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
        </Bubble>
      )}

      {step === "select-knowledge" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            <Typewriter text="Last step: which of these does your site have? I'll extract what you pick into your agent's knowledge." />
          </p>
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
        </Bubble>
      )}

      {step === "knowledge-running" && (
        <Bubble who="assistant">
          {status?.phase === "done" ? (
            <p style={{ margin: "0 0 12px" }}>
              All done — I saved <strong>{status.chunkCount ?? 0}</strong> knowledge chunks
              {status.report
                ? ` (${status.report.blog?.postsSaved ?? 0} blog posts, ${status.report.testimonials?.count ?? 0} testimonials, ${status.report.team?.blocks ?? 0} team bios).`
                : "."}
            </p>
          ) : (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 10px" }}>
                <Typewriter text="Extracting now. This can take a few minutes on a big site — you don't need to wait, I'll keep going in the background." />
              </p>
              <ActivityStream lines={status?.log ?? []} progress={status?.progress ?? 0} />
            </div>
          )}
          <button style={{ ...btn, marginTop: 10 }} onClick={() => router.push("/admin/dashboard")}>
            Continue to dashboard →
          </button>
        </Bubble>
      )}

      {status?.phase === "failed" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>{status.error || "Extraction failed."}</p>
          <button
            style={btnGhost}
            onClick={() => { setStep("ask-url"); setStatus(null); setJobId(null); }}
          >
            Try another URL or set up manually
          </button>
        </Bubble>
      )}

      {error && <p style={{ color: "var(--danger, #f66)" }}>{error}</p>}
      <div ref={endRef} />
    </div>
  );
}

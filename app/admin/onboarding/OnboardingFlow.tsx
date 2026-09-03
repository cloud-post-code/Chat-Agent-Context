"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { panel, field, btn, btnGhost } from "../ui";
import { BODY_FONT_OPTIONS } from "@/lib/fonts";
import { FormCard, type FieldSpec } from "./FormCard";

/**
 * Onboarding as a conversation: the assistant asks for the website link, then
 * walks through the stages one message at a time — contact info, theme, then
 * a pick-what-you-have knowledge extraction that keeps running while the user
 * heads to the dashboard. Each stage's extraction runs only when the chat
 * reaches it, so the first editable form appears seconds after the URL is in.
 *
 * The contact and theme reviews are the SAME component (FormCard) with
 * different field specs; extraction pre-fills each form before it is shown.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type Status = {
  phase: string; progress: number; error?: string;
  step1?: Record<string, unknown>; step2?: Record<string, unknown>;
  chunkCount?: number;
  report?: { blog?: { postsSaved: number }; testimonials?: { count: number }; team?: { blocks: number } };
};

type Step =
  | "ask-url" | "core-running" | "review-contact"
  | "theme-running" | "review-theme"
  | "select-knowledge" | "knowledge-running";

const CONTACT_FIELDS: FieldSpec[] = [
  { kind: "text", key: "company_name", label: "Company name" },
  { kind: "text", key: "owner_name", label: "Owner name" },
  { kind: "text", key: "company_address", label: "Company address" },
  { kind: "text", key: "company_phone_number", label: "Company phone number" },
  { kind: "text", key: "company_email", label: "Company email" },
  ...DAYS.map<FieldSpec>((d) => ({
    kind: "text", key: `hours_${d}`,
    label: `Hours — ${d[0].toUpperCase()}${d.slice(1)}`, placeholder: "closed",
  })),
];

const THEME_FIELDS: FieldSpec[] = [
  { kind: "select", key: "themeBodyFont", label: "Body font",
    options: BODY_FONT_OPTIONS.map((f) => ({ value: f.key, label: f.label })) },
  { kind: "select", key: "themeRadius", label: "Corners",
    options: ["sharp", "rounded", "pill"].map((r) => ({ value: r, label: r })) },
  { kind: "select", key: "themeHeadingWeight", label: "Heading weight",
    options: [{ value: "", label: "default" },
      ...["500", "600", "700", "800"].map((w) => ({ value: w, label: w }))] },
  { kind: "text", key: "color_bg", label: "Background color", placeholder: "#hex" },
  { kind: "text", key: "color_text", label: "Text color", placeholder: "#hex" },
  { kind: "text", key: "color_primary", label: "Brand color", placeholder: "#hex" },
];

const EXTRACTOR_OPTIONS = [
  { key: "blog", label: "Blog / news posts" },
  { key: "testimonials", label: "Testimonials / reviews" },
  { key: "team", label: "Team / about page" },
  { key: "sweep", label: "Everything else on the sitemap" },
];

const STAGE_LINES: Record<string, string[]> = {
  core: [
    "Core info agent: loading your homepage…",
    "Core info agent: reading your contact and about pages…",
    "Core info agent: looking for address, phone, email, and hours…",
  ],
  theme: [
    "Theme agent: reading your site's CSS…",
    "Theme agent: matching your fonts and colors to supported options…",
    "Theme agent: importing your logo…",
  ],
  blog: ["Blog agent: walking posts, archives, and the RSS feed…"],
  testimonials: ["Testimonials agent: collecting genuine customer quotes…"],
  team: ["Team agent: reading the bios on your about pages…"],
  sweep: ["Sitemap agent: sweeping remaining pages into knowledge…"],
};

function Bubble({ who, children }: { who: "assistant" | "user"; children: React.ReactNode }) {
  const mine = who === "user";
  return (
    <div style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
      <div
        style={{
          ...panel,
          maxWidth: 560,
          marginBottom: 14,
          ...(mine ? { background: "var(--primary)", color: "var(--on-primary, #fff)", border: "none" } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Progress({ stage, progress, rotIdx }: { stage: string; progress: number; rotIdx: number }) {
  const lines = STAGE_LINES[stage] ?? STAGE_LINES.core;
  return (
    <div aria-live="polite">
      <p style={{ margin: "0 0 10px", fontSize: 14 }}>{lines[rotIdx % lines.length]}</p>
      <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
        <div style={{ width: `${Math.max(progress, 3)}%`, height: "100%", background: "var(--primary)", transition: "width .6s" }} />
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
  const [contact, setContact] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState<Record<string, string>>({ themeBodyFont: "inter", themeRadius: "rounded" });
  const [logo, setLogo] = useState("");
  const [picked, setPicked] = useState<string[]>(EXTRACTOR_OPTIONS.map((o) => o.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rotIdx, setRotIdx] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  const running = step === "core-running" || step === "theme-running" || step === "knowledge-running";

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setRotIdx((i) => i + 1), 2200);
    return () => clearInterval(t);
  }, [running]);

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
        const hours = (p.company_hours ?? {}) as Record<string, string>;
        setContact({
          company_name: String(p.company_name ?? ""),
          owner_name: String(p.owner_name ?? ""),
          company_address: String(p.company_address ?? ""),
          company_phone_number: String(p.company_phone_number ?? ""),
          company_email: String(p.company_email ?? ""),
          ...Object.fromEntries(DAYS.map((d) => [`hours_${d}`, hours[d] ?? ""])),
        });
        setStep("review-contact");
      }
      if (step === "theme-running" && s.phase === "theme-done" && s.step2) {
        const t2 = s.step2 as Record<string, unknown>;
        const colors = (t2.themeColors ?? {}) as Record<string, string>;
        setTheme({
          themeBodyFont: String(t2.themeBodyFont ?? "inter"),
          themeRadius: String(t2.themeRadius ?? "rounded"),
          themeHeadingWeight: String(t2.themeHeadingWeight ?? ""),
          themeFontSize: String(t2.themeFontSize ?? ""),
          color_bg: colors.bg ?? "",
          color_text: colors.text ?? "",
          color_primary: colors.primary ?? "",
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
    const { jobId: id } = await res.json();
    setJobId(id);
    setStep("core-running");
  }

  async function saveContact() {
    setBusy(true);
    setError("");
    const profile = {
      company_name: contact.company_name ?? "",
      owner_name: contact.owner_name ?? "",
      company_address: contact.company_address ?? "",
      company_phone_number: contact.company_phone_number ?? "",
      company_email: contact.company_email ?? "",
      company_hours: Object.fromEntries(DAYS.map((d) => [d, contact[`hours_${d}`] ?? ""])),
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
    setBusy(true);
    setError("");
    const body = {
      theme: {
        themeBodyFont: theme.themeBodyFont,
        themeRadius: theme.themeRadius,
        themeHeadingWeight: theme.themeHeadingWeight ?? "",
        themeFontSize: theme.themeFontSize ?? "",
        themeColors: {
          ...(theme.color_bg ? { bg: theme.color_bg } : {}),
          ...(theme.color_text ? { text: theme.color_text } : {}),
          ...(theme.color_primary ? { primary: theme.color_primary } : {}),
        },
        themeLogo: logo,
      },
    };
    const res = await post("/api/admin/onboarding/save", body);
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

  const themePreview = (
    <div
      style={{
        background: theme.color_bg || "var(--bg)",
        color: theme.color_text || "inherit",
        border: "1px solid var(--border)",
        borderRadius: theme.themeRadius === "pill" ? 24 : theme.themeRadius === "sharp" ? 0 : 10,
        padding: 20, marginBottom: 16,
      }}
    >
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element -- data-dir upload, unoptimized preview
        <img src={logo} alt="logo" style={{ height: 36, marginBottom: 10 }} />
      )}
      <div style={{ fontWeight: Number(theme.themeHeadingWeight || 700), fontSize: "1.4em" }}>
        {contact.company_name || "Your company"}
      </div>
      <p style={{ opacity: 0.8, margin: "6px 0 12px" }}>This is how your public agent page will feel.</p>
      <span
        style={{
          background: theme.color_primary || "var(--primary)", color: "#fff",
          padding: "6px 14px", fontSize: 13,
          borderRadius: theme.themeRadius === "pill" ? 999 : theme.themeRadius === "sharp" ? 0 : 10,
        }}
      >
        Ask me anything
      </span>
    </div>
  );

  return (
    <div>
      <Bubble who="assistant">
        <p style={{ margin: 0 }}>
          Hi! I&apos;ll set up your agent page with you right here. First: what&apos;s your
          website link? I&apos;ll read it and fill everything in for you.
        </p>
        {step === "ask-url" && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                style={{ ...field, marginBottom: 0 }}
                placeholder="https://your-current-site.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && url.trim() && startExtraction()}
              />
              <button style={btn} onClick={startExtraction} disabled={!url.trim()}>
                Extract my site
              </button>
            </div>
            <button
              style={{ ...btnGhost, marginTop: 12 }}
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
          <p style={{ margin: "0 0 10px" }}>On it — extracting your contact info now.</p>
          <Progress stage="core" progress={status?.progress ?? 0} rotIdx={rotIdx} />
        </Bubble>
      )}

      {step === "review-contact" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            {manual
              ? "No problem — fill in your business details below."
              : "Here's what I found. Fix anything that's off, then hit Done."}
          </p>
          <FormCard
            fields={CONTACT_FIELDS}
            values={contact}
            onChange={(k, v) => setContact({ ...contact, [k]: v })}
            onDone={saveContact}
            doneLabel="Done — looks right"
            busy={busy}
          />
        </Bubble>
      )}

      {step === "theme-running" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 10px" }}>
            Saved. I&apos;ll now extract your theme — colors, fonts, corners, and logo.
          </p>
          <Progress stage="theme" progress={status?.progress ?? 0} rotIdx={rotIdx} />
        </Bubble>
      )}

      {step === "review-theme" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            {manual
              ? "Pick the look for your agent page."
              : "Here's the look I pulled from your site — tweak it to taste."}
          </p>
          <FormCard
            fields={THEME_FIELDS}
            values={theme}
            onChange={(k, v) => setTheme({ ...theme, [k]: v })}
            onDone={saveTheme}
            doneLabel="Done — use this theme"
            busy={busy}
          >
            {themePreview}
          </FormCard>
        </Bubble>
      )}

      {step === "select-knowledge" && (
        <Bubble who="assistant">
          <p style={{ margin: "0 0 12px" }}>
            Last step: which of these does your site have? I&apos;ll extract what you
            pick into your agent&apos;s knowledge.
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
                Extracting now. This can take a few minutes on a big site — you don&apos;t
                need to wait, I&apos;ll keep going in the background.
              </p>
              <Progress
                stage={status?.phase && STAGE_LINES[status.phase] ? status.phase : "blog"}
                progress={status?.progress ?? 0}
                rotIdx={rotIdx}
              />
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

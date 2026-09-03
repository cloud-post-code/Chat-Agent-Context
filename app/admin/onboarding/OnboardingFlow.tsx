"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { panel, field, btn, btnGhost, Label } from "../ui";
import { BODY_FONT_OPTIONS } from "@/lib/fonts";

/**
 * The three-step onboarding flow. Steps 1 and 2 are editable review forms —
 * extraction only pre-fills them, the user's corrections always win. Step 3
 * has no review surface at all: a progress bar while knowledge extraction
 * runs, then the count of chunks it saved.
 */

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

type Hours = Record<(typeof DAYS)[number], string>;
type Step1 = {
  company_name: string; owner_name: string; company_address: string;
  company_phone_number: string; company_email: string; company_hours: Hours;
};
type Step2 = {
  themeBodyFont: string; themeColors: Record<string, string>;
  themeRadius: string; themeFontSize: string; themeHeadingWeight: string; themeLogo: string;
};
type Status = {
  phase: string; progress: number; error?: string;
  step1?: Step1; step2?: Step2; chunkCount?: number;
  report?: { blog?: { postsSaved: number }; testimonials?: { count: number }; team?: { blocks: number } };
};

const emptyHours = (): Hours => Object.fromEntries(DAYS.map((d) => [d, ""])) as Hours;
const emptyStep1 = (): Step1 => ({
  company_name: "", owner_name: "", company_address: "",
  company_phone_number: "", company_email: "", company_hours: emptyHours(),
});
const emptyStep2 = (): Step2 => ({
  themeBodyFont: "inter", themeColors: {}, themeRadius: "rounded",
  themeFontSize: "", themeHeadingWeight: "", themeLogo: "",
});

/**
 * The extraction agents in the order the job runs them, for the rotating
 * status line. Mirrors the job's phase keys (a display concern only — the
 * API contract is untouched).
 */
const AGENTS = [
  { phase: "step1", name: "Core info agent", doing: "reading contact details, address, and opening hours" },
  { phase: "step2", name: "Theme agent", doing: "matching your colors, fonts, corners, and logo" },
  { phase: "blog", name: "Blog agent", doing: "walking posts, archives, and the RSS feed" },
  { phase: "testimonials", name: "Testimonials agent", doing: "collecting genuine customer quotes" },
  { phase: "team", name: "Team agent", doing: "reading the bios on your about pages" },
  { phase: "sweep", name: "Sitemap agent", doing: "sweeping remaining pages into knowledge" },
];

function agentLine(rotIdx: number, phase: string): string {
  const agent = AGENTS[rotIdx % AGENTS.length];
  const current = AGENTS.findIndex((a) => a.phase === phase);
  const idx = AGENTS.indexOf(agent);
  if (idx < current) return `${agent.name}: finished`;
  if (idx > current) return `${agent.name}: waiting its turn`;
  return `${agent.name}: ${agent.doing}…`;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "site" | "manual">("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [step1, setStep1] = useState<Step1>(emptyStep1());
  const [step2, setStep2] = useState<Step2>(emptyStep2());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rotIdx, setRotIdx] = useState(0);

  const extracting =
    mode === "site" && !!jobId && status?.phase !== "done" && status?.phase !== "failed";

  useEffect(() => {
    if (!extracting) return;
    const t = setInterval(() => setRotIdx((i) => i + 1), 2200);
    return () => clearInterval(t);
  }, [extracting]);

  useEffect(() => {
    if (!jobId) return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/admin/onboarding/status?jobId=${jobId}`);
      if (!res.ok) return;
      const s: Status = await res.json();
      setStatus(s);
      if (s.step1) setStep1((prev) => (prev.company_name || prev.company_email ? prev : s.step1!));
      if (s.step2) setStep2((prev) => (prev.themeLogo || prev.themeColors.primary ? prev : s.step2!));
      if (s.phase === "done" || s.phase === "failed") clearInterval(t);
    }, 1200);
    return () => clearInterval(t);
  }, [jobId]);

  async function start() {
    setError("");
    const res = await fetch("/api/admin/onboarding/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    const started = (await res.json()) as { jobId: string };
    setJobId(started.jobId);
    setMode("site");
    setStatus({ phase: "step1", progress: 0 });
  }

  async function saveAll() {
    setSaving(true);
    setError("");
    const save = await fetch("/api/admin/onboarding/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: step1, theme: step2 }),
    });
    if (!save.ok) {
      setError(await save.text());
      setSaving(false);
      return;
    }
    await fetch("/api/admin/onboarding/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode || "manual" }),
    });
    router.push("/admin/dashboard");
  }

  if (!mode) {
    return (
      <div style={panel}>
        <Label>Enter a link to an existing site</Label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            style={{ ...field, marginBottom: 0 }}
            placeholder="https://your-current-site.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button style={btn} onClick={start} disabled={!url.trim()}>
            Extract my site
          </button>
        </div>
        {error && <p style={{ color: "var(--danger, #f66)", marginTop: 10 }}>{error}</p>}
        <p style={{ margin: "18px 0 10px", opacity: 0.7 }}>No site to pull from?</p>
        <button style={btnGhost} onClick={() => setMode("manual")}>
          Set up manually
        </button>
      </div>
    );
  }

  const knowledgePhases = ["blog", "testimonials", "team", "sweep"];
  const inKnowledge = knowledgePhases.includes(status?.phase || "");

  return (
    <div>
      {extracting && (
        <div style={panel} aria-live="polite">
          <p style={{ margin: "0 0 10px", fontSize: 14 }}>
            {agentLine(rotIdx, status?.phase || "step1")}
          </p>
          <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.max(status?.progress ?? 0, 3)}%`, height: "100%",
                background: "var(--primary)", transition: "width .6s",
              }}
            />
          </div>
          <p style={{ fontSize: 13, opacity: 0.7, margin: "8px 0 0" }}>
            Extracting your site — the fields below fill in as each agent reports back.
          </p>
        </div>
      )}

      {status?.phase === "failed" && (
        <div style={{ ...panel, borderColor: "var(--danger, #f66)" }}>
          <p>{status.error || "Extraction failed."}</p>
          <button style={btnGhost} onClick={() => { setMode(""); setStatus(null); setJobId(null); }}>
            Try another URL or set up manually
          </button>
        </div>
      )}

      {/* During extraction the sections open in job order, each as its data
          lands; manual mode and the finished state show everything open. */}
      <details open={!extracting || !!status?.step1} style={panel}>
        <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 12 }}>
          Step 1 — Core information {extracting && !status?.step1 ? "(extracting…)" : ""}
        </summary>
        {(
          [
            ["company_name", "Company name"],
            ["owner_name", "Owner name"],
            ["company_address", "Company address"],
            ["company_phone_number", "Company phone number"],
            ["company_email", "Company email"],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <Label>{label}</Label>
            <input
              style={field}
              disabled={extracting}
              value={step1[key]}
              onChange={(e) => setStep1({ ...step1, [key]: e.target.value })}
            />
          </div>
        ))}
        <Label>Company hours</Label>
        {DAYS.map((d) => (
          <div key={d} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 96, textTransform: "capitalize", fontSize: 13 }}>{d}</span>
            <input
              style={{ ...field, marginBottom: 6 }}
              placeholder="closed"
              disabled={extracting}
              value={step1.company_hours[d]}
              onChange={(e) =>
                setStep1({ ...step1, company_hours: { ...step1.company_hours, [d]: e.target.value } })}
            />
          </div>
        ))}
      </details>

      <details open={!extracting || !!status?.step2} style={panel}>
        <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 12 }}>
          Step 2 — Theme {extracting && !status?.step2 ? "(extracting…)" : ""}
        </summary>
        <ThemePreview step1={step1} step2={step2} />
        <Label>Body font</Label>
        <select
          style={field}
          disabled={extracting}
          value={step2.themeBodyFont}
          onChange={(e) => setStep2({ ...step2, themeBodyFont: e.target.value })}
        >
          {BODY_FONT_OPTIONS.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <Label>Corners</Label>
        <select
          style={field}
          disabled={extracting}
          value={step2.themeRadius}
          onChange={(e) => setStep2({ ...step2, themeRadius: e.target.value })}
        >
          {["sharp", "rounded", "pill"].map((r) => <option key={r}>{r}</option>)}
        </select>
        {(["bg", "text", "primary"] as const).map((role) => (
          <div key={role}>
            <Label>{role === "bg" ? "Background" : role === "text" ? "Text" : "Brand color"}</Label>
            <input
              style={field}
              placeholder="#hex"
              disabled={extracting}
              value={step2.themeColors[role] || ""}
              onChange={(e) =>
                setStep2({ ...step2, themeColors: { ...step2.themeColors, [role]: e.target.value } })}
            />
          </div>
        ))}
        {step2.themeLogo && (
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            Logo imported: <code>{step2.themeLogo}</code>
          </p>
        )}
      </details>

      {mode === "site" && (
        <details open={inKnowledge || status?.phase === "done"} style={panel}>
          <summary style={{ cursor: "pointer", fontWeight: 700, marginBottom: 12 }}>
            Step 3 — Knowledge extraction
          </summary>
          {status?.phase === "done" ? (
            <p>
              Saved <strong>{status.chunkCount ?? 0}</strong> knowledge chunks
              {status.report
                ? ` (${status.report.blog?.postsSaved ?? 0} blog posts, ${status.report.testimonials?.count ?? 0} testimonials, ${status.report.team?.blocks ?? 0} team bios).`
                : "."}
            </p>
          ) : (
            <div>
              <div style={{ background: "var(--bg-soft)", borderRadius: 6, height: 10, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${status?.progress ?? 0}%`, height: "100%",
                    background: "var(--primary)", transition: "width .6s",
                  }}
                />
              </div>
              <p style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
                {inKnowledge ? `Extracting ${status?.phase}…` : "Reading your site…"}
              </p>
            </div>
          )}
        </details>
      )}

      <button
        style={btn}
        onClick={saveAll}
        disabled={saving || (mode === "site" && status?.phase !== "done" && status?.phase !== "failed")}
      >
        {saving ? "Saving…" : "Save and finish"}
      </button>
      {error && <p style={{ color: "var(--danger, #f66)", marginTop: 10 }}>{error}</p>}
    </div>
  );
}

/** A rough render of the public agent page with the working theme applied. */
function ThemePreview({ step1, step2 }: { step1: Step1; step2: Step2 }) {
  const c = step2.themeColors;
  const radius = step2.themeRadius === "pill" ? 24 : step2.themeRadius === "sharp" ? 0 : 10;
  return (
    <div
      style={{
        background: c.bg || "var(--bg)", color: c.text || "var(--on-bg, inherit)",
        border: "1px solid var(--border)", borderRadius: radius,
        padding: 20, marginBottom: 16,
        fontSize: step2.themeFontSize ? Number(step2.themeFontSize) : 15,
      }}
    >
      {step2.themeLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- data-dir upload, unoptimized preview
        <img src={step2.themeLogo} alt="logo" style={{ height: 36, marginBottom: 10 }} />
      )}
      <div style={{ fontWeight: Number(step2.themeHeadingWeight || 700), fontSize: "1.4em" }}>
        {step1.company_name || "Your company"}
      </div>
      <p style={{ opacity: 0.8, margin: "6px 0 12px" }}>
        This is how your public agent page will feel.
      </p>
      <span
        style={{
          background: c.primary || "var(--primary)", color: "#fff",
          padding: "6px 14px", borderRadius: radius >= 24 ? 999 : radius,
          fontSize: 13,
        }}
      >
        Ask me anything
      </span>
    </div>
  );
}

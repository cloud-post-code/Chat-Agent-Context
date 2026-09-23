"use client";

import { useEffect, useRef, useState } from "react";
import type { BulkBuild, BulkSite, SiteStatus } from "@/lib/bulkBuild";
import { SectionTitle, Label, btn, btnGhost, panel, stamp } from "./ui";
import { cf as field } from "@/app/cards/Cards";

/**
 * Operator-only bulk site builder (see docs/features/bulk-site-builder).
 * Pastes a list of links, starts one unattended build, and shows a live
 * table per site as the server runs the full onboarding pipeline against
 * each one with every stage auto-approved. Credentials only ever surface
 * here — the database keeps only the password hash.
 */

const POLL_MS = 2000;

const soft = (pct: number) => `color-mix(in srgb, var(--on-surface) ${pct}%, transparent)`;

const STATUS_TONE: Record<SiteStatus, { bg: number; label: string }> = {
  queued: { bg: 9, label: "Queued" },
  building: { bg: 16, label: "Building" },
  done: { bg: 9, label: "Done" },
  done_with_warnings: { bg: 16, label: "Done, warnings" },
  failed: { bg: 16, label: "Failed" },
};

function isUnfinished(build: BulkBuild): boolean {
  if (!build.finishedAt) return true;
  return build.sites.some((s) => s.status === "queued" || s.status === "building");
}

function toCsv(sites: BulkSite[]): string {
  const rows = sites
    .filter((s) => s.username)
    .map((s) => [s.url, s.username ?? "", s.password ?? "", s.slug ?? ""].join(","));
  return ["url,username,password,slug", ...rows].join("\n");
}

/** Polls every open build every 2s until it finishes; replaces it in state. */
function useBulkBuilds(initial: BulkBuild[]) {
  const [builds, setBuilds] = useState<BulkBuild[]>(initial);
  const buildsRef = useRef(builds);
  buildsRef.current = builds;

  useEffect(() => {
    const timer = setInterval(async () => {
      const open = buildsRef.current.filter(isUnfinished);
      if (open.length === 0) return;
      for (const b of open) {
        try {
          const res = await fetch(`/api/admin/bulk-build?buildId=${encodeURIComponent(b.id)}`);
          if (!res.ok) continue;
          const fresh: BulkBuild = await res.json();
          setBuilds((prev) => prev.map((p) => (p.id === fresh.id ? fresh : p)));
        } catch {
          // A dropped poll tries again on the next tick.
        }
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  function addBuild(build: BulkBuild) {
    setBuilds((prev) => [build, ...prev]);
  }

  return { builds, addBuild };
}

function counts(sites: BulkSite[]) {
  const c = { done: 0, warnings: 0, failed: 0, active: 0 };
  for (const s of sites) {
    if (s.status === "done") c.done++;
    else if (s.status === "done_with_warnings") c.warnings++;
    else if (s.status === "failed") c.failed++;
    else c.active++;
  }
  return c;
}

function StatusChip({ status }: { status: SiteStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      style={{
        fontSize: 10.5,
        padding: "1px 8px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        background: soft(tone.bg),
        border: `1px solid ${soft(tone.bg + 10)}`,
      }}
    >
      {tone.label}
    </span>
  );
}

function CopyCredentials({ sites }: { sites: BulkSite[] }) {
  const [showFallback, setShowFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const csv = toCsv(sites);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API needs a secure context and permission; fall the
      // operator through to the raw CSV rather than failing silently.
      setShowFallback(true);
    }
  };

  return (
    <div>
      <button type="button" onClick={copy} style={btnGhost}>
        {copied ? "Copied." : "Copy credentials"}
      </button>
      {showFallback && (
        <textarea
          readOnly
          value={csv}
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...field, marginTop: 8, height: 100, fontFamily: "monospace", fontSize: 12 }}
        />
      )}
    </div>
  );
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function SiteRow({ site }: { site: BulkSite }) {
  return (
    <tr className="bb-row">
      <td style={{ minWidth: 140, maxWidth: 260, overflowWrap: "break-word" }} title={site.url}>
        {site.url.replace(/^https?:\/\/(www\.)?/, "")}
      </td>
      <td>
        <StatusChip status={site.status} />
      </td>
      <td className="bb-hide-sm">{site.stage ?? ""}</td>
      <td className="bb-hide-sm">{site.name ?? ""}</td>
      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{site.username ?? ""}</td>
      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{site.password ?? ""}</td>
      <td className="bb-hide-sm">
        {site.slug && (
          <a href={`/a/${site.slug}`} target="_blank" rel="noreferrer">
            /a/{site.slug}
          </a>
        )}
      </td>
      <td className="bb-hide-sm" title={site.lastLine}>
        {truncate(site.lastLine, 40)}
      </td>
      <td
        className="bb-hide-sm"
        title={site.warnings.length ? site.warnings.join("\n") : undefined}
      >
        {site.warnings.length > 0
          ? `${site.warnings.length} warning${site.warnings.length === 1 ? "" : "s"}`
          : ""}
      </td>
      <td className="bb-hide-sm" style={{ color: "var(--danger-on-surface)" }}>
        {site.error ?? ""}
      </td>
    </tr>
  );
}

function BuildCard({ build }: { build: BulkBuild }) {
  const c = counts(build.sites);
  return (
    <div
      style={{
        border: `1px solid ${soft(16)}`,
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 10, flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13 }}>
          <strong>{stamp(new Date(build.createdAt))}</strong>
          <span style={{ marginLeft: 10, color: soft(75) }}>
            {c.done} done · {c.warnings} with warnings · {c.failed} failed
            {c.active > 0 ? ` · ${c.active} queued/building` : ""}
          </span>
        </div>
        <CopyCredentials sites={build.sites} />
      </div>
      {build.dropped.length > 0 && (
        <p style={{ fontSize: 12, fontStyle: "italic", color: soft(75), marginTop: 6 }}>
          Dropped {build.dropped.length} invalid link{build.dropped.length === 1 ? "" : "s"}:{" "}
          {build.dropped.join(", ")}
        </p>
      )}
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="bb-table">
          <thead>
            <tr>
              <th>URL</th>
              <th>Status</th>
              <th className="bb-hide-sm">Stage</th>
              <th className="bb-hide-sm">Company</th>
              <th>Username</th>
              <th>Password</th>
              <th className="bb-hide-sm">Page</th>
              <th className="bb-hide-sm">Last activity</th>
              <th className="bb-hide-sm">Warnings</th>
              <th className="bb-hide-sm">Error</th>
            </tr>
          </thead>
          <tbody>
            {build.sites.map((s) => (
              <SiteRow key={s.url} site={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const CSS = `
  .bb-panel button { cursor: pointer; transition: opacity .12s ease; }
  .bb-panel button:hover:not(:disabled) { opacity: .8; }
  .bb-panel button:disabled { opacity: .5; cursor: default; }
  .bb-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .bb-table th {
    text-align: left; font-size: 10.5px; font-weight: 600; text-transform: uppercase;
    letter-spacing: .05em; padding: 6px 8px; white-space: nowrap;
    color: color-mix(in srgb, var(--on-surface) 65%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--on-surface) 22%, transparent);
  }
  .bb-table td {
    padding: 7px 8px; vertical-align: middle;
    border-bottom: 1px solid color-mix(in srgb, var(--on-surface) 12%, transparent);
  }
  @media (max-width: 860px) { .bb-hide-sm { display: none; } }
`;

export function BulkBuilderPanel({ builds: initialBuilds }: { builds: BulkBuild[] }) {
  const { builds, addBuild } = useBulkBuilds(initialBuilds);
  const [links, setLinks] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    setDropped([]);
    try {
      const res = await fetch("/api/admin/bulk-build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "The build couldn't start — try again.");
        setDropped(body?.dropped ?? []);
        return;
      }
      addBuild(body.build as BulkBuild);
      setLinks("");
    } catch {
      setError("The connection dropped before the build could start.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section data-fill="surface" style={panel} className="bb-panel">
      <style>{CSS}</style>
      <SectionTitle>Bulk builder</SectionTitle>
      <p style={{ fontSize: 13, color: soft(80), marginBottom: 14 }}>
        Paste business website links to build a tenant account for each one — every onboarding
        stage runs and is auto-approved with no review. Passwords are shown only here, once; the
        database only ever stores the hash.
      </p>

      <Label>Links, one per line</Label>
      <textarea
        value={links}
        onChange={(e) => setLinks(e.target.value)}
        placeholder={"https://example.com\nhttps://another-business.com"}
        style={{ ...field, height: 120, fontFamily: "monospace", fontSize: 13 }}
      />
      <button
        type="button"
        onClick={submit}
        disabled={submitting || links.trim().length === 0}
        style={btn}
      >
        {submitting ? "Starting…" : "Build sites"}
      </button>
      {error && (
        <div style={{ marginTop: 8 }}>
          <p style={{ fontSize: 13, color: "var(--danger-on-surface)" }}>{error}</p>
          {dropped.length > 0 && (
            <p style={{ fontSize: 12, fontStyle: "italic", color: soft(75) }}>
              Dropped: {dropped.join(", ")}
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        {builds.length === 0 ? (
          <p style={{ fontSize: 13, fontStyle: "italic", color: soft(75) }}>No builds yet.</p>
        ) : (
          builds.map((b) => <BuildCard key={b.id} build={b} />)
        )}
      </div>
    </section>
  );
}

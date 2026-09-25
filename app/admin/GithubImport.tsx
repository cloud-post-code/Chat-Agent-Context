"use client";

import { useState } from "react";
import { readNdjson } from "@/lib/client/ndjson";
import { useRouter } from "next/navigation";
import { field, btn } from "./ui";

type ImportedProject = {
  id: string;
  name: string;
  blurb: string;
  detail: string;
  tags: string[];
  githubUrl: string | null;
  liveUrl: string | null;
  stars: number;
  status: "new" | "updated";
};

type Status =
  | { kind: "idle" }
  | { kind: "running"; total: number | null; skipped: number }
  | { kind: "done"; total: number; skipped: number }
  | { kind: "error"; message: string };

function summarize(imported: ImportedProject[], skipped: number): string {
  const added = imported.filter((p) => p.status === "new").length;
  const updated = imported.filter((p) => p.status === "updated").length;
  const parts = [];
  if (added) parts.push(`imported ${added} new`);
  if (updated) parts.push(`updated ${updated} changed`);
  if (skipped) parts.push(`${skipped} unchanged`);
  const s = parts.join(", ") || "nothing to do";
  return s.charAt(0).toUpperCase() + s.slice(1) + ".";
}

/**
 * GitHub import with live streaming: posts to /api/admin/import-github and
 * renders each project card the moment its line arrives, enrichment and all.
 */
export function GithubImport() {
  const router = useRouter();
  const [profile, setProfile] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [imported, setImported] = useState<ImportedProject[]>([]);

  const running = status.kind === "running";

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    if (running || !profile.trim()) return;
    setImported([]);
    setStatus({ kind: "running", total: null, skipped: 0 });

    let total = 0;
    let skipped = 0;
    try {
      const res = await fetch("/api/admin/import-github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      if (!res.ok || !res.body) throw new Error(`Import failed (${res.status}).`);

      await readNdjson<{ t: string; v?: unknown; total?: number; skipped?: number }>(res.body, (msg) => {
        if (msg.t === "start") {
          total = msg.total ?? 0;
          skipped = msg.skipped ?? 0;
          setStatus({ kind: "running", total, skipped });
        } else if (msg.t === "project") {
          setImported((prev) => [...prev, msg.v as ImportedProject]);
        } else if (msg.t === "error") {
          throw new Error(String(msg.v));
        }
      });
      setStatus({ kind: "done", total, skipped });
      // Refresh the server-rendered project list below so it includes the new rows.
      router.refresh();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : "Import failed." });
    }
  }

  return (
    <div>
      <form onSubmit={runImport} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          name="profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="https://github.com/your-username"
          required
          disabled={running}
          style={{ ...field, marginBottom: 0, flex: 1, minWidth: 240 }}
        />
        <button style={{ ...btn, opacity: running ? 0.6 : 1 }} disabled={running}>
          {running ? "Importing…" : "Import repos"}
        </button>
      </form>

      {status.kind !== "idle" && (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginTop: 10 }} aria-live="polite">
          {status.kind === "running" &&
            (status.total === null
              ? "Fetching repos from GitHub…"
              : `Enriching ${imported.length}/${status.total} projects with Claude…` +
                (status.skipped ? ` (${status.skipped} unchanged, skipped)` : ""))}
          {status.kind === "done" &&
            (status.total === 0
              ? `Nothing to do${status.skipped ? ` — all ${status.skipped} imported repos are unchanged on GitHub` : ""}.`
              : summarize(imported, status.skipped))}
          {status.kind === "error" && <span style={{ color: "var(--danger-on-surface)" }}>{status.message}</span>}
        </p>
      )}

      {imported.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {imported.map((p) => (
            <div
              key={p.id}
              data-fill="bg-soft"
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                padding: "10px 12px",
                background: "var(--bg-soft)",
                color: "var(--on-bg-soft)",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 14 }}>{p.name}</strong>
                {p.stars > 0 && (
                  <span style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 12 }}>★ {p.stars}</span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 8px",
                    borderRadius: "var(--radius-pill)",
                    background: "var(--primary)",
                    color: "var(--on-primary)",
                    fontWeight: 600,
                  }}
                >
                  {p.status === "updated" ? "updated" : "new"}
                </span>
              </div>
              <p style={{ fontSize: 13, marginTop: 2 }}>{p.blurb}</p>
              {p.detail && (
                <p style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 13, marginTop: 4 }}>{p.detail}</p>
              )}
              {p.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {p.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: "var(--radius-pill)",
                        border: "1px solid var(--border)",
                        color: "var(--on-bg-soft)",
                        fontStyle: "italic",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

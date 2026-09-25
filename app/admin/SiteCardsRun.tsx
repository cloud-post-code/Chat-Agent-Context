"use client";

import { useState } from "react";
import { readNdjson } from "@/lib/client/ndjson";
import { useRouter } from "next/navigation";
import type { SiteCardsEvent, SiteCardsReport } from "@/lib/siteCards";
import { btnGhost } from "./ui";

/**
 * The A2UI tab's "Build cards from my site" control: runs the site-cards
 * agent (lib/siteCards.ts) over /api/admin/site-cards and shows its work as
 * it happens — each visitor need it found on the imported site, then each
 * card as it lands. The run only ever adds cards; when it finishes the panel's
 * rows are refreshed so the new ones appear in the list below.
 */

type WireEvent = SiteCardsEvent | { t: "done"; report: SiteCardsReport } | { t: "error"; v: string };
type Line = { kind: "status" | "need" | "card" | "error" | "outcome"; text: string; sub?: string };

function outcome(r: SiteCardsReport): string {
  if (r.noSite) return "There's no imported site to read yet — add your site under Sources, then run this again.";
  if (!r.written && !r.designedFailed) {
    return "Nothing new to add — your cards already cover what the site offers.";
  }
  const built = r.cards.map((c) => c.label).join(", ");
  const failed = r.designedFailed
    ? ` ${r.designedFailed} card${r.designedFailed === 1 ? "" : "s"} couldn't be built — try again, or build by hand.`
    : "";
  return (r.written ? `Built ${r.written} card${r.written === 1 ? "" : "s"}: ${built}.` : "") + failed;
}

function toLine(e: WireEvent): Line {
  if (e.t === "need") return { kind: "need", text: e.need, sub: `${e.label}${e.evidence ? ` · from ${e.evidence}` : ""}` };
  if (e.t === "card") return { kind: "card", text: `Card ready: ${e.label}` };
  if (e.t === "done") return { kind: "outcome", text: outcome(e.report) };
  if (e.t === "error") return { kind: "error", text: e.v };
  return { kind: "status", text: e.v };
}

const readEvents = (body: ReadableStream<Uint8Array>, onEvent: (e: WireEvent) => void) =>
  readNdjson<WireEvent>(body, onEvent);

export function useSiteCardsRun() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);

  async function run() {
    if (running) return;
    setRunning(true);
    setLines([]);
    const push = (l: Line) => setLines((s) => [...s, l]);
    try {
      const res = await fetch("/api/admin/site-cards", { method: "POST" });
      if (!res.ok || !res.body) {
        push({ kind: "error", text: (await res.text()) || "The run couldn't start — try again." });
        return;
      }
      await readEvents(res.body, (e) => push(toLine(e)));
    } catch {
      push({ kind: "error", text: "The connection dropped. Any cards already built are saved." });
    } finally {
      setRunning(false);
      // New rows come from the server component above this panel.
      router.refresh();
    }
  }

  return { running, lines, run };
}

export function SiteCardsButton({ running, onRun }: { running: boolean; onRun: () => void }) {
  return (
    <button
      type="button"
      onClick={onRun}
      disabled={running}
      aria-busy={running}
      style={{ ...(btnGhost as React.CSSProperties), opacity: running ? 0.7 : 1, cursor: running ? "wait" : "pointer" }}
    >
      {running ? "Reading your site…" : "Build cards from my site"}
    </button>
  );
}

const MARK: Record<Line["kind"], string> = { status: "·", need: "◆", card: "✓", error: "!", outcome: "→" };

export function SiteCardsLog({ lines, running }: { lines: Line[]; running: boolean }) {
  if (!lines.length && !running) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-soft)",
        color: "var(--on-bg-soft)",
        padding: "10px 12px",
        marginBottom: 14,
        fontSize: 13,
      }}
    >
      {lines.map((l, i) => (
        <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0", fontWeight: l.kind === "outcome" ? 600 : 400 }}>
          <span aria-hidden style={{ width: 12, flexShrink: 0 }}>{MARK[l.kind]}</span>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {l.kind === "need" ? <>Need: {l.text}</> : l.text}
            {l.sub && <span style={{ display: "block", fontSize: 12, opacity: 0.75 }}>{l.sub}</span>}
          </span>
        </div>
      ))}
      {running && <div style={{ fontStyle: "italic", opacity: 0.75, paddingTop: 2 }}>Working…</div>}
    </div>
  );
}

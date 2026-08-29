"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Cards } from "@/app/cards/Cards";
import { parseSampleBlock, type UiCardRow } from "@/lib/uiCards";
import { deleteCard } from "./actions";
import { PendingButton } from "./PendingButton";
import { panel, field, btn, btnGhost, btnDanger, SectionTitle } from "./ui";

/**
 * The A2UI tab: the card catalog, one database row per card the chatbot can
 * draw. Each row stores the card's name, tool, when the agent should show it,
 * and a sample payload — rendered as a preview by the same Cards component the
 * chat uses, so the preview shows what the card looks like, not what the
 * site's data says. The starter set is seeded once; rows are editable,
 * addable and deletable from here.
 *
 * Collapsed by default, and only one card open at a time: clicking a heading
 * draws that card and puts away whichever was open, so the tab stays the
 * height of the list plus one preview.
 */

type SortKey = "default" | "tool-asc" | "tool-desc";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Default order" },
  { key: "tool-asc", label: "Tool A–Z" },
  { key: "tool-desc", label: "Tool Z–A" },
];

const anchorId = (key: string) => `a2ui-${key}`;

export function A2uiPanel({ rows, slug }: { rows: UiCardRow[]; slug: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("default");
  // One card open at a time: opening a card closes the previous one.
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (r) =>
        !q ||
        r.label.toLowerCase().includes(q) ||
        r.tool.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q),
    );
    if (sort === "default") return filtered;
    const dir = sort === "tool-asc" ? 1 : -1;
    // Tie-break on label so rows sharing a tool hold a stable order.
    return [...filtered].sort(
      (a, b) => dir * (a.tool.localeCompare(b.tool) || a.label.localeCompare(b.label)),
    );
  }, [rows, query, sort]);

  const isOpen = (id: string) => openId === id;

  function toggle(id: string) {
    setOpenId((o) => (o === id ? null : id));
  }

  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>A2UI cards</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 14 }}>
        The cards the chatbot can show in a conversation. These entries are
        live wiring: &ldquo;when the agent should show it&rdquo; goes into the
        chatbot&apos;s instructions, and deleting a card takes it away from the
        chatbot entirely. Deleting every card restores the starter set. Pick a
        card to draw its preview — built-in cards preview a stored sample and
        use your live data in chat; custom-built cards show exactly what you
        saved.
      </p>

      {/* ── Toolbar: search, sort, add ── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search cards — name, tool, or when it's shown…"
          aria-label="Search cards"
          style={{ ...field, marginBottom: 0, flex: 1, minWidth: 220 }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort cards"
          style={{ ...field, marginBottom: 0, width: "auto" }}
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <Link href="/admin/cards/new" style={{ ...(btn as React.CSSProperties), textDecoration: "none" }}>
          + Build a card
        </Link>
      </div>

      {visible.length === 0 && (
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14 }}>
          {rows.length === 0
            ? "No cards yet. Add one above — the starter set only seeds an empty table once."
            : "No card matches that search."}
        </p>
      )}

      {visible.map((r, i) => (
        <div
          key={r.id}
          id={anchorId(r.key)}
          style={{
            marginBottom: i === visible.length - 1 ? 0 : isOpen(r.id) ? 26 : 10,
            scrollMarginTop: 12,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => toggle(r.id)}
              aria-expanded={isOpen(r.id)}
              aria-controls={`${anchorId(r.key)}-body`}
              style={rowToggle}
            >
              <span aria-hidden style={{ fontSize: 11, opacity: 0.7 }}>
                {isOpen(r.id) ? "▾" : "▸"}
              </span>
              <strong style={{ fontSize: 14 }}>{r.label}</strong>
              <code style={toolName}>{r.tool}</code>
              <span style={{ fontSize: 13, fontWeight: 400 }}>{r.description}</span>
            </button>
            <form action={deleteCard} style={{ marginLeft: "auto" }}>
              <input type="hidden" name="id" value={r.id} />
              <PendingButton
                pendingLabel="Deleting…"
                aria-label={`Delete the ${r.label} card`}
                style={btnDanger as React.CSSProperties}
              >
                Delete
              </PendingButton>
            </form>
          </div>
          {isOpen(r.id) && (
            <div id={`${anchorId(r.key)}-body`}>
              {r.note && (
                <p style={{ fontSize: 12, fontStyle: "italic", color: "var(--accent-on-surface)", margin: "6px 0 0" }}>
                  {r.note}
                </p>
              )}
              <CardPreview raw={r.sampleBlock} slug={slug} />
              <Link
                href={`/admin/cards/${r.id}`}
                style={{ ...(btnGhost as React.CSSProperties), display: "inline-block", marginTop: 12, textDecoration: "none" }}
              >
                Refine this card →
              </Link>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

function CardPreview({ raw, slug }: { raw: string; slug: string }) {
  const block = parseSampleBlock(raw);
  if (!block) {
    return (
      <p style={{ fontSize: 13, fontStyle: "italic", color: "var(--danger-on-surface)", margin: "8px 0 0" }}>
        The sample block isn&apos;t valid card JSON, so there&apos;s no preview. Fix it
        under &ldquo;Edit this card&rdquo;.
      </p>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      <Cards block={block} slug={slug} />
    </div>
  );
}

/** The whole heading is the disclosure control, so the hit target is the row. */
const rowToggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  flex: 1,
  minWidth: 0,
  padding: "6px 0",
  background: "none",
  border: "none",
  color: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const toolName: React.CSSProperties = {
  fontSize: 12,
  padding: "3px 8px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-soft)",
  color: "var(--on-bg-soft)",
};

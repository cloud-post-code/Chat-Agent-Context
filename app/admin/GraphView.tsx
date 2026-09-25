"use client";

import { useState } from "react";
import { ENTITY_TYPES_LIST } from "@/lib/retrieval/entityTypes";
import type { GraphEntity, GraphEdge, MergeSuggestion } from "@/lib/retrieval/graph";
import { saveEntity, removeEntity, createEntityEdge, removeEntityEdge, mergeSuggestedEntities, dismissSuggestedMerge } from "@/app/admin/actions/graph";
import { PendingButton } from "./PendingButton";
import { field, btn, btnGhost, btnDanger, Label } from "./ui";

/**
 * The graph's editing lists: paginated Entities and Relations panes, mounted
 * as sub-tabs of the Graph section (GraphPanel). The rendered node-link
 * picture lives on the Graph sub-tab (GraphCanvas), where structural faults a
 * list hides stay obvious — a hub every edge runs through, a cluster with no
 * link to the person the site is about, a duplicate sitting beside its twin.
 */

const PAGE_SIZE = 20;

// ── Entities ────────────────────────────────────────────────────────────────

export function EntitiesPane({
  entities,
  suggestions,
}: {
  entities: GraphEntity[];
  suggestions: MergeSuggestion[];
}) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? entities.filter((e) => e.name.toLowerCase().includes(q) || e.type.toLowerCase().includes(q))
    : entities;
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      {suggestions.length > 0 && <SuggestedMerges suggestions={suggestions} />}
      <Label>Rename to correct, or rename onto another entity to merge the two</Label>
      {entities.length === 0 ? (
        <p style={hint}>Nothing extracted yet. Add a source on the Knowledge tab.</p>
      ) : (
        <>
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Search entities by name or type…"
          />
          {filtered.length === 0 ? (
            <p style={hint}>No entities match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {shown.map((e) => (
                  <EntityRow key={e.id} entity={e} />
                ))}
              </div>
              <Pager page={page} total={filtered.length} onPage={setPage} noun="entities" />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Duplicate pairs the graph itself suggests (lib/retrieval/graph.ts
 * suggestedMerges). Merge runs the same merge renaming onto an existing name
 * does; Don't merge persists a dismissal so the pair is never suggested again.
 */
function SuggestedMerges({ suggestions }: { suggestions: MergeSuggestion[] }) {
  return (
    <div
      style={{
        border: "1px solid var(--accent-on-surface)",
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
        marginBottom: 14,
      }}
    >
      <Label>Suggested merges — pairs that look like the same thing twice</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {suggestions.map((s) => (
          <div key={`${s.fromId}:${s.intoId}`} style={edgeRow}>
            <span style={{ fontSize: 13, minWidth: 0 }}>
              Merge <strong>{s.fromName}</strong> into <strong>{s.intoName}</strong>{" "}
              <span style={{ fontStyle: "italic", color: "var(--accent-on-surface)" }}>
                — {s.reason}
              </span>
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <form action={mergeSuggestedEntities}>
                <input type="hidden" name="fromId" value={s.fromId} />
                <input type="hidden" name="intoId" value={s.intoId} />
                <PendingButton pendingLabel="Merging…" style={{ ...btnGhost, padding: "3px 9px", fontSize: 12 }}>
                  Merge
                </PendingButton>
              </form>
              <form action={dismissSuggestedMerge}>
                <input type="hidden" name="fromId" value={s.fromId} />
                <input type="hidden" name="intoId" value={s.intoId} />
                <PendingButton pendingLabel="Dismissing…" style={{ ...btnGhost, padding: "3px 9px", fontSize: 12 }}>
                  Don&apos;t merge
                </PendingButton>
              </form>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityRow({ entity }: { entity: GraphEntity }) {
  const orphan = entity.mentions === 0;
  return (
    <div
      style={{
        border: `1px solid ${orphan ? "var(--danger-on-surface)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)",
        padding: "10px 12px",
      }}
    >
      <form action={saveEntity} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="hidden" name="id" value={entity.id} />
        <input name="name" defaultValue={entity.name} style={{ ...field, marginBottom: 0, flex: 1, minWidth: 160 }} />
        <select name="type" defaultValue={entity.type} style={{ ...field, marginBottom: 0, maxWidth: 130 }}>
          {ENTITY_TYPES_LIST.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <PendingButton pendingLabel="Saving…" style={{ ...btnGhost, padding: "6px 12px" }}>
          Save
        </PendingButton>
        {/* Shares the form's hidden id; formAction routes it to the delete action. */}
        <PendingButton
          pendingLabel="Deleting…"
          formAction={removeEntity}
          style={{ ...btnDanger, padding: "6px 12px" }}
        >
          Delete
        </PendingButton>
      </form>

      <div style={{ fontSize: 11, color: "var(--on-surface)", fontStyle: "italic", marginTop: 6 }}>
        {orphan ? (
          <span style={{ color: "var(--danger-on-surface)", fontStyle: "normal" }}>
            Orphan — mentioned in no chunk, so the chatbot can never reach it. Safe to delete.
          </span>
        ) : (
          <>
            {entity.mentions} mention{entity.mentions === 1 ? "" : "s"} · {entity.edges} relation
            {entity.edges === 1 ? "" : "s"}
            {entity.sources.length > 0 && ` · from ${entity.sources.join(", ")}`}
          </>
        )}
      </div>
    </div>
  );
}

// ── Relations ───────────────────────────────────────────────────────────────

export function RelationsPane({ entities, edges }: { entities: GraphEntity[]; edges: GraphEdge[] }) {
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? edges.filter(
        (e) =>
          e.fromName.toLowerCase().includes(q) ||
          e.relation.toLowerCase().includes(q) ||
          e.toName.toLowerCase().includes(q),
      )
    : edges;
  const shown = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div>
      {edges.length === 0 ? (
        <p style={hint}>No relations extracted yet.</p>
      ) : (
        <>
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            placeholder="Search by entity or relation…"
          />
          {filtered.length === 0 ? (
            <p style={hint}>No relations match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {shown.map((e) => (
                  <div key={e.id} style={edgeRow}>
                    <span style={{ fontSize: 13, minWidth: 0 }}>
                      <strong>{e.fromName}</strong>{" "}
                      <span style={{ fontStyle: "italic", color: "var(--accent-on-surface)" }}>{e.relation}</span>{" "}
                      → <strong>{e.toName}</strong>
                    </span>
                    <form action={removeEntityEdge}>
                      <input type="hidden" name="id" value={e.id} />
                      <PendingButton pendingLabel="Deleting…" style={{ ...btnDanger, padding: "3px 9px", fontSize: 12 }}>
                        Delete
                      </PendingButton>
                    </form>
                  </div>
                ))}
              </div>
              <Pager page={page} total={filtered.length} onPage={setPage} noun="relations" />
            </>
          )}
        </>
      )}

      {entities.length >= 2 && (
        <form
          action={createEntityEdge}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}
        >
          <select name="fromId" style={{ ...field, marginBottom: 0, maxWidth: 200 }}>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <input name="relation" placeholder="works at, built, uses…" required style={{ ...field, marginBottom: 0, maxWidth: 190 }} />
          <select name="toId" style={{ ...field, marginBottom: 0, maxWidth: 200 }}>
            {[...entities].reverse().map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <PendingButton pendingLabel="Adding…" style={btn}>
            Add relation
          </PendingButton>
        </form>
      )}
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────────

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      style={{ ...field, marginBottom: 12, maxWidth: 320 }}
    />
  );
}

function Pager({
  page,
  total,
  onPage,
  noun,
}: {
  page: number;
  total: number;
  onPage: (p: number) => void;
  noun: string;
}) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page === 0}
        style={{ ...btnGhost, padding: "5px 12px", opacity: page === 0 ? 0.4 : 1 }}
      >
        ← Prev
      </button>
      <span style={{ fontSize: 12, fontStyle: "italic" }}>
        {from}–{to} of {total} {noun}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pages - 1}
        style={{ ...btnGhost, padding: "5px 12px", opacity: page >= pages - 1 ? 0.4 : 1 }}
      >
        Next →
      </button>
    </div>
  );
}

// No colour override on the danger variant: the sub-tab's own background swaps
// between --primary and transparent, and a fixed danger colour can vanish
// against either on some palettes. The glyph carries the warning by itself.
export function Count({ n, danger }: { n: number; danger?: boolean }) {
  return (
    <span
      style={{ fontSize: 11, opacity: 0.75, fontWeight: 700 }}
      title={danger ? `${n} suggested merge${n === 1 ? "" : "s"}` : undefined}
    >
      {danger ? `⚠ ${n}` : n}
    </span>
  );
}

const hint: React.CSSProperties = {
  color: "var(--on-surface)",
  fontStyle: "italic",
  fontSize: 13,
  marginBottom: 14,
};
const edgeRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "6px 12px",
};

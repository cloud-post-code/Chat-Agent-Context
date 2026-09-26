import type { DirectiveRow } from "@/lib/directives";

/**
 * The element registry behind the copilot's show_elements tool: each list
 * panel of the dashboard is split into addressable elements (one goal, one
 * rule, one preset) that carry flat, filterable facets. Everything here is
 * pure — the brain filters the index it loads, the panel side renders one node
 * per element from the same rows, and both agree because both call the same
 * builders on the same rows. Imports only type-level modules so offline
 * proofs can exercise it.
 */

export type FacetValue = string | number;

export type ElementMeta = {
  /** The underlying row's id — the same key the panel side renders under. */
  id: string;
  panel: string;
  /** Short human label, as the chat bubble names it. */
  label: string;
  facets: Record<string, FacetValue>;
};

export type FilterOp = "is" | "contains" | "before" | "after" | "gte" | "lte";
export const FILTER_OPS: readonly FilterOp[] = ["is", "contains", "before", "after", "gte", "lte"];

export type ElementFilter = { facet: string; op: FilterOp; value: string };

export type ElementSelection = {
  panel: string;
  /** Explicit picks from the index; kept in index order, unknown ids dropped. */
  ids?: string[];
  /** ANDed together. */
  where?: ElementFilter[];
  limit?: number;
};

/** The panels that have elements, with the facets each carries. */
export const ELEMENT_PANELS: Readonly<Record<string, readonly string[]>> = {
  goals: ["text", "live"],
  rules: ["text", "live"],
  answers: ["question", "label", "live", "served", "draft", "answered"],
};

/** What the element panels are built from — the rows the dashboard already loads. */
export type CannedLike = {
  id: string;
  question: string;
  label: string;
  answer: string;
  cardTool: string | null;
  cardInput: string | null;
  enabled: boolean;
  hits: number;
  order: number;
  aiDraft: boolean;
};

export type ElementData = {
  goals: DirectiveRow[];
  rules: DirectiveRow[];
  canned: CannedLike[];
};

// ── Builders ────────────────────────────────────────────────────────────────

const low = (s: string) => s.trim().toLowerCase();
const yn = (b: boolean) => (b ? "yes" : "no");
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function directiveElement(r: DirectiveRow, panel: "goals" | "rules"): ElementMeta {
  return { id: r.id, panel, label: clip(r.text), facets: { text: low(r.text), live: yn(r.enabled) } };
}

export function cannedElement(r: CannedLike): ElementMeta {
  return {
    id: r.id,
    panel: "answers",
    label: clip(r.question),
    facets: {
      question: low(r.question),
      label: low(r.label),
      live: yn(r.enabled),
      served: r.hits,
      draft: yn(r.aiDraft && r.answer.trim().length > 0),
      answered: yn(r.answer.trim().length > 0),
    },
  };
}

/** The whole index for one tenant, panel by panel, in each panel's own row order. */
export function buildElementIndex(d: ElementData): ElementMeta[] {
  return [
    ...d.goals.map((r) => directiveElement(r, "goals")),
    ...d.rules.map((r) => directiveElement(r, "rules")),
    ...d.canned.map(cannedElement),
  ];
}

// ── Selection ───────────────────────────────────────────────────────────────

function matches(v: FacetValue | undefined, f: ElementFilter): boolean {
  if (v === undefined) return false;
  const want = f.value.trim().toLowerCase();
  const have = String(v).trim().toLowerCase();
  const bothNumeric = typeof v === "number" && want !== "" && !Number.isNaN(Number(want));
  switch (f.op) {
    case "is":
      return bothNumeric ? v === Number(want) : have === want;
    case "contains":
      return have.includes(want);
    case "before":
      return bothNumeric ? v < Number(want) : have < want;
    case "after":
      return bothNumeric ? v > Number(want) : have > want;
    case "gte":
      return bothNumeric ? v >= Number(want) : have >= want;
    case "lte":
      return bothNumeric ? v <= Number(want) : have <= want;
    default:
      return false;
  }
}

/** Deterministic filtering of the index: panel, then ids, then every filter, then limit. */
export function selectElements(index: ElementMeta[], sel: ElementSelection): ElementMeta[] {
  const ids = sel.ids?.length ? new Set(sel.ids) : null;
  const where = sel.where ?? [];
  const picked = index.filter(
    (e) => e.panel === sel.panel && (!ids || ids.has(e.id)) && where.every((f) => matches(e.facets[f.facet], f)),
  );
  const limit = sel.limit && sel.limit > 0 ? Math.floor(sel.limit) : undefined;
  return limit ? picked.slice(0, limit) : picked;
}

/** Bubble title for a selection: the panel label plus what was asked for. */
export function selectionTitle(panelLabel: string, sel: ElementSelection, count: number): string {
  const parts = (sel.where ?? []).map((f) => `${f.facet} ${f.op} ${f.value}`);
  const what = parts.length ? parts.join(", ") : sel.ids?.length ? "selected" : "all";
  return `${panelLabel} · ${what} · ${count} ${count === 1 ? "match" : "matches"}`;
}

/** The ELEMENTS section of the copilot's prompt: every element with its facets, capped per panel. */
export function elementIndexLines(index: ElementMeta[], cap = 40): string {
  const byPanel = new Map<string, ElementMeta[]>();
  for (const e of index) byPanel.set(e.panel, [...(byPanel.get(e.panel) ?? []), e]);
  const out: string[] = [];
  for (const panel of Object.keys(ELEMENT_PANELS)) {
    const rows = byPanel.get(panel) ?? [];
    out.push(`${panel} (facets: ${ELEMENT_PANELS[panel].join(", ")}) — ${rows.length} element${rows.length === 1 ? "" : "s"}`);
    for (const e of rows.slice(0, cap)) {
      const facets = Object.entries(e.facets)
        .filter(([, v]) => v !== "" && v !== undefined)
        .map(([k, v]) => `${k}=${typeof v === "string" ? clip(v, 40) : v}`)
        .join(" ");
      out.push(`  - ${e.id} | ${clip(e.label, 60)} | ${facets}`);
    }
    if (rows.length > cap) out.push(`  … ${rows.length - cap} more; use where filters to reach them`);
  }
  return out.join("\n");
}

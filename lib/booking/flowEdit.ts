import type { FlowStep } from "./types";

/**
 * Pure edits to the business's own step order (BookingSettings.flow), shared
 * by the admin Form panel (which computes the new order in the browser and
 * posts it whole) and the server action that stores it. Import-free apart
 * from the FlowStep type, so the client bundle and offline proofs can both
 * reach it.
 *
 * A step is named by a stable id: an engine kind is its own id
 * (`service`, `provider`, `location`, `time`, `review`); a `questions` step
 * is `screen:<n>` for the screen it asks. The ids are what the panel posts
 * and what `saveBookingFlowAction` reads back.
 */

export const ENGINE_STEP_IDS = ["service", "provider", "location", "time", "review"] as const;

/** The stable id of one step: its kind, or `screen:<n>` for a questions step. */
export function stepId(step: FlowStep): string {
  return step.kind === "questions" ? `screen:${step.screen ?? -1}` : step.kind;
}

/** The step an id names, without a title; null for an id that names nothing. */
export function stepFromId(id: string): FlowStep | null {
  const trimmed = id.trim();
  if ((ENGINE_STEP_IDS as readonly string[]).includes(trimmed)) return { kind: trimmed as FlowStep["kind"] };
  const m = /^screen:(\d+)$/.exec(trimmed);
  if (!m) return null;
  const screen = Number(m[1]);
  if (!Number.isInteger(screen) || screen < 1) return null;
  return { kind: "questions", screen };
}

/** The flow as a list of ids, in order. */
export function flowIds(flow: ReadonlyArray<FlowStep>): string[] {
  return flow.map(stepId);
}

/**
 * The flow with one step swapped with its neighbour. `review` never moves
 * and nothing moves past it: it is always last. Out-of-range moves and
 * unknown ids return the flow unchanged.
 */
export function moveFlowStep(flow: ReadonlyArray<FlowStep>, id: string, dir: "up" | "down"): FlowStep[] {
  const out = [...flow];
  const i = out.findIndex((s) => stepId(s) === id);
  if (i < 0 || out[i].kind === "review") return out;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= out.length || out[j].kind === "review") return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/**
 * A flow rebuilt from posted ids. Titles come from `titles` (keyed by id)
 * when posted, else from the step of the same id in `previous`, so a form
 * that posts only the order keeps every heading. Ids that name nothing are
 * dropped; `sanitizeFlow` settles the rest (one review, last; every screen
 * mentioned once).
 */
export function flowFromIds(
  ids: ReadonlyArray<string>,
  titles: Readonly<Record<string, string | undefined>>,
  previous: ReadonlyArray<FlowStep> = [],
): FlowStep[] {
  const kept = new Map(previous.map((s) => [stepId(s), s.title]));
  const out: FlowStep[] = [];
  for (const id of ids) {
    const step = stepFromId(id);
    if (!step) continue;
    const key = stepId(step);
    const title = titles[key] !== undefined ? titles[key] : kept.get(key);
    const trimmed = (title ?? "").trim().slice(0, 120);
    if (trimmed) step.title = trimmed;
    out.push(step);
  }
  return out;
}

/**
 * The flow with a `questions` step for `newScreen` placed right after the
 * step that asks `afterScreen` — so a screen split off another is asked next
 * to it, not at the end. Appended before review when `afterScreen` has no
 * step; unchanged when `newScreen` already has one.
 */
export function insertScreenAfter(flow: ReadonlyArray<FlowStep>, afterScreen: number, newScreen: number): FlowStep[] {
  if (flow.some((s) => s.kind === "questions" && s.screen === newScreen)) return [...flow];
  const out = [...flow];
  const step: FlowStep = { kind: "questions", screen: newScreen };
  const i = out.findIndex((s) => s.kind === "questions" && s.screen === afterScreen);
  if (i >= 0) {
    out.splice(i + 1, 0, step);
    return out;
  }
  const review = out.findIndex((s) => s.kind === "review");
  out.splice(review >= 0 ? review : out.length, 0, step);
  return out;
}

/**
 * The renumbering `renumberScreens` (lib/appointments.ts) will apply to the
 * given fields: old screen → its 1-based rank by first appearance in field
 * order. A row from before screens existed (0) counts as a screen of its own.
 */
export function screenRenumbering(fields: ReadonlyArray<{ screen: number; order: number }>): Map<number, number> {
  const numbered = new Map<number, number>();
  for (const f of fields) {
    const current = f.screen >= 1 ? f.screen : -(f.order + 1);
    if (!numbered.has(current)) numbered.set(current, numbered.size + 1);
  }
  return numbered;
}

/** The flow with every `questions` step's screen passed through the mapping; steps naming an unmapped screen are dropped. */
export function remapFlowScreens(flow: ReadonlyArray<FlowStep>, mapping: ReadonlyMap<number, number>): FlowStep[] {
  const out: FlowStep[] = [];
  for (const step of flow) {
    if (step.kind !== "questions") {
      out.push(step);
      continue;
    }
    const next = mapping.get(step.screen ?? -1);
    if (next === undefined) continue;
    out.push({ ...step, screen: next });
  }
  return out;
}

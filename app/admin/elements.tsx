import { createElement as h, type ReactNode } from "react";
import { buildElementIndex, type ElementData, type ElementMeta } from "@/lib/adminElements";
import { loadElementData } from "@/lib/adminElementsLoad";
import { DirectiveForm } from "./DirectivesPanel";
import { AnswerForm, answerTabPositions } from "./AnswersPanel";

/**
 * The panel side of the element registry: one React node per element, keyed
 * `nodes[panel][id]`, rendered through the panels' own row components so a
 * revealed element is the panel's row — same markup, same server actions —
 * just on its own. The index returned beside the nodes is built from the same
 * rows with the same builders the brain uses (lib/adminElements.ts), so the
 * ids the copilot picks are the ids the chat can render.
 */

export type ElementNodes = Record<string, Record<string, ReactNode>>;

export function buildElementNodes(d: ElementData): { index: ElementMeta[]; nodes: ElementNodes } {
  const tabs = answerTabPositions(d.canned);
  // createElement rather than JSX: this file is also loaded by offline proofs
  // through tsx, which (with jsx: preserve) has no React global to lean on.
  const nodes: ElementNodes = {
    goals: Object.fromEntries(
      d.goals.map((r) => [r.id, h(DirectiveForm, { key: r.id, kind: "goal", row: r })]),
    ),
    rules: Object.fromEntries(
      d.rules.map((r) => [r.id, h(DirectiveForm, { key: r.id, kind: "rule", row: r })]),
    ),
    answers: Object.fromEntries(
      d.canned.map((r) => [r.id, h(AnswerForm, { key: r.id, row: r, tab: tabs[r.id] })]),
    ),
  };
  return { index: buildElementIndex(d), nodes };
}

/** Load-and-build, for callers that don't already hold the rows (proofs). */
export async function buildElementNodesForUser(userId: string) {
  return buildElementNodes(await loadElementData(userId));
}

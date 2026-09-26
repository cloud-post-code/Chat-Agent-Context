import { listCannedAnswers } from "@/lib/canned";
import { listDirectives } from "@/lib/directives";
import { buildElementIndex, type ElementData, type ElementMeta } from "@/lib/adminElements";

/**
 * Loads the rows the element panels are built from — the same stores the
 * dashboard reads — so the brain's index and the panel's nodes come from one
 * shape of data. Server-only; the pure builders live in lib/adminElements.ts.
 */
export async function loadElementData(userId: string): Promise<ElementData> {
  const [goals, rules, canned] = await Promise.all([
    listDirectives(userId, "goal"),
    listDirectives(userId, "rule"),
    listCannedAnswers(userId),
  ]);
  return { goals, rules, canned };
}

export async function loadElementIndex(userId: string): Promise<{ index: ElementMeta[] }> {
  return { index: buildElementIndex(await loadElementData(userId)) };
}

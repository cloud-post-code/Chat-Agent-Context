import { prisma } from "@/lib/db";
import { saveDirective } from "@/lib/directives";
import type { Page } from "./crawl";
import { llmCorpus, llmExtract } from "./knowledgeLlm";

/**
 * The goals extractor: one reading of the pages onboarding already loaded,
 * turned into the outcomes this business wants from a visitor conversation.
 *
 * Onboarding fills an agent with knowledge but leaves the Agent Behavior →
 * Goals tab empty, so a freshly onboarded agent answers accurately and steers
 * nowhere. This stage writes ordinary AgentDirective rows through the same
 * saveDirective path the admin form uses — they are live immediately (the
 * prompt picks them up via goalsPromptSection) and the owner edits, disables,
 * or deletes them on the tab that already exists.
 *
 * Seeding follows the booking-form rule: only into an EMPTY catalog. A tenant
 * who has written a goal — even a disabled one — keeps exactly what they have.
 */

export const GOALS_SYSTEM_PROMPT = `You read text from a business's website and write the goals for the AI chat agent that answers visitors on that site. A goal is an outcome THIS business wants out of a visitor conversation.

The text contains multiple pages, each preceded by "=== <url>", and then a SIGNALS section stating what the site actually supports.

Rules:
- Each goal is one concrete outcome, phrased as a directive to the agent ("Get ...", "Steer ...", "Surface ..."). Use the business's own words for what it sells.
- Ground every goal in the pages. Never invent an offering, channel, or audience the text does not describe.
- Only propose a booking or appointment goal if SIGNALS says the business takes appointments.
- Never write generic assistant behavior ("be helpful", "answer accurately", "be polite"). That is already the agent's job and is not a goal.
- Order them by how much this business would care, most important first.
- At most 5. Fewer is better than padding. Nothing groundable? Return an empty list.

Respond with ONLY this JSON, no other text:
{"goals":[""]}`;

/** What the run found, so the model proposes goals the tenant can act on. */
export type GoalSignals = {
  /** Whether the site says customers can book — booking is on by default. */
  takesAppointments: boolean;
  /** Knowledge categories that produced content this run. */
  categories: string[];
};

export type GoalsReport = {
  /** Rows actually written. */
  written: number;
  /** True when the tenant already had goals, so nothing was seeded. */
  keptExisting: boolean;
  /** True when the model call failed; the stage is best-effort. */
  failed: boolean;
  goals: string[];
};

/** A short, sharp list the owner will read beats a wall the model pads out. */
const MAX_GOALS = 5;
const MAX_GOAL_CHARS = 200;

/**
 * Model output → typed, capped, de-duplicated goals. Never throws: junk of
 * any shape comes back as an empty list (the sanitizeServices contract).
 */
export function sanitizeGoals(raw: Record<string, unknown> | null): string[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { goals?: unknown }).goals)) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of (raw as { goals: unknown[] }).goals) {
    if (typeof g !== "string") continue;
    const text = g.trim().slice(0, MAX_GOAL_CHARS);
    if (!text) continue;
    // Case-insensitive dedup, first phrasing wins.
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_GOALS) break;
  }
  return out;
}

/** The corpus: the pages read, then the run's own findings as SIGNALS. */
export function goalsCorpus(pages: Page[], signals: GoalSignals): string {
  const categories = signals.categories.filter(Boolean);
  return (
    `${llmCorpus(pages)}\n\n=== SIGNALS\n` +
    `Takes appointments (customers can book): ${signals.takesAppointments ? "yes" : "no"}\n` +
    `Knowledge this site provided: ${categories.length ? categories.join(", ") : "none"}`
  );
}

type LlmFn = typeof llmExtract;

/**
 * Read the already-loaded pages and seed the tenant's goals. `deps.llm` is the
 * one injectable boundary (the lib/customIngest precedent) so proofs run
 * offline; sanitizing and the saveDirective write are the real paths.
 *
 * Best-effort by contract: a failed model call is reported, never thrown. This
 * runs after the knowledge is already saved, and losing a goal draft must
 * never cost a completed onboarding.
 */
export async function deriveGoals(
  pages: Page[],
  userId: string,
  signals: GoalSignals,
  onEvent: (m: string) => void,
  deps: { llm?: LlmFn } = {},
): Promise<GoalsReport> {
  const report: GoalsReport = { written: 0, keptExisting: false, failed: false, goals: [] };
  if (!pages.length) return report;

  // The gate first: an existing catalog is the tenant's, so don't even spend
  // the model call on a run whose output we would refuse to write.
  if ((await prisma.agentDirective.count({ where: { userId, kind: "goal" } })) > 0) {
    report.keptExisting = true;
    return report;
  }

  const llm = deps.llm ?? llmExtract;
  let clean: string[];
  try {
    clean = sanitizeGoals(await llm(GOALS_SYSTEM_PROMPT, goalsCorpus(pages, signals), 1000, onEvent));
  } catch {
    report.failed = true;
    return report;
  }
  if (!clean.length) return report;

  // Written in the model's stated priority; `order` preserves it on the tab.
  for (const [i, text] of clean.entries()) {
    await saveDirective(userId, { kind: "goal", text, enabled: true, order: i });
  }
  report.goals = clean;
  report.written = clean.length;
  return report;
}

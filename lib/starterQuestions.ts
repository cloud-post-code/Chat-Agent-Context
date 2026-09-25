import { prisma } from "@/lib/db";
import { claude, claudeModel, textOf } from "@/lib/claude";
import { normalizeQuestion } from "@/lib/canned";
import { CHIP_COUNT, CHIP_WORDS, chipLabel, clampLabel } from "@/lib/chipLabel";

/**
 * Business-specific starter questions, generated once when onboarding
 * completes. Signup provisions no questions at all; by the time onboarding
 * finishes, the business profile, brand identity, goals, and ingested
 * knowledge exist — so one model call writes the questions a likely
 * prospective customer of THIS business would ask. From there the existing
 * Answers machinery takes over unchanged: the next dashboard load drafts
 * answers for the new questions, and exact matches are served without a model
 * call.
 *
 * Generation is deliberately conservative: it only ever fires on an account
 * with no preset rows, it is all-or-nothing, and any failure leaves the
 * account exactly as it was — onboarding completion must never break or wait
 * on it past a short deadline. An account whose generation failed shows no
 * chips until it is regenerated or the owner writes their own.
 */

/** The Anthropic client narrowed to the one call this module makes. */
type StarterClient = {
  messages: {
    create(params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }): Promise<{ content: unknown[] }>;
  };
};

export type StarterDeps = { client?: StarterClient };

/**
 * How many questions we ask for and keep — exactly the tabs the page shows, so
 * every generated question is one a visitor can actually tap.
 */
const QUESTION_COUNT = CHIP_COUNT;

/** A generated question and the short text of its tab ("" when none came). */
type Generated = { question: string; label: string };

/**
 * How long onboarding completion will wait. Past this the response goes out
 * and nothing is written; the moment already has a multi-second extraction
 * save ahead of it, so this bounds the marginal wait, not the whole request.
 */
function starterDeadlineMs(): number {
  return Number(process.env.STARTER_QUESTIONS_DEADLINE_MS) || 12_000;
}

const BRIEF = `You write the starter tabs for a business's AI agent page.
Visitors see a row of ${QUESTION_COUNT} small tabs by the chat box and tap one to start talking.
Each tab shows a short label; tapping it asks the full question behind it.

Write exactly ${QUESTION_COUNT} questions a likely prospective customer would
ask this business when learning about it — services and offerings, pricing or
quotes, how to get started or book, location and hours, what makes them worth
choosing. Phrase each as the customer speaking to the business ("Do you...",
"What do you...", "How can I..."), never as an interview question to a person.
Ground every question in the business context provided; when the context names
goals, favor questions that lead a conversation toward them.

Each label names its question's topic in ${CHIP_WORDS} words or fewer ("Services and pricing",
"Book a visit", "Hours and location") — a noun phrase, not a cut-off sentence,
no punctuation, first word capitalized. The ${QUESTION_COUNT} labels cover different topics.

Rules: each question is short (under 70 characters), plain text, no emojis, no
numbering. Reply with ONLY a JSON array of ${QUESTION_COUNT} objects:
[{"label": "...", "question": "..."}]`;

/**
 * Parse the model's reply into clean, deduplicated questions. An item is
 * normally {label, question}; a bare string is still a usable question — it
 * just arrives unlabelled, and its tab derives a label instead.
 */
function parseQuestions(text: string): Generated[] {
  const raw = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const questions: Generated[] = [];
  for (const item of parsed) {
    const fields = (typeof item === "string" ? { question: item } : item ?? {}) as {
      question?: unknown;
      label?: unknown;
    };
    if (typeof fields.question !== "string") continue;
    const q = fields.question.trim();
    const key = normalizeQuestion(q);
    if (!q || !key || seen.has(key)) continue;
    seen.add(key);
    questions.push({
      question: q,
      label: clampLabel(typeof fields.label === "string" ? fields.label : ""),
    });
    if (questions.length === QUESTION_COUNT) break;
  }
  return questions;
}

/**
 * True when there is nothing of the owner's to protect: the account has no
 * preset rows at all.
 *
 * Signup no longer seeds generic placeholder questions, so an empty table is
 * now the ordinary path into generation — both for a first onboarding and for
 * the re-onboarding one (`restartOnboarding` wipes the account's content,
 * canned answers included). Any row that exists at all came from generation,
 * the drafting pass, or the owner, and none of those are ours to overwrite.
 */
function hasNothingToProtect(rows: unknown[]): boolean {
  return rows.length === 0;
}

/** Everything the system knows about the business at onboarding completion. */
async function businessContext(userId: string): Promise<string> {
  const [profile, persona, goals, sources] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.personaConfig.findUnique({ where: { userId } }),
    prisma.agentDirective.findMany({
      where: { userId, kind: "goal", enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
    prisma.source.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: { title: true },
    }),
  ]);

  const lines: string[] = [];
  if (profile?.company_name) lines.push(`Business: ${profile.company_name}`);
  if (profile?.owner_name) lines.push(`Owner: ${profile.owner_name}`);
  if (profile?.company_address) lines.push(`Address: ${profile.company_address}`);
  if (profile?.company_hours) lines.push(`Hours: ${profile.company_hours}`);
  if (persona?.tagline) lines.push(`Tagline: ${persona.tagline}`);
  try {
    const values = JSON.parse(persona?.brandValues || "[]");
    if (Array.isArray(values) && values.length) lines.push(`Brand values: ${values.join(", ")}`);
  } catch {
    /* malformed brandValues never blocks generation */
  }
  if (goals.length) {
    lines.push("Goals for visitor conversations:");
    for (const g of goals) lines.push(`- ${g.text}`);
  }
  const titles = sources.map((s) => s.title).filter(Boolean);
  if (titles.length) lines.push(`Knowledge on file: ${titles.join("; ")}`);
  return lines.join("\n");
}

/** One bounded, grounded generation call. Empty array on any failure. */
async function generateQuestions(userId: string, deps: StarterDeps): Promise<Generated[]> {
  const context = await businessContext(userId);
  const call = (deps.client ?? claude()).messages.create({
    model: claudeModel(),
    max_tokens: 700,
    system: BRIEF,
    messages: [{ role: "user", content: `BUSINESS CONTEXT:\n${context}` }],
  });
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), starterDeadlineMs()).unref?.();
  });
  const message = await Promise.race([call, timeout]);
  if (!message) return []; // deadline: existing rows stay, the caller moves on
  return parseQuestions(textOf(message.content));
}

/**
 * Write generated, business-specific questions for an account that has none.
 * Returns how many questions were written — 0 when the guard declined,
 * generation failed, or the deadline passed, all of which leave the account's
 * rows exactly as they were.
 */
export async function personalizeStarterQuestions(
  userId: string,
  deps: StarterDeps = {},
): Promise<number> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return 0;

  try {
    const rows = await prisma.cannedAnswer.findMany({ where: { userId } });
    if (!hasNothingToProtect(rows)) return 0;

    const questions = await generateQuestions(userId, deps);
    if (!questions.length) return 0;

    // All-or-nothing: one transaction writes the whole set or none of it.
    await prisma.$transaction([
      prisma.cannedAnswer.deleteMany({ where: { userId } }),
      prisma.cannedAnswer.createMany({
        data: questions.map((g, i) => ({
          userId,
          question: g.question,
          label: g.label,
          matchKey: normalizeQuestion(g.question),
          order: i,
        })),
      }),
    ]);
    return questions.length;
  } catch (e) {
    console.error(`personalizeStarterQuestions(${userId}) failed:`, e);
    return 0;
  }
}

/**
 * The Presets tab's explicit "Regenerate questions" — for accounts that
 * predate onboarding-time generation, or whose business has moved on. Unlike
 * the onboarding pass there is no untouched-seeds guard, but owner-authored
 * rows (reviewed, non-empty — enabled or not) are sacred: they stay exactly
 * as they are, and only blank rows and unreviewed drafts are replaced by the
 * generated questions, deduplicated against what's kept. Replacements arrive
 * blank and never-drafted so the drafting pass writes their answers on the
 * next tab load. Returns how many questions were written; 0 leaves every row
 * as it was.
 */
export async function regenerateStarterQuestions(
  userId: string,
  deps: StarterDeps = {},
): Promise<number> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return 0;

  try {
    const rows = await prisma.cannedAnswer.findMany({ where: { userId } });
    const kept = rows.filter((r) => r.answer.trim() !== "" && !r.aiDraft);
    const keptKeys = new Set(kept.map((r) => r.matchKey));
    const replaceIds = rows.filter((r) => !keptKeys.has(r.matchKey)).map((r) => r.id);

    const questions = (await generateQuestions(userId, deps)).filter(
      (g) => !keptKeys.has(normalizeQuestion(g.question)),
    );
    if (!questions.length) return 0;

    // Kept rows lead with their existing order; the new questions follow.
    const afterKept = kept.length ? Math.max(...kept.map((r) => r.order)) + 1 : 0;
    await prisma.$transaction([
      prisma.cannedAnswer.deleteMany({ where: { userId, id: { in: replaceIds } } }),
      prisma.cannedAnswer.createMany({
        data: questions.map((g, i) => ({
          userId,
          question: g.question,
          label: g.label,
          matchKey: normalizeQuestion(g.question),
          order: afterKept + i,
        })),
      }),
    ]);
    return questions.length;
  } catch (e) {
    console.error(`regenerateStarterQuestions(${userId}) failed:`, e);
    return 0;
  }
}

/**
 * The starter tabs for one user's public page: their first three preset
 * questions (enabled, in order — CHIP_COUNT), so tabs and preset answers can
 * never disagree. `q` is the whole question a tap sends; `label` is the tab's
 * text, never more than three words. Questions past the first three stay live
 * as preset answers — they just have no tab.
 *
 * An account with no usable rows gets no chips. There is deliberately no
 * fallback list: generic questions written for no particular business told a
 * visitor nothing, and showing them on a real business's page was worse than
 * showing none. The page renders its chat either way.
 */
export async function starterChipsFor(
  userId: string,
): Promise<{ q: string; label: string }[]> {
  const rows = await prisma.cannedAnswer.findMany({
    where: { userId, enabled: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    take: CHIP_COUNT,
    select: { question: true, label: true },
  });
  return rows.map((r) => ({ q: r.question, label: chipLabel(r) }));
}

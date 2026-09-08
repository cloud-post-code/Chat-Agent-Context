import { prisma } from "@/lib/db";
import { claude, claudeModel } from "@/lib/claude";
import { starterQuestions } from "@/lib/theme";
import { normalizeQuestion } from "@/lib/canned";

/**
 * Business-specific starter questions, generated once when onboarding
 * completes. Signup seeds every account with the same five generic questions
 * (lib/canned.ts seedStarterAnswers); by the time onboarding finishes, the
 * business profile, brand identity, goals, and ingested knowledge exist — so
 * one model call rewrites those seeds into the questions a likely prospective
 * customer of THIS business would ask. From there the existing Answers
 * machinery takes over unchanged: the next dashboard load drafts answers for
 * the new questions, and exact matches are served without a model call.
 *
 * The swap is deliberately conservative: it only ever fires on rows that are
 * still the untouched generic seeds, it is all-or-nothing, and any failure
 * leaves the seeds in place — onboarding completion must never break or wait
 * on it past a short deadline.
 */

/** The Anthropic client narrowed to the one call this module makes. */
export type StarterClient = {
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

/** How many questions we ask for and keep — the same count as the chips row. */
const QUESTION_COUNT = 5;

/**
 * How long onboarding completion will wait. Past this the response goes out
 * and the seeds stay; the moment already has a multi-second extraction save
 * ahead of it, so this bounds the marginal wait, not the whole request.
 */
function starterDeadlineMs(): number {
  return Number(process.env.STARTER_QUESTIONS_DEADLINE_MS) || 12_000;
}

const BRIEF = `You write the starter-question chips for a business's AI agent page.
Visitors see these chips under the chat box and tap one to start talking.

Write exactly ${QUESTION_COUNT} questions a likely prospective customer would
ask this business when learning about it — services and offerings, pricing or
quotes, how to get started or book, location and hours, what makes them worth
choosing. Phrase each as the customer speaking to the business ("Do you...",
"What do you...", "How can I..."), never as an interview question to a person.
Ground every question in the business context provided; when the context names
goals, favor questions that lead a conversation toward them.

Rules: each question is short (under 70 characters), plain text, no emojis, no
numbering. Reply with ONLY a JSON array of ${QUESTION_COUNT} strings.`;

/** The text blocks of a completion, joined. */
function textOf(content: unknown[]): string {
  return content
    .filter((b): b is { type: "text"; text: string } => {
      const block = b as { type?: string; text?: string };
      return block.type === "text" && typeof block.text === "string";
    })
    .map((b) => b.text)
    .join("")
    .trim();
}

/** Parse the model's reply into clean, deduplicated questions. */
function parseQuestions(text: string): string[] {
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
  const questions: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const q = item.trim();
    const key = normalizeQuestion(q);
    if (!q || !key || seen.has(key)) continue;
    seen.add(key);
    questions.push(q);
    if (questions.length === QUESTION_COUNT) break;
  }
  return questions;
}

/**
 * True when there is nothing of the owner's to protect: either no rows at all,
 * or rows that are exactly the untouched generic seeds — same questions,
 * nothing written, drafted, or reordered. Any sign the owner (or the drafting
 * pass) has touched the tab means their rows are theirs.
 *
 * The empty case is the re-onboarding path: `restartOnboarding` wipes the
 * account's content, canned answers included, so the second run through the
 * flow arrives with an empty table. Reading that as "customized" would leave
 * the user with no preset rows at all — strictly worse than the generic seeds
 * the guard exists to defend.
 */
function isUntouchedSeeds(
  rows: { matchKey: string; answer: string; aiDraft: boolean; draftedAt: Date | null }[],
): boolean {
  if (rows.length === 0) return true;
  if (rows.length !== starterQuestions.length) return false;
  const seedKeys = new Set(starterQuestions.map((s) => normalizeQuestion(s.q)));
  return rows.every(
    (r) =>
      seedKeys.has(r.matchKey) && r.answer === "" && !r.aiDraft && r.draftedAt === null,
  );
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
async function generateQuestions(userId: string, deps: StarterDeps): Promise<string[]> {
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
 * Replace the untouched generic seeds with generated, business-specific
 * questions. Returns how many questions were written — 0 when the guard
 * declined, generation failed, or the deadline passed, all of which leave the
 * existing rows exactly as they were.
 */
export async function personalizeStarterQuestions(
  userId: string,
  deps: StarterDeps = {},
): Promise<number> {
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return 0;

  try {
    const rows = await prisma.cannedAnswer.findMany({ where: { userId } });
    if (!isUntouchedSeeds(rows)) return 0;

    const questions = await generateQuestions(userId, deps);
    if (!questions.length) return 0;

    // All-or-nothing: the seeds only disappear in the same transaction that
    // writes their replacements.
    await prisma.$transaction([
      prisma.cannedAnswer.deleteMany({ where: { userId } }),
      prisma.cannedAnswer.createMany({
        data: questions.map((q, i) => ({
          userId,
          question: q,
          matchKey: normalizeQuestion(q),
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
      (q) => !keptKeys.has(normalizeQuestion(q)),
    );
    if (!questions.length) return 0;

    // Kept rows lead with their existing order; the new questions follow.
    const afterKept = kept.length ? Math.max(...kept.map((r) => r.order)) + 1 : 0;
    await prisma.$transaction([
      prisma.cannedAnswer.deleteMany({ where: { userId, id: { in: replaceIds } } }),
      prisma.cannedAnswer.createMany({
        data: questions.map((q, i) => ({
          userId,
          question: q,
          matchKey: normalizeQuestion(q),
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
 * The starter chips for one user's public page: their own preset questions
 * (enabled, in order), so chips and preset answers can never disagree. The
 * hardcoded list remains only as the fallback for accounts with no usable
 * rows.
 */
export async function starterChipsFor(userId: string): Promise<{ q: string }[]> {
  const rows = await prisma.cannedAnswer.findMany({
    where: { userId, enabled: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { question: true },
  });
  if (!rows.length) return starterQuestions;
  return rows.map((r) => ({ q: r.question }));
}

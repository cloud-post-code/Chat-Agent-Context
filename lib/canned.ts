import { prisma } from "@/lib/db";
import { starterQuestions } from "@/lib/theme";

/**
 * Hand-written answers to the questions visitors ask over and over. The five
 * starter chips are the same five questions forever, so paying the model to
 * re-derive those answers on every page view is pure waste — and it's the
 * slowest part of a visitor's first impression.
 *
 * Matching is deliberately dumb: normalized string equality, nothing fuzzy. A
 * near-miss falls through to the model, which is the safe direction to fail —
 * the cost of a miss is today's cost, while the cost of a loose match is the
 * wrong answer in Blake's voice.
 *
 * Data only. Rendering cards and talking to Claude belong to lib/brain.ts.
 */

/** The tools a canned answer may name to draw a card alongside its text. */
export const CARD_TOOLS = [
  "show_projects",
  "show_project",
  "show_gallery",
  "show_contact_form",
  // Custom-designed cards from the admin card builder, drawn by key.
  "show_card",
] as const;

export type CardTool = (typeof CARD_TOOLS)[number];

/**
 * The lookup key for a question: case, surrounding and internal whitespace, and
 * trailing sentence punctuation are all noise. Everything else must match.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/, "")
    .trim();
}

/**
 * The canned answer for this message, or null to let the model handle it.
 * A row must be enabled AND actually written: a blank answer is a to-do on the
 * admin tab, not an empty reply to a visitor.
 */
export async function findServableCanned(userId: string, message: string) {
  const matchKey = normalizeQuestion(message);
  if (!matchKey) return null;
  const row = await prisma.cannedAnswer.findUnique({
    where: { userId_matchKey: { userId, matchKey } },
  });
  if (!row || !row.enabled || !row.answer.trim()) return null;
  return row;
}

/** Count one model call avoided. Best-effort: never fail a visitor's answer. */
export async function recordCannedHit(id: string) {
  await prisma.cannedAnswer
    .update({ where: { id }, data: { hits: { increment: 1 } } })
    .catch(() => {});
}

export async function listCannedAnswers(userId: string) {
  return prisma.cannedAnswer.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Bootstrap the tab with the starter questions as blank rows, so it opens on an
 * obvious to-do list rather than an empty state. Only ever fills an empty
 * table: re-seeding on every load would resurrect rows Blake deliberately
 * deleted, which is worse than an incomplete list.
 */
export async function seedStarterAnswers(userId: string) {
  if ((await prisma.cannedAnswer.count({ where: { userId } })) > 0) return;
  await prisma.cannedAnswer.createMany({
    data: starterQuestions.map((s, i) => ({
      userId,
      question: s.q,
      matchKey: normalizeQuestion(s.q),
      order: i,
    })),
    skipDuplicates: true,
  });
}

/** Write one row from the admin form. A blank id creates. */
export async function saveCannedAnswer(userId: string, input: {
  id?: string;
  question: string;
  answer: string;
  cardTool?: string | null;
  cardInput?: string | null;
  enabled: boolean;
  order?: number;
}) {
  const question = input.question.trim();
  if (!question) return;
  const cardTool = CARD_TOOLS.includes(input.cardTool as CardTool)
    ? (input.cardTool as CardTool)
    : null;
  const data = {
    question,
    matchKey: normalizeQuestion(question),
    answer: input.answer.trim(),
    cardTool,
    cardInput: cardTool ? input.cardInput?.trim() || null : null,
    enabled: input.enabled,
    order: input.order ?? 0,
    // Saving through the form is Blake's review, whether or not he changed a
    // word: the text is his now. `draftedAt` is deliberately untouched, so a
    // row he saves empty stays empty instead of drafting itself again.
    aiDraft: false,
  };
  // `matchKey` is unique, so two rows can never claim the same question. When
  // one already owns this key, write into it and drop the row being edited —
  // the same merge-on-collision the Graph tab does when you rename an entity
  // onto an existing name. Anything else would throw a raw constraint error
  // out of the form.
  const owner = await prisma.cannedAnswer.findUnique({
    where: { userId_matchKey: { userId, matchKey: data.matchKey } },
  });
  if (owner && owner.id !== input.id) {
    await prisma.cannedAnswer.update({ where: { id: owner.id }, data });
    if (input.id) {
      await prisma.cannedAnswer.deleteMany({ where: { id: input.id, userId } });
    }
    return;
  }

  if (input.id) {
    const updated = await prisma.cannedAnswer.updateMany({
      where: { id: input.id, userId },
      data,
    });
    if (updated.count === 0) return; // not this user's row
  } else {
    await prisma.cannedAnswer.create({ data: { ...data, userId } });
  }
}

export async function deleteCannedAnswer(userId: string, id: string) {
  await prisma.cannedAnswer.deleteMany({ where: { id, userId } });
}

/** The numbers the admin tab's header reports. */
export function cannedStats(
  rows: { answer: string; enabled: boolean; hits: number; aiDraft: boolean }[],
) {
  const live = rows.filter((r) => r.enabled && r.answer.trim());
  return {
    total: rows.length,
    live: live.length,
    unanswered: rows.filter((r) => !r.answer.trim()).length,
    // Drafts are live like any other answer; this is the review backlog.
    unreviewed: rows.filter((r) => r.aiDraft && r.answer.trim()).length,
    callsSaved: rows.reduce((n, r) => n + r.hits, 0),
  };
}

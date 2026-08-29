import { prisma } from "@/lib/db";

/**
 * Persist one visitor chat turn (their question + the bot's answer) so the
 * admin "Activity" tab can show what people are doing. Called best-effort from
 * the chat route; all failures are swallowed by the caller.
 *
 * Turns are grouped by `sessionId` (a stable id the browser generates once and
 * reuses), so a whole conversation lands under a single ChatSession row.
 */
export async function recordTurn({
  userId,
  sessionId,
  question,
  answer,
}: {
  userId: string;
  sessionId: string;
  question: string;
  answer: string;
}) {
  const q = question.trim();
  const a = answer.trim();
  // Nothing worth logging without a question. Fall back to a synthetic key so
  // a missing sessionId still records rather than silently dropping.
  if (!q) return;
  const key = sessionId.trim() || `anon-${Date.now()}`;

  const session = await prisma.chatSession.upsert({
    where: { userId_visitorKey: { userId, visitorKey: key } },
    create: { userId, visitorKey: key, firstQuery: q.slice(0, 300) },
    update: { updatedAt: new Date() },
  });

  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "user", content: q },
  });
  if (a) {
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "assistant", content: a },
    });
  }
}

/** A conversation with its messages, as loaded for the admin Activity tab. */
type SessionWithMessages = {
  createdAt: Date;
  messages: { role: string; content: string; rating?: string | null }[];
};

/**
 * Roll up the conversation list into the numbers shown on the Activity tab:
 * totals, engagement, activity in the last 7 days, and the questions people
 * ask most. Pure — takes the already-loaded sessions, hits no database.
 */
export function chatMetrics(sessions: SessionWithMessages[]) {
  const totalMessages = sessions.reduce((n, s) => n + s.messages.length, 0);
  const questions = sessions.flatMap((s) =>
    s.messages.filter((m) => m.role === "user").map((m) => m.content),
  );
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const chatsThisWeek = sessions.filter((s) => s.createdAt.getTime() >= weekAgo).length;
  const avgQuestions = sessions.length
    ? Math.round((questions.length / sessions.length) * 10) / 10
    : 0;

  // Top questions, case-insensitively grouped, keeping the first-seen wording.
  const counts = new Map<string, { label: string; count: number }>();
  for (const q of questions) {
    const key = q.trim().toLowerCase();
    if (!key) continue;
    const hit = counts.get(key);
    if (hit) hit.count += 1;
    else counts.set(key, { label: q.trim(), count: 1 });
  }
  const topQuestions = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Feedback tallies across all bot answers.
  const botMessages = sessions.flatMap((s) => s.messages.filter((m) => m.role === "assistant"));
  const flaggedDown = botMessages.filter((m) => m.rating === "down").length;

  return {
    totalChats: sessions.length,
    totalMessages,
    totalQuestions: questions.length,
    chatsThisWeek,
    avgQuestions,
    topQuestions,
    flaggedDown,
  };
}

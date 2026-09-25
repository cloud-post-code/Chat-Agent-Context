"use server";

import { prisma } from "@/lib/db";
import { dropOrigin } from "@/lib/retrieval/indexer";
import { indexApprovedAnswer } from "@/lib/retrieval/origins";
import path from "node:path";
import { requireUser, reindex, revalidateAll } from "./_shared";

function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Delete one recorded conversation (messages cascade). */
export async function deleteChatSession(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return revalidateAll();

  // Any approved answers in this conversation were indexed as knowledge;
  // chunks don't cascade off ChatMessage, so drop them before the rows go.
  const approved = await prisma.chatMessage.findMany({
    where: { sessionId: id, role: "assistant", rating: "up", session: { userId: user.id } },
    select: { id: true },
  });
  await prisma.chatSession
    .deleteMany({ where: { id, userId: user.id } })
    .catch(() => {});
  for (const m of approved) {
    await reindex(`activity ${m.id}`, () => dropOrigin(user.id, "activity", m.id));
  }
  revalidateAll();
}

/**
 * Save Blake's feedback on one bot answer from the Activity tab: a rating
 * (up/down) and an optional correction note. A "down" + note is injected into
 * future system prompts so the bot doesn't repeat the mistake.
 *
 * A 👍 also promotes the answer into the knowledge index. This rating is the
 * ONLY path by which chat content becomes knowledge — visitors type into the
 * public chat box, so nothing they produce is indexed until Blake vouches for
 * it here. Clearing or flipping the rating drops it again.
 */
export async function saveChatFeedback(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const ratingRaw = String(formData.get("rating") ?? "");
  const rating = ratingRaw === "up" || ratingRaw === "down" ? ratingRaw : null;
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw ? noteRaw.slice(0, 2000) : null;
  if (id) {
    await prisma.chatMessage
      .updateMany({
        where: { id, session: { userId: user.id } },
        data: { rating, note },
      })
      .catch(() => {});
    await reindex(`activity ${id}`, () => indexApprovedAnswer(user.id, id));
  }
  revalidateAll();
}

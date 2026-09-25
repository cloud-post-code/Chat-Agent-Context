"use server";

import { saveCannedAnswer, deleteCannedAnswer } from "@/lib/canned";
import { redraftAnswer } from "@/lib/answerDrafts";
import { regenerateStarterQuestions } from "@/lib/starterQuestions";
import { requireUser, revalidateAll } from "./_shared";

// ── Canned answers ──────────────────────────────────────────────────────────
// Thin auth wrappers; the logic lives in lib/canned.ts so it stays testable.

export async function saveCanned(formData: FormData) {
  const user = await requireUser();
  await saveCannedAnswer(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    question: String(formData.get("question") ?? ""),
    label: String(formData.get("label") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    cardTool: String(formData.get("cardTool") ?? "") || null,
    cardInput: String(formData.get("cardInput") ?? "") || null,
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidateAll();
}

export async function deleteCanned(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteCannedAnswer(user.id, id);
  revalidateAll();
}

/**
 * Throw away a row's text and write a fresh draft. Best-effort like the
 * indexing wrappers above: a provider failure leaves the existing text in place
 * and logs, rather than throwing an error page over the whole dashboard.
 */
/**
 * Rebuild the starter-question list from today's business context. The lib
 * pass keeps every owner-authored row and swallows provider failures, so this
 * wrapper only authenticates and revalidates.
 */
export async function regenerateCanned() {
  const user = await requireUser();
  await regenerateStarterQuestions(user.id);
  revalidateAll();
}

export async function redraftCanned(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  try {
    await redraftAnswer(user.id, id);
  } catch (e) {
    console.error(`redraftCanned(${id}) failed:`, e);
  }
  revalidateAll();
}

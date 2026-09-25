"use server";

import { saveUiCard, deleteUiCard } from "@/lib/uiCards";
import { type CardDraft } from "@/lib/cardBuilder";
import path from "node:path";
import { requireUser, revalidateAll } from "./_shared";

export async function deleteCard(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteUiCard(user.id, id);
  revalidateAll();
}

// The builder's model call moved to app/api/admin/build-card/route.ts: a
// server action returns one value, and the page needs the reasoning and
// searches as they happen. Auth still gates it, at the route.

/** Persist a builder draft — same validated write path as the form. */
export async function saveBuiltCard(input: {
  id?: string;
  key?: string;
  draft: CardDraft;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const error = await saveUiCard(user.id, {
    id: input.id,
    key: input.key ?? "",
    label: input.draft.label,
    tool: input.draft.tool,
    description: input.draft.description,
    reason: input.draft.reason,
    note: input.draft.note,
    sampleBlock: input.draft.sampleBlock,
  });
  revalidateAll();
  return error ? { ok: false, error } : { ok: true };
}

"use server";

import { saveDirective, deleteDirective, DIRECTIVE_KINDS, type DirectiveKind } from "@/lib/directives";
import { requireUser, revalidateAll } from "./_shared";

// ── Agent directives (Goals / Rules tabs) ───────────────────────────────────
// Thin auth wrappers; the logic lives in lib/directives.ts so it stays testable.

export async function saveDirectiveAction(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "");
  if (!DIRECTIVE_KINDS.includes(kind as DirectiveKind)) return;
  await saveDirective(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    kind: kind as DirectiveKind,
    text: String(formData.get("text") ?? ""),
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidateAll();
}

export async function deleteDirectiveAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteDirective(user.id, id);
  revalidateAll();
}

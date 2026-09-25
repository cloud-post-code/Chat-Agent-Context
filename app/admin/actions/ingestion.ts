"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { saveIngestionSource, setIngestionSourceHidden } from "@/lib/ingestionSources";
import { deleteIngestionSourceAndData } from "@/lib/ingestedItems";
import { ingestCustomText, ingestCustomImage, ingestCustomUrl, ingestCustomFile, deleteIngestedItem } from "@/lib/customIngest";
import { checkEditPassword, createEditSession, isEditAuthed } from "@/lib/ingestionAuth";
import { applyThemeColor, approveIngestion, type IngestMethod } from "@/lib/adminBrain";
import { requireUser, isUpload, revalidateAll } from "./_shared";

// ── Ingestion sources (the Content tabs, stored as data) ──

/** Create a new ingestion source from the Content "+ New ingestion source" sub-tab. */
export async function createIngestionSourceAction(formData: FormData) {
  const user = await requireUser();
  const error = await saveIngestionSource(user.id, {
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? ""),
    uploadMethod: String(formData.get("uploadMethod") ?? "generic"),
    storageKinds: String(formData.get("storageKinds") ?? "text"),
    splitMode: String(formData.get("splitMode") ?? "split"),
    panelHtml: String(formData.get("panelHtml") ?? ""),
    classification: String(formData.get("classification") ?? "public"),
    outputMethod:
      String(formData.get("outputMethod") ?? "").trim() ||
      "Source/Photo rows, read back as unified text/image items",
  });
  if (error) redirect(`/admin/dashboard?tab=new-source&error=${encodeURIComponent(error)}`);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/**
 * Approve a chat-proposed ingestion. Object-in/object-out like the builder
 * saves, but over FormData because the approval card may carry a file. The
 * routing and writes live in lib/adminBrain.approveIngestion.
 */
export async function approveIngestionAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const method = String(formData.get("method") ?? "text");
  const proposal = {
    sourceKey: String(formData.get("sourceKey") ?? ""),
    method: (["url", "text", "file", "image"].includes(method) ? method : "text") as IngestMethod,
    title: String(formData.get("title") ?? "") || undefined,
    url: String(formData.get("url") ?? "") || undefined,
    text: String(formData.get("text") ?? "") || undefined,
    caption: String(formData.get("caption") ?? "") || undefined,
    classification: String(formData.get("classification") ?? "") || undefined,
  };
  const f = formData.get("file");
  const file =
    isUpload(f) && f.size > 0
      ? { bytes: Buffer.from(await f.arrayBuffer()), filename: f.name, contentType: f.type }
      : undefined;
  const error = await approveIngestion(user.id, proposal, { file });
  revalidateAll();
  return error ? { ok: false, error } : { ok: true };
}

/**
 * The chat-first admin's focused theme edit: Save on the copilot's pre-filled
 * color card. One role is written; lib/adminBrain.applyThemeColor leaves the
 * rest of the theme alone.
 */
export async function applyThemeColorAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const error = await applyThemeColor(
    user.id,
    String(formData.get("role") ?? ""),
    String(formData.get("value") ?? ""),
  );
  revalidateAll();
  return error ? { ok: false, error } : { ok: true };
}

/** Ingest pasted text into a custom source's marked rows. */
export async function ingestCustomTextAction(formData: FormData) {
  const user = await requireUser();
  await ingestCustomText(user.id, String(formData.get("sourceKey") ?? ""), {
    title: String(formData.get("title") ?? ""),
    text: String(formData.get("text") ?? ""),
    classification: String(formData.get("classification") ?? ""),
  });
  revalidateAll();
}

/** Scan a URL into a custom source's marked rows. */
export async function ingestCustomUrlAction(formData: FormData) {
  const user = await requireUser();
  await ingestCustomUrl(
    user.id,
    String(formData.get("sourceKey") ?? ""),
    String(formData.get("url") ?? ""),
    undefined,
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Ingest an uploaded document into a custom source's marked rows. */
export async function ingestCustomFileAction(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomFile(
    user.id,
    String(formData.get("sourceKey") ?? ""),
    Buffer.from(await file.arrayBuffer()),
    file.name,
    undefined,
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Delete one ingested item from a custom source (content, not config). */
export async function deleteIngestedItemAction(formData: FormData) {
  const user = await requireUser();
  await deleteIngestedItem(
    user.id,
    String(formData.get("sourceKey") ?? ""),
    String(formData.get("itemId") ?? ""),
  );
  revalidateAll();
}

/** Ingest an image into a custom source's marked rows. */
export async function ingestCustomImageAction(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomImage(
    user.id,
    String(formData.get("sourceKey") ?? ""),
    Buffer.from(await file.arrayBuffer()),
    file.type,
    String(formData.get("caption") ?? ""),
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Persist a chat-built ingestion source draft (the builder's Save button). */
export async function saveBuiltSourceAction(draft: {
  label: string;
  key: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode?: string;
  panelHtml?: string;
  classification?: string;
  outputMethod: string;
}): Promise<{ ok: boolean; error?: string; key?: string }> {
  const user = await requireUser();
  const error = await saveIngestionSource(user.id, {
    key: draft.key,
    label: draft.label,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    uploadMethod: draft.uploadMethod,
    storageKinds: draft.storageKinds,
    splitMode: draft.splitMode,
    panelHtml: draft.panelHtml,
    classification: draft.classification,
    outputMethod: draft.outputMethod,
  });
  if (error) return { ok: false, error };
  revalidateAll();
  // The saved key may differ from the draft's (slugified, collision-suffixed);
  // the newest row is the one this save just created.
  const saved = await prisma.ingestionSource.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return { ok: true, key: saved?.key };
}

/**
 * Save the builder's draft over an EXISTING source. Same edit-password rule
 * as the manual form, but returned as an error the builder can show inline —
 * a redirect would throw away the chat that produced the draft. Enabled and
 * order are not part of a draft; the row keeps its own.
 */
export async function updateBuiltSourceAction(draft: {
  id: string;
  label: string;
  key: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode?: string;
  panelHtml?: string;
  classification?: string;
  outputMethod: string;
}): Promise<{ ok: boolean; error?: string; key?: string }> {
  const user = await requireUser();
  if (!(await isEditAuthed())) {
    return { ok: false, error: "The edit session expired — go back and unlock again." };
  }
  const existing = await prisma.ingestionSource.findFirst({
    where: { id: draft.id, userId: user.id },
  });
  if (!existing) return { ok: false, error: "This ingestion source no longer exists." };
  const error = await saveIngestionSource(user.id, {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    uploadMethod: draft.uploadMethod,
    storageKinds: draft.storageKinds,
    splitMode: draft.splitMode,
    panelHtml: draft.panelHtml,
    classification: draft.classification,
    outputMethod: draft.outputMethod,
    enabled: existing.enabled,
    order: existing.order,
  });
  if (error) return { ok: false, error };
  revalidateAll();
  const saved = await prisma.ingestionSource.findFirst({
    where: { id: draft.id, userId: user.id },
  });
  return { ok: true, key: saved?.key };
}

/** Editing source CONFIG needs the local edit password's cookie too. */
async function requireEditAuth(key: string) {
  if (!(await isEditAuthed())) redirect(`/admin/sources/${key}?locked=1`);
}

/** Check the locally-stored edit password and unlock an edit session. */
export async function unlockIngestionEditAction(formData: FormData) {
  await requireUser();
  const key = String(formData.get("key") ?? "");
  if (!checkEditPassword(String(formData.get("password") ?? ""))) {
    redirect(`/admin/sources/${key}?error=1`);
  }
  await createEditSession();
  redirect(`/admin/sources/${key}`);
}

/**
 * Delete an ingestion source AND everything it ingested. Destructive, so it
 * keeps the edit-password gate on top of admin auth; the edit page's Danger
 * zone is the only caller and requires an explicit confirmation checkbox.
 */
export async function deleteIngestionSourceAction(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  // The checkbox is `required` client-side; re-check server-side so a raw
  // POST can't skip the confirmation.
  if (formData.get("confirm") !== "on") {
    redirect(`/admin/sources/${key}?error=${encodeURIComponent("Tick the confirmation box to delete this source.")}`);
  }
  const id = String(formData.get("id") ?? "");
  if (id) await deleteIngestionSourceAndData(user.id, id);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/** Hide or show a source's Content tab. Reversible, so admin auth suffices. */
export async function setIngestionSourceHiddenAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setIngestionSourceHidden(user.id, id, formData.get("hidden") === "1");
  revalidateAll();
}

/** Save edits to an existing ingestion source (config, not content). */
export async function updateIngestionSourceAction(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  const error = await saveIngestionSource(user.id, {
    id: String(formData.get("id") ?? ""),
    key,
    label: String(formData.get("label") ?? ""),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? ""),
    uploadMethod: String(formData.get("uploadMethod") ?? "generic"),
    storageKinds: String(formData.get("storageKinds") ?? "text"),
    splitMode: String(formData.get("splitMode") ?? "split"),
    panelHtml: String(formData.get("panelHtml") ?? ""),
    classification: String(formData.get("classification") ?? "public"),
    outputMethod: String(formData.get("outputMethod") ?? ""),
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  if (error) redirect(`/admin/sources/${key}?error=${encodeURIComponent(error)}`);
  revalidateAll();
  // Land back on the ingestion that was just edited, not the first tab.
  redirect(`/admin/dashboard?tab=${key}`);
}

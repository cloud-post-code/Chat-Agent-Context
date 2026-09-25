"use server";

import { embedMissingChunks } from "@/lib/retrieval/indexer";
import { renameEntity, deleteEntity, addEdge, deleteEdge, mergeEntities, dismissMerge, retrievalPreview, type RetrievalPreview } from "@/lib/retrieval/graph";
import { requireUser, revalidateAll, toData } from "./_shared";

// ── Knowledge graph (Graph tab) ──
// Thin auth + revalidate wrappers; the repair logic lives in lib/retrieval/graph.

/** Rename/retype an entity. A name that collides merges the two entities. */
export async function saveEntity(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  const type = String(formData.get("type") ?? "other");
  if (id && name.trim()) await renameEntity(user.id, id, name, type);
  revalidateAll();
}

export async function removeEntity(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEntity(user.id, id);
  revalidateAll();
}

/**
 * Recompute graph neighborhoods and rewrite their overview paragraphs — up to
 * 6 Claude calls, so it only runs when Blake presses the button.
 */
export async function rebuildOverviews() {
  const user = await requireUser();
  const { buildClusterOverviews } = await import("@/lib/retrieval/clusters");
  await buildClusterOverviews(user.id).catch((e) =>
    console.error("rebuildOverviews failed:", e),
  );
  revalidateAll();
}

/**
 * Repair the chunks whose embedding failed, and only those — embedding calls
 * only, no Claude calls, graph untouched. Best-effort like every other index
 * write here: a provider outage leaves the chunks lexically searchable and the
 * Graph tab still reporting the gap.
 */
export async function backfillEmbeddings() {
  const user = await requireUser();
  await embedMissingChunks(user.id).catch((e) =>
    console.error("backfillEmbeddings failed:", e),
  );
  revalidateAll();
}

/** Read-only: what retrieve() returns for a question. No revalidate needed. */
export async function previewRetrieval(query: string): Promise<RetrievalPreview> {
  const user = await requireUser();
  return retrievalPreview(user.id, String(query ?? "").slice(0, 500));
}

/** One-click merge for a suggested duplicate pair. Stale ids fail soft. */
export async function mergeSuggestedEntities(formData: FormData) {
  const user = await requireUser();
  await mergeEntities(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidateAll();
}

/** "Don't merge": persist that a suggested pair is not the same thing. */
export async function dismissSuggestedMerge(formData: FormData) {
  const user = await requireUser();
  await dismissMerge(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidateAll();
}

export async function createEntityEdge(formData: FormData) {
  const user = await requireUser();
  await addEdge(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("toId") ?? ""),
    String(formData.get("relation") ?? ""),
  );
  revalidateAll();
}

export async function removeEntityEdge(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEdge(user.id, id);
  revalidateAll();
}

// ── helpers ──

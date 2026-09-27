// Shared by the action modules; not a server-action module itself.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { User } from "@prisma/client";
import { indexSource } from "@/lib/retrieval/indexer";

/** The logged-in user, or a redirect to the login page. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/admin");
  return user;
}

/**
 * Chunk + embed + entity-extract a freshly scanned source, inline with the
 * ingest request. Best-effort: an indexing failure must never un-scan the
 * source (retrieval falls back to its summary until a rescan/reindex).
 */
export async function indexScanned(userId: string, sourceId: string): Promise<void> {
  await reindex(`source ${sourceId}`, () => indexSource(userId, sourceId));
}

/**
 * Re-index one origin inline with the admin save that changed it, so edits are
 * retrievable immediately. Best-effort by design: indexing calls the embedding
 * and extraction APIs, and neither may ever cost Blake a saved edit.
 */
export async function reindex(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`reindex(${label}) failed:`, e);
  }
}

/**
 * Duck-typed uploaded-file check. We avoid `instanceof File` because the `File`
 * global isn't defined during Next's build-time page-data collection on some
 * Node runtimes (Railway), which throws a ReferenceError at build. A real
 * FormData upload is a Blob-like with arrayBuffer()/size/name.
 */
export type UploadLike = { arrayBuffer: () => Promise<ArrayBuffer>; size: number; name: string; type: string };

export function isUpload(v: FormDataEntryValue | null): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as UploadLike).arrayBuffer === "function" &&
    typeof (v as UploadLike).size === "number"
  );
}

export function revalidateAll() {
  revalidatePath("/admin/dashboard");
  // The chat renders the very same panels as the dashboard, and is where
  // signed-in owners land — leaving it out meant a save anywhere in the admin
  // left the chat's revealed panels showing stale data.
  revalidatePath("/admin/chat");
  revalidatePath("/");
}

export function err(e: unknown): string {
  return e instanceof Error ? e.message : "operation failed";
}

export function toData(r: {
  title: string | null;
  rawText: string;
  imageUrl: string | null;
  summary: string;
  tags: string[];
  kind: string;
}) {
  return {
    title: r.title,
    rawText: r.rawText,
    imageUrl: r.imageUrl,
    summary: r.summary,
    tags: JSON.stringify(r.tags),
    kind: r.kind,
  };
}

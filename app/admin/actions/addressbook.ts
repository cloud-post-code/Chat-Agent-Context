"use server";

import { redirect } from "next/navigation";
import { saveAddressBookEntry, deleteAddressBookEntry } from "@/lib/addressBook";
import path from "node:path";
import { requireUser, revalidateAll } from "./_shared";

// ── Address book (Agent Behavior → Contacts tab) ────────────────────────────
// Thin auth wrappers; the logic lives in lib/addressBook.ts so it stays testable.

export async function saveAddressBookAction(formData: FormData) {
  const user = await requireUser();
  const error = await saveAddressBookEntry(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? ""),
    details: String(formData.get("details") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    trust: String(formData.get("trust") ?? "public"),
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidateAll();
  if (error) {
    redirect(`/admin/dashboard?tab=contacts&gmail=${encodeURIComponent(error)}`);
  }
}

/**
 * Read sent mail and fold it into the address book. Synchronous inside the
 * button press, like every other ingestion path here — one Claude call per
 * new correspondent, bounded by MAX_CONTACTS_PER_SYNC.
 *
 * The outcome is reported through the same ?gmail= banner the OAuth routes
 * use, including partial results: a pass that hit its cap says so rather than
 * looking complete.
 */
export async function syncGmailContactsAction() {
  const user = await requireUser();
  const { gmailReader } = await import("@/lib/gmail/client");
  const { syncSentContacts } = await import("@/lib/gmail/sync");

  let message: string;
  try {
    const r = await syncSentContacts({ userId: user.id, reader: gmailReader(user.id) });
    if (!r.ok) {
      message = `Sync failed: ${r.error ?? "unknown error"}`;
    } else {
      const parts = [
        `Read ${r.messages} sent message${r.messages === 1 ? "" : "s"}`,
        `${r.created} new contact${r.created === 1 ? "" : "s"}`,
        `${r.updated} updated`,
      ];
      if (r.notesFailed) parts.push(`${r.notesFailed} without a note`);
      message = `${parts.join(" · ")}.${r.error ? ` ${r.error}` : ""}`;
    }
  } catch (e) {
    message = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  revalidateAll();
  redirect(`/admin/dashboard?tab=contacts&gmail=${encodeURIComponent(message)}`);
}

export async function disconnectGmailAction() {
  const user = await requireUser();
  const { disconnectGmail } = await import("@/lib/gmail/client");
  await disconnectGmail(user.id);
  revalidateAll();
  redirect(
    "/admin/dashboard?tab=contacts&gmail=" +
      encodeURIComponent("Gmail disconnected. Contacts already saved are kept."),
  );
}

export async function deleteAddressBookAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteAddressBookEntry(user.id, id);
  revalidateAll();
}

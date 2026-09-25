import { prisma } from "../db";
import { draftContacts, type ContactDraft, type SentMessage } from "./contacts";
import {
  appendNote,
  extractContactNote,
  formatNoteBlock,
  EMPTY_NOTE,
  type ContactNoteExtractor,
} from "./note";

/**
 * One sync pass: read sent mail newer than the cursor, fold it into contacts,
 * and write them into the address book.
 *
 * The reader is an interface, not a Gmail client. That keeps the whole pass
 * provable with fixtures, and it means swapping the transport — IMAP against
 * the Sent folder, a Takeout mbox — is a new implementation of one method
 * rather than a rewrite here. Worth having: Google's docs do not settle
 * whether an unverified-but-Production app keeps a long-lived refresh token
 * for a restricted scope, so the transport may genuinely need to change.
 */

export type SentMailReader = {
  /// Messages sent strictly after `since`; everything when it is null.
  listSentMessages(opts: { since: Date | null }): Promise<SentMessage[]>;
};

export type SyncResult = {
  ok: boolean;
  /// Distinct people written this pass.
  contacts: number;
  /// New address-book rows created.
  created: number;
  /// Existing rows enriched.
  updated: number;
  /// Messages read from the reader.
  messages: number;
  /// Set when the pass ran but some notes failed; the contacts still landed.
  notesFailed: number;
  error?: string;
};

/** Contacts written per pass. Each costs one model call, so the pass is bounded. */
const MAX_CONTACTS_PER_SYNC = 200;

export async function syncSentContacts(opts: {
  userId: string;
  reader: SentMailReader;
  extractNote?: ContactNoteExtractor;
}): Promise<SyncResult> {
  const { userId } = opts;
  const extractNote = opts.extractNote ?? extractContactNote;
  const empty: SyncResult = {
    ok: false,
    contacts: 0,
    created: 0,
    updated: 0,
    messages: 0,
    notesFailed: 0,
  };

  const auth = await prisma.gmailAuth.findUnique({ where: { userId } });
  if (!auth) return { ...empty, error: "Gmail is not connected." };

  let messages: SentMessage[];
  try {
    messages = await opts.reader.listSentMessages({ since: auth.lastSyncedAt });
  } catch (e) {
    // The cursor is deliberately untouched: a failed pass must re-read its
    // window next time rather than silently skipping it.
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }

  const drafts = draftContacts(messages);
  // Newest correspondents first, so a truncated pass keeps the most relevant.
  drafts.sort((a, b) => b.lastContacted.getTime() - a.lastContacted.getTime());
  const batch = drafts.slice(0, MAX_CONTACTS_PER_SYNC);

  let created = 0;
  let updated = 0;
  let notesFailed = 0;
  const now = new Date();

  for (const draft of batch) {
    let note = EMPTY_NOTE;
    try {
      note = await extractNote(draft);
    } catch {
      // A note is an enrichment. Losing one must never lose the contact.
      notesFailed++;
    }
    const block = formatNoteBlock(note, now);
    const wasNew = await upsertContact(userId, draft, block);
    if (wasNew) created++;
    else updated++;
  }

  // Advance only now, after a fully successful pass. Anchored to the newest
  // message actually read rather than wall-clock, so nothing sent while the
  // sync was running is skipped on the next run.
  const newest = messages.reduce((max, m) => (m.date > max ? m.date : max), 0);
  if (newest > 0) {
    const cursor = new Date(newest);
    if (!auth.lastSyncedAt || cursor > auth.lastSyncedAt) {
      await prisma.gmailAuth.update({
        where: { userId },
        data: { lastSyncedAt: cursor },
      });
    }
  }

  return {
    ok: true,
    contacts: batch.length,
    created,
    updated,
    messages: messages.length,
    notesFailed,
    ...(drafts.length > batch.length
      ? {
          error:
            `Wrote the ${batch.length} most recent correspondents; ` +
            `${drafts.length - batch.length} more were found. Sync again to continue.`,
        }
      : {}),
  };
}

/**
 * Create or enrich one contact. Returns true when a row was created.
 *
 * Enrichment is additive on purpose. `details` is also a hand-edited field, so
 * a sync appends to it and never replaces it; `trust` is left entirely alone,
 * because mail volume does not tell you how much someone is trusted.
 */
async function upsertContact(
  userId: string,
  draft: ContactDraft,
  noteBlock: string,
): Promise<boolean> {
  const existing = await prisma.addressBookEntry.findUnique({
    where: { userId_canonicalEmail: { userId, canonicalEmail: draft.canonicalEmail } },
  });

  if (!existing) {
    await prisma.addressBookEntry.create({
      data: {
        userId,
        name: draft.name,
        details: noteBlock,
        email: draft.email,
        phone: "",
        trust: "public",
        canonicalEmail: draft.canonicalEmail,
        source: "gmail",
        messageCount: draft.messageCount,
        firstContacted: draft.firstContacted,
        lastContacted: draft.lastContacted,
      },
    });
    return true;
  }

  const first =
    existing.firstContacted && existing.firstContacted < draft.firstContacted
      ? existing.firstContacted
      : draft.firstContacted;
  const last =
    existing.lastContacted && existing.lastContacted > draft.lastContacted
      ? existing.lastContacted
      : draft.lastContacted;

  await prisma.addressBookEntry.update({
    where: { id: existing.id },
    data: {
      // A name the owner typed outranks one scraped from a header.
      name: existing.name.trim() || draft.name,
      details: appendNote(existing.details, noteBlock),
      email: existing.email.trim() || draft.email,
      source: existing.source === "manual" ? "manual" : "gmail",
      messageCount: existing.messageCount + draft.messageCount,
      firstContacted: first,
      lastContacted: last,
    },
  });
  return false;
}

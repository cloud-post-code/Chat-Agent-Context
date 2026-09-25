import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "../claude";
import type { ContactDraft } from "./contacts";

/**
 * One Claude call per contact per sync: read what Blake actually wrote to this
 * person and say who they are to him.
 *
 * Shaped after lib/retrieval/entities.ts — the prompt builder is exported
 * separately from the call so it is testable without a model, the client is
 * injectable so proofs cost nothing, and any failure returns an empty note
 * rather than throwing. A note is an enrichment; losing one must never lose the
 * contact.
 *
 * Message bodies reach this module and go no further. Only the derived note is
 * persisted. With gmail.readonly granted, that keeps the durable footprint to
 * the note itself.
 */

export type ContactNote = {
  /// 1-3 sentences: who they are and what the correspondence is about.
  summary: string;
  /// Short lowercase labels: "recruiter", "former colleague", "vendor".
  labels: string[];
};

export type ContactNoteExtractor = (draft: ContactDraft) => Promise<ContactNote>;

export const EMPTY_NOTE: ContactNote = { summary: "", labels: [] };

/** Body characters fed to the model per contact. Matches lib/scrape.ts. */
const MAX_NOTE_INPUT_CHARS = 12_000;

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildContactNotePrompt(draft: ContactDraft): string {
  const subjects = draft.subjects.length
    ? draft.subjects.map((s) => `- ${s}`).join("\n")
    : "(no subjects)";

  // Budget the body excerpts across however many we kept, so one long message
  // cannot crowd out the rest.
  const perBody = draft.bodies.length
    ? Math.floor(MAX_NOTE_INPUT_CHARS / draft.bodies.length)
    : 0;
  const bodies = draft.bodies.length
    ? draft.bodies.map((b) => `---\n${b.slice(0, perBody)}`).join("\n")
    : "(no message text)";

  return (
    `These are emails the account owner SENT to one person. Say who that ` +
    `person is to the owner, based only on what is here.\n\n` +
    `Return STRICT JSON with keys:\n` +
    `- "summary": 1-3 sentences on who this person appears to be and what the ` +
    `correspondence is about. Write it as a note in the owner's address book. If ` +
    `the mail does not say, write what little is supported and stop — do not ` +
    `guess a job title, employer, or relationship that is not stated.\n` +
    `- "labels": 0-4 short lowercase tags for the relationship, e.g. ` +
    `"recruiter", "former colleague", "client", "vendor", "friend". Omit ` +
    `rather than invent.\n` +
    `No prose outside the JSON.\n\n` +
    `Person: ${draft.name} <${draft.email}>\n` +
    `Messages the owner sent them: ${draft.messageCount}\n` +
    `First: ${formatDate(draft.firstContacted)}   Last: ${formatDate(draft.lastContacted)}\n\n` +
    `SUBJECTS:\n${subjects}\n\n` +
    `MESSAGE TEXT:\n${bodies}`
  );
}

export const extractContactNote: ContactNoteExtractor = async (draft) => {
  const msg = await claude().messages.create({
    model: claudeModel(),
    max_tokens: 500,
    messages: [{ role: "user", content: buildContactNotePrompt(draft) }],
  });
  const raw = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  try {
    return sanitizeNote(
      JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)),
    );
  } catch {
    return EMPTY_NOTE;
  }
};

export function sanitizeNote(json: unknown): ContactNote {
  const j = json as { summary?: unknown; labels?: unknown };
  const summary = String(j?.summary ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  const labels = (Array.isArray(j?.labels) ? j.labels : [])
    .map((l: unknown) => String(l ?? "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((l: string) => l.length > 1 && l.length <= 40)
    .slice(0, 4);
  return { summary, labels: [...new Set(labels)] };
}

/**
 * Render a note as the dated block appended to AddressBookEntry.details.
 *
 * Appending rather than replacing is deliberate: `details` is also a
 * hand-edited field, and a sync must never destroy something Blake typed.
 */
export function formatNoteBlock(note: ContactNote, when: Date): string {
  if (!note.summary && !note.labels.length) return "";
  const head = `[from sent mail · ${formatDate(when)}]`;
  const tags = note.labels.length ? `\nTags: ${note.labels.join(", ")}` : "";
  return `${head}\n${note.summary}${tags}`;
}

/** Append a note block to existing details, preserving what is already there. */
export function appendNote(details: string, block: string): string {
  const existing = (details ?? "").trim();
  if (!block) return existing;
  if (!existing) return block;
  // An identical block from a re-sync with no new material adds nothing.
  if (existing.includes(block)) return existing;
  return `${existing}\n\n${block}`;
}

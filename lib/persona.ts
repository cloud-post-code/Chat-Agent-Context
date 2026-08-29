import { prisma } from "./db";

/**
 * ── PERSONA · single source of truth ──────────────────────────────────
 *
 * The admin's Persona tab, the save action, and the chatbot's system prompt
 * are all generated from this catalogue.
 *
 * This used to be 21 labeled boxes drawn from two buyer-persona templates.
 * It's now one free-prose field: the templates asked for a lot of detail that
 * either isn't knowable about a real person or reads as padding in a prompt,
 * and a short true paragraph beats a long structured one. The catalogue shape
 * is kept so the storage format, the form, and the prompt stay driven from
 * one place — and so a second field can be added later without touching the
 * save path.
 */

export type PersonaSection = {
  /** Stable storage + form-field key. Never rename without a data migration. */
  key: string;
  label: string;
  /** Shown as the textarea placeholder, so the empty box says what belongs. */
  hint: string;
  rows: number;
};

/** The one-paragraph brief shown above the field in the admin. */
export const PERSONA_BLURB =
  "This is who the chatbot is, in one paragraph. Cover what you'd want a " +
  "stranger to know before talking to you: who you are and what you're " +
  "working on now, what drives you, what you're good at, how you think and " +
  "decide, what makes you skeptical, how you sound when you talk to people, " +
  "and what you're aiming at. Write it as prose in your own voice rather " +
  "than a list of traits — the text goes into the chatbot's prompt exactly " +
  "as you write it, so a short, true paragraph beats a long, padded one. " +
  "Leave it blank and the persona is left out of the prompt entirely.";

/** The storage key for the single persona field. */
const PERSONA_KEY = "persona";

export const PERSONA_SECTIONS: PersonaSection[] = [
  {
    key: PERSONA_KEY,
    label: "Persona",
    hint:
      "Who you are, what you're building, what you care about, how you work, " +
      "and how you come across — in your own words.",
    rows: 12,
  },
];

export type PersonaSections = Record<string, string>;

/**
 * Parse the stored JSON map into a complete `key -> text` map: every catalogue
 * key is present (missing ones as ""), and anything stored under a key that's
 * no longer in the catalogue is dropped — the deploy bootstrap
 * (lib/bootstrap.ts) migrates retired-catalogue rows before runtime ever
 * reads them. Malformed JSON reads as all-empty so a bad row can never break
 * the admin or the chat prompt.
 */
export function safePersonaSections(raw: string | null | undefined): PersonaSections {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    parsed = {};
  }
  const stored =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  const out: PersonaSections = {};
  for (const s of PERSONA_SECTIONS) {
    const v = stored[s.key];
    out[s.key] = typeof v === "string" ? v : "";
  }
  return out;
}

/** Persist the section map, keeping only catalogue keys and trimmed text. */
export async function writePersonaSections(
  userId: string,
  sections: PersonaSections,
): Promise<void> {
  const clean: PersonaSections = {};
  for (const s of PERSONA_SECTIONS) {
    const v = (sections[s.key] ?? "").trim();
    if (v) clean[s.key] = v;
  }
  await prisma.personaConfig.upsert({
    where: { userId },
    update: { personaSections: JSON.stringify(clean) },
    create: { userId, personaSections: JSON.stringify(clean) },
  });
}

/**
 * Render the persona for the chatbot's system prompt. An empty persona renders
 * as "" so the caller can fall back — a bare heading the model then tries to
 * honor is worse than no heading at all.
 */
export function personaPromptBlock(raw: string | null | undefined): string {
  const sections = safePersonaSections(raw);
  const filled = PERSONA_SECTIONS.filter((s) => sections[s.key]?.trim());
  if (!filled.length) return "";
  // A single field is the block itself; several would each need a heading.
  if (PERSONA_SECTIONS.length === 1) return sections[filled[0].key].trim();
  return filled.map((s) => `### ${s.label}\n${sections[s.key].trim()}`).join("\n\n");
}

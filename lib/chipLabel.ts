/**
 * The starter tabs on a public agent page: how many there are, how long their
 * text may be, and what a tab says when nobody wrote its label.
 *
 * A tab is not the question. The question is a whole sentence ("What nail
 * services do you offer?") — that is what gets sent, matched against the
 * preset answers, and shown in the thread. The tab is a three-word handle for
 * it ("Nail services"), so the row stays one line of evenly sized tabs on any
 * screen instead of a wrapping stack of sentences.
 *
 * Pure on purpose: app/Chat.tsx is a client component and imports this, so
 * nothing here may reach for the database.
 */

/** How many starter tabs a page shows — the first N live questions, in order. */
export const CHIP_COUNT = 3;

/** The most words a tab may carry. */
export const CHIP_WORDS = 3;

/**
 * Words that open a question without saying what it is about. Stripped from
 * the front of a derived label, and never left dangling at its end.
 */
const FILLER = new Set([
  "what", "whats", "which", "who", "where", "when", "why", "how",
  "long", "often", "soon", "far",
  "do", "does", "did", "can", "could", "would", "will", "should", "may",
  "is", "are", "was", "am", "be", "have", "has", "get",
  "i", "you", "your", "we", "our", "me", "my", "us", "it", "there",
  "any", "some", "a", "an", "the", "this", "that",
  "tell", "show", "about", "please", "much", "many", "kind", "kinds", "of",
]);

/** Words a label may contain but must not end on ("Coupons or" says nothing). */
const DANGLING = new Set([
  ...FILLER,
  "and", "or", "to", "with", "for", "in", "on", "at", "from", "by", "as",
]);

function words(text: string): string[] {
  return text
    .replace(/[?!.,;:"“”()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function bare(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * A written label, held to the tab's size: punctuation off, three words at
 * most, and no connector left hanging where the cut fell ("Services pricing &").
 * Only connectors are trimmed — a label someone wrote may well end on "us".
 */
export function clampLabel(label: string): string {
  const kept = words(label).slice(0, CHIP_WORDS);
  while (kept.length && ["", "and", "or"].includes(bare(kept[kept.length - 1]))) kept.pop();
  return kept.join(" ");
}

/**
 * A label for a question nobody labelled: drop the lead-in ("What are your…",
 * "How can I…"), keep the next three words, and trim anything left dangling.
 *
 * This is the fallback, not the feature — generated questions arrive with a
 * written label and the owner can type their own under Presets. It replaces an
 * older "first two words" rule that turned real questions into "What nail" and
 * "How much".
 */
export function deriveLabel(question: string): string {
  const all = words(question);
  let start = 0;
  while (start < all.length && FILLER.has(bare(all[start]))) start++;
  const kept = all.slice(start, start + CHIP_WORDS);
  while (kept.length && DANGLING.has(bare(kept[kept.length - 1]))) kept.pop();
  // A question made only of filler ("How are you?") keeps its own first words.
  const label = kept.length ? kept : all.slice(0, CHIP_WORDS);
  return capitalize(label.join(" "));
}

/** What a tab says: the written label when there is one, else a derived one. */
export function chipLabel(row: { label?: string | null; question: string }): string {
  return clampLabel(row.label ?? "") || deriveLabel(row.question);
}

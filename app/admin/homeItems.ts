/**
 * What the Home tab shows, computed from data the dashboard already loads.
 * Pure so it's provable offline; HomePanel only renders these lists.
 */

export type AttentionItem = {
  label: string;
  count: number;
  /** Panel key the row deep-links to (`?tab=`). */
  tab: string;
  /** A short second line: the top questions. */
  detail?: string;
};

export type ChecklistItem = { label: string; done: boolean; tab: string };

export type AttentionInput = {
  flaggedDown: number;
  unreviewed: number;
  topQuestions: ReadonlyArray<{ label: string; count: number }>;
};

/** The needs-attention queue: only rows with something in them. */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [
    { label: "Answers flagged 👎", count: input.flaggedDown, tab: "activity" },
    { label: "Presets waiting for review", count: input.unreviewed, tab: "answers" },
    {
      label: "Most asked this month",
      count: input.topQuestions.length,
      tab: "activity",
      detail: input.topQuestions
        .slice(0, 3)
        .map((q) => `${q.label} (${q.count}×)`)
        .join(" · ") || undefined,
    },
  ];
  return items.filter((i) => i.count > 0);
}

export type ChecklistInput = {
  profile: {
    company_name: string;
    owner_name: string;
    company_phone_number: string;
    company_email: string;
    company_hours: string;
  };
  taglineSource: string;
  cardCount: number;
  /** Enabled knowledge sources with how many items each holds. */
  sources: ReadonlyArray<{ key: string; label: string; count: number }>;
};

/** The setup checklist: every row, done or not, so progress is visible. */
export function checklistItems(input: ChecklistInput): ChecklistItem[] {
  const p = input.profile;
  const profileDone = [
    p.company_name,
    p.owner_name,
    p.company_phone_number,
    p.company_email,
    p.company_hours,
  ].every((v) => v.trim().length > 0);
  return [
    { label: "Fill in your business profile", done: profileDone, tab: "profile" },
    { label: "Confirm your tagline", done: input.taglineSource !== "suggested", tab: "theme" },
    { label: "Build at least one card", done: input.cardCount > 0, tab: "a2ui" },
    ...input.sources.map((s) => ({
      label: `Add something to ${s.label}`,
      done: s.count > 0,
      tab: s.key,
    })),
  ];
}

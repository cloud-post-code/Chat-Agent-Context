# Starter tabs: three tab-sized questions on the home screen

## Summary
The public home screen (`/a/<slug>`) listed every live preset question as a chip
carrying the whole sentence — five of them, wrapping over four rows, crowding the
title and pushing the composer down the first screen. They should read as a row
of tabs: exactly three, tab-sized, three words at most, always in one line on the
first screen.

## Desired Behavior
- The home screen shows at most **three** starter tabs — the account's first three
  live preset questions, in order — in **one row** of equal-width tabs. The row is a
  grid, so it can never wrap into extra lines on any viewport; on a phone a
  three-word label takes its second line *inside* the tab.
- A tab's text is a **label of three words at most** ("Nail services", "Book an
  appointment", "Hours and location"). Tapping it still sends the **whole question**
  ("What nail services do you offer?"), so preset-answer matching, the thread and
  the Activity tab are unchanged. The full question is the tab's `title`.
- Tabs are the size of the admin's own tabs (pill, 14px semibold, 8px vertical
  padding), not sentence-sized chips.
- The same three tabs dock above the composer once a conversation starts.
- Labels are written, not truncated: generation asks the model for
  `{label, question}` pairs and stores the label on the row (`CannedAnswer.label`);
  the owner can edit it under Presets. A row with no label (every row that predates
  this feature, or an owner-written question) gets one derived from the question —
  lead-in words dropped, next three kept, nothing left dangling — never the old
  "first two words" rule that produced "What nail" and "How much".
- Generation writes **three** questions, not five: every generated question is one a
  visitor can tap. Questions past the third (owner-added, or left from before) stay
  live as preset answers; they simply have no tab. The Presets tab says which rows
  are tab 1–3.

## Scope
- `lib/chipLabel.ts` (new, pure): `CHIP_COUNT`, `CHIP_WORDS`, `clampLabel`,
  `deriveLabel`, `chipLabel`.
- `prisma/schema.prisma` + migration `20260920120000_canned_answer_label`:
  `CannedAnswer.label String @default("")` — additive, no backfill.
- `lib/starterQuestions.ts`: three questions with labels; `starterChipsFor` returns
  the first three as `{ q, label }`.
- `lib/canned.ts`, `app/admin/actions.ts`, `app/admin/AnswersPanel.tsx`: the label
  field, clamped on save; tab-position hint per row.
- `app/Chat.tsx`: the tab row (home and dock), capped and clamped again at render.

## Non-Goals
- Still no fallback list: an account with no live questions shows no tabs
  (docs/features/remove-default-starter-questions — explicit product decision).
- No model backfill of labels for existing rows; the derived label covers them and
  Regenerate / the label field improve on it.
- No change to matching, drafting, serving or the card planner (it numbers whatever
  questions exist).
- `app/opengraph-image.tsx` keeps its static chip text.

# Per-chat starter tabs: a different three questions each chat, led by the goals

## Summary
The public home screen (`/a/<slug>`) showed the same three starter tabs to every
visitor, every chat: the account's first three live preset questions, in order.
They should vary — each new chat opens on a different three, chosen so the
conversation starts toward the owner's goals.

## Desired Behavior
- Every live preset question is in a **pool**; the page still shows exactly
  `CHIP_COUNT` (three) tabs, in one row, but which three is decided **per chat**
  from the chat's id (`lib/starterPick.ts`). A new chat, Home, or a page reload
  mints a new id and so a new pick; a saved chat reopened from the sidebar shows
  the tabs it had. The server render and the hydrated page agree, because the
  first chat's id is minted by the server (`initialChatId`).
- The pick is **goal-led**: each preset row carries the owner's goal it steers
  toward (`CannedAnswer.goal`, a snapshot of the goal's text, `""` for a general
  question). A chat takes one question from each goal before any general one;
  which goal leads rotates from chat to chat, and so does the question each goal
  offers. With fewer goals than tabs, the remaining tabs come from the general
  questions (then a second question per goal).
- A pool no larger than the row is shown whole, in the owner's order.
- **Generation writes the pool**: onboarding completion and Presets → Regenerate
  ask the model for `STARTER_POOL_COUNT` (nine) `{label, question, goal}` items,
  where `goal` is the number of the goal in the numbered list the brief shows,
  or 0. The number is resolved to the goal's text on the row; a goal written out
  is accepted when it matches one; anything else is general.
- The **Presets** tab explains the pool and has a Goal select per row (the
  account's live goals, plus the row's own goal if it no longer matches one);
  the "tab 1 of 3" numbering is gone, since no row owns a tab any more.
- `starterChipsFor` returns the whole live pool (`{ q, label, goal }`, owner
  order, bounded at `STARTER_POOL_MAX`), not the first three.

## Scope
- `lib/starterPick.ts` (new, pure, client-safe): `pickStarters`, `hashSeed`,
  `StarterOption`.
- `prisma/schema.prisma` + migration `20260925150000_canned_answer_goal`:
  `CannedAnswer.goal String @default("")` — additive, no backfill.
- `lib/starterQuestions.ts`: `STARTER_POOL_COUNT`, the pool brief with numbered
  goals, goal resolution, `goal` stored on generated rows, `starterChipsFor` as
  the pool.
- `lib/canned.ts`, `app/admin/actions.ts`, `app/admin/AnswersPanel.tsx`,
  `app/admin/panels.tsx`: the goal field, saved trimmed; the panel's copy and
  select.
- `app/a/[slug]/page.tsx`: mints `initialChatId` per request.
- `app/Chat.tsx`: `initialChatId` prop; tabs from `pickStarters(starters, chatId)`.
- Older proofs updated for the pool: starter-tabs, personalized-starter-questions,
  regenerate-starter-questions, remove-default-starter-questions.

## Non-Goals
- Still no fallback list: an account with no live questions shows no tabs
  (docs/features/remove-default-starter-questions).
- No model call per chat: the pool is generated once; picking is pure.
- No change to matching, drafting, serving, the card planner (it numbers whatever
  live questions exist) or the A2UI attachments.
- Existing rows are not re-tagged with goals; Regenerate, or the Goal select,
  does that. Untagged rows are general and still rotate.
- The tabs do not change mid-conversation; the dock shows the same three as the
  home screen of that chat.

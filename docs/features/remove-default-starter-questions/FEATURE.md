# Remove default starter questions

## Summary
Every account is seeded at signup with the same five generic starter questions
("What's your background and past experience?", "Tell me about yourself…"),
and `starterChipsFor` falls back to that same hardcoded list whenever a user
has no usable rows. Onboarding-time generation
(docs/features/personalized-starter-questions) then rewrites the seeds into
business-specific questions. The seeds exist only to fill the gap before that.

Remove them. An account's starter questions are the generated ones or nothing
at all: no generic seeds at signup, no hardcoded fallback on the public page.
A page with no generated questions shows its chat with no chips.

## Desired Behavior
- Signup provisions no canned answers. A brand-new account's Presets tab is
  empty until onboarding generation writes rows or the owner adds their own.
- The public agent page renders only the owner's own enabled preset questions.
  With no rows, it renders no chips — never the generic list.
- Onboarding-time generation writes its questions into an empty table, which
  is now the normal path rather than the re-onboarding path.
- A generation failure or deadline overrun leaves the account with no starter
  questions. The page still renders; the owner can Regenerate or write their
  own under Presets.
- The chip row and hero chip block collapse cleanly when there are no chips —
  no empty box, stray gap, or placeholder text.

## Scope
- `lib/users.ts`: drop the `canned answers` provisioning step.
- `lib/canned.ts`: remove `seedStarterAnswers`.
- `lib/starterQuestions.ts`: `starterChipsFor` returns the owner's rows or an
  empty array; `isUntouchedSeeds` collapses to "no rows exist".
- `app/Chat.tsx`: drop the `shortLabel` map of the five generic questions,
  now unreachable.
- Proof scripts under `docs/features/` that seed via `seedStarterAnswers`
  (`personalized-starter-questions`, `regenerate-starter-questions`,
  `canned-answers-and-brain`) create their fixture rows directly instead.

## Non-Goals
- No fallback list on the public page, and no auto-retry of failed
  generation — an account with no questions stays that way until the owner
  acts. (Explicit product decision.)
- No change to how generation is grounded, deadlined, or written.
- No change to the Regenerate control or the drafting pass.
- No change to `lib/theme.ts`'s `starterQuestions` const, which stays as the
  static chip text on the OG share image (`app/opengraph-image.tsx`).
- No backfill or migration of existing accounts still holding seed rows;
  Regenerate already replaces them.

## Scenarios
- New signup: the account is provisioned with zero canned answers; the
  Presets tab renders its empty state; the public page shows the chat with no
  chips.
- Onboarding completes: generation writes five business-specific questions
  into the empty table; the public page shows exactly those five.
- Generation fails or overruns its deadline: no rows are written, the public
  page renders with no chips, and nothing throws out of the completion path.
- Owner-authored rows: an owner who wrote their own questions sees exactly
  those on the page, unchanged by any of the above.
- Disabled rows only: an account whose every row is disabled shows no chips
  rather than the generic list.
- Tenant isolation: one account having no rows never surfaces another
  account's questions.

## Constraints
- Multi-tenant: every read and write stays keyed by `userId`.
- Removing the seeds must not weaken the guard that protects owner-authored
  rows from being overwritten by generation.
- The public page must render for an account in any row state, including
  none.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

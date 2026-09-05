# Regenerate starter questions

## Summary
Personalized starter questions (docs/features/personalized-starter-questions)
only fire for new accounts at onboarding completion. Existing accounts — and
any owner whose business has changed — need a way to ask for fresh,
business-specific questions on demand. Add a "Regenerate questions" button to
the Presets tab that re-runs generation from today's profile, goals, and
knowledge, without ever destroying answers the owner has made their own.

## Desired Behavior
- The Presets tab offers one Regenerate control at the tab level (not per
  row), alongside the stats header.
- Clicking it makes one LLM call (same grounding as onboarding-time
  generation: profile, brand, goals, knowledge) and rebuilds the question
  list from the result.
- Owner-authored rows are sacred: any row whose answer the owner saved
  (reviewed, non-empty) is kept exactly as it is, in place.
- Every other row — blank rows and unreviewed AI drafts, including the
  generic seeds — is replaced by the generated questions, deduplicated
  against the kept rows' match keys.
- Replacement rows arrive blank and never-drafted, so the existing drafting
  pass writes their answers on the next tab load, exactly like new rows.
- The result is ordered: kept rows first (their existing order), then the
  new questions.

## Scope
- `lib/starterQuestions.ts`: an explicit regenerate entry point.
- A thin server action in `app/admin/actions.ts` (auth + revalidate, like
  `redraftCanned`).
- The Regenerate control in `app/admin/AnswersPanel.tsx`.

## Non-Goals
- No change to the onboarding-time generation, its guard, or the public
  chips source.
- No per-row regenerate (Redraft already covers one row's answer).
- No confirmation dialog (nothing owner-authored can be lost).

## Scenarios
- Happy path: an account with the five generic questions and unreviewed AI
  drafts clicks Regenerate; all five are replaced with business-specific
  questions; the next tab load drafts their answers.
- Mixed rows: an owner who saved two answers and left three drafts clicks
  Regenerate; the two saved rows survive untouched, the three drafts are
  replaced, and no generated question duplicates a kept one.
- Failure: the model call errors or times out; every row is left exactly as
  it was and the dashboard still renders (best-effort action, logged).
- Disabled rows: a saved-then-disabled row is still owner-authored and is
  kept.

## Constraints
- Same provider boundary, injectable client, deadline, and all-or-nothing
  write discipline as `personalizeStarterQuestions`.
- Multi-tenant: everything keyed by `userId`.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

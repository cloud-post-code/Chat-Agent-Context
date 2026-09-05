# Personalized starter questions

## Summary
Every business currently gets the same five hardcoded starter-question chips
(`starterQuestions` in `lib/theme.ts`), seeded as their Preset Answer rows at
signup and shown on their public agent page. Instead, when a user finishes
onboarding (the moment their site is created and their business profile /
extracted knowledge exist), an LLM generates starter questions specific to
that business — the questions a likely prospective customer would actually
ask when learning about them — and those become the user's chips and preset
rows.

## Desired Behavior
- On onboarding completion, one LLM call generates a set of 5 starter
  questions tailored to the business, grounded in what the system knows at
  that moment: business profile (company name, what they do, locations,
  hours), brand identity (tagline, values, tone), agent goals when any exist,
  and a summary of the ingested knowledge.
- Generated questions read like a prospective customer talking to the
  business ("What services do you offer and what do they cost?"), not like
  interview questions to a person. Chip-length (short, one line), no emojis,
  each ending naturally (question mark allowed).
- The generated questions replace the user's seeded generic preset rows, so
  the existing Answers machinery takes over unchanged: the next dashboard
  load auto-drafts answers for them, and exact matches from visitors are
  served without a model call.
- The public agent page's starter chips come from that user's preset rows
  (enabled, in order) rather than the global hardcoded list, so chips and
  presets can never disagree.
- The hardcoded `starterQuestions` list remains only as the fallback: used
  when generation fails, when a user has no preset rows, and for surfaces
  with no user context.

## Scope
- Generation triggered from the onboarding-complete endpoint
  (`app/api/admin/onboarding/complete/route.ts`), for both the site-extraction
  and manual paths.
- Replacement of seeded rows in the `CannedAnswer` table.
- Public page (`app/a/[slug]/page.tsx`) chips sourced per user.

## Non-Goals
- No regeneration for already-onboarded users (existing accounts keep their
  current questions; Redraft/edit on the Answers tab remains the tool there).
- No change to the matching, drafting, or serving logic in `lib/canned.ts`,
  `lib/answerDrafts.ts`, or `lib/brain.ts`.
- No admin UI for re-running generation (can be a later feature).
- No change to `app/opengraph-image.tsx` (global surface, keeps the fallback
  list).

## Scenarios
- Happy path: a new user signs up (generic rows seeded), completes onboarding
  with a site extraction; the generic rows are replaced by five
  business-specific questions; the dashboard's next load drafts answers for
  them; the public page shows the new chips.
- Manual path: a user who set up manually (sparse profile, little knowledge)
  still gets questions generated from whatever profile fields they filled;
  quality degrades gracefully rather than blocking.
- User already customized: a user who wrote or edited any preset answer, or
  added/deleted rows, before completing onboarding is left entirely alone —
  replacement only happens when the rows are exactly the untouched generic
  seeds (blank answers, never drafted, never edited).
- Generation failure: the LLM call errors or returns unusable output; the
  generic seeds stay in place, onboarding completion still succeeds, and the
  failure is logged. Nothing is half-replaced — the swap is all-or-nothing.
- Onboarding re-run: an admin resets a user's onboarding (`onboardedAt`
  cleared) and the user goes through it again; generation applies the same
  untouched-seeds guard, so customized answers are never destroyed.
- Public page fallback: a user whose preset rows are all disabled or deleted
  still gets chips (the hardcoded fallback list).

## Constraints
- The LLM call must go through the existing Anthropic client pattern
  (`lib/claude.ts`) with an injectable client boundary, like
  `lib/answerDrafts.ts`, so the proof can observe the prompt and count calls.
- Onboarding completion must never fail or hang on generation: bound it with
  a deadline consistent with the drafting pass's pattern, and degrade to the
  generic seeds past it.
- Questions must be deduplicated through `normalizeQuestion` before writing,
  since `matchKey` is unique per user.
- Multi-tenant discipline: everything keyed by `userId`; no cross-tenant
  reads.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

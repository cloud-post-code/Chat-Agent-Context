# Proof Plan — Personalized starter questions

## Definition Of Done
- Completing onboarding for a user whose preset rows are exactly the untouched
  generic seeds replaces those rows with LLM-generated, business-specific
  questions in **one** model call, and the prompt that call received contains
  the user's real profile and goals — so a hardcoded question list cannot pass.
- The replacement is all-or-nothing: a model failure or a deadline overrun
  leaves the generic seeds fully intact and never breaks onboarding
  completion.
- A user who touched their preset rows in any way (wrote/edited an answer,
  was drafted, added or removed a row) is left entirely alone: **zero** model
  calls, rows byte-identical.
- Duplicate or colliding generated questions never throw the unique
  `matchKey` constraint out of the flow.
- The public page's chips come from the user's own preset rows (enabled, in
  order); a user with no usable rows falls back to the hardcoded list.
- Another tenant's rows are never read or written.
- The database returns to its pre-run baseline.

## Primary Proof
Type: integration (internal contract — the claim is about what reaches the
model and what lands in the tenant's rows, observable only at the provider
boundary and in the database; same style as ai-drafted-answers)

Command:
```bash
npx tsx docs/features/personalized-starter-questions/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`; the script loads
`.env` itself). It creates throwaway users, profiles, goals, and preset rows
(ids/keys prefixed `starterproof`), drives the real personalization pass and
the real chip source with an injected client double at the Anthropic
boundary, asserts, then deletes everything it made.

Expected evidence:
- Assertions printed `PASS` for: one-call replacement of untouched seeds;
  prompt grounded in the seeded profile's distinctive company name and goal
  text; generated rows written blank/enabled/ordered with normalized
  `matchKey`s; customized-user guard (0 calls, rows unchanged); broken-client
  degradation (seeds intact, no throw); duplicate-question dedup; chips
  reflect the generated questions; chips fall back to the hardcoded list when
  no rows are usable; the other tenant untouched; row counts back to
  baseline.

Secondary guards:
- Repo gate (`$HOME/.claude/scripts/gate`) stays green.

## Environment And Data
- Local dev Postgres reachable via `.env` `DATABASE_URL`.
- No provider credentials needed: the Anthropic client is injected as a
  double; embedding keys are blanked so retrieval (if any) stays local.
- All fixtures are created and removed by the script (`starterproof` prefix).

## Anti-Gaming Constraints
- Only the outermost Anthropic client may be doubled; the personalization
  pass, persistence, guard logic, dedup, and chip source run for real.
- The grounding assertion must read the prompt off the double — asserting the
  output rows alone is insufficient, since a template could fake them.
- The proof must not weaken `FEATURE.md` scenarios (guard, failure,
  re-onboarding safety) to pass.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Question *quality* (do the questions read like a prospective customer?) is
  a judgment call: the proof asserts provenance, shape, and count, not
  wording. Spot-check by onboarding a test account against a real site.
- The onboarding-complete HTTP route is a thin auth wrapper around the proven
  pass; it is exercised live, not in this script (auth-bound session).

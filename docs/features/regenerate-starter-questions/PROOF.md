# Proof Plan — Regenerate starter questions

## Definition Of Done
- An explicit regenerate replaces blank rows and unreviewed AI drafts with
  generated, business-specific questions in **one** grounded model call.
- Owner-authored rows (reviewed, non-empty answer — enabled or not) survive
  byte-identical, keep their lead position, and generated duplicates of their
  questions are dropped.
- Replacement rows are blank, enabled, and never-drafted, so the existing
  drafting pass picks them up.
- A model failure or deadline overrun leaves every row exactly as it was and
  never throws out of the action path.
- The Presets tab renders one tab-level Regenerate control wired to a server
  action.
- Another tenant's rows are never touched; the database returns to baseline.

## Primary Proof
Type: integration (internal contract at the provider/database boundary plus a
server-render assertion of the admin surface — same style as
personalized-starter-questions)

Command:
```bash
npx tsx docs/features/regenerate-starter-questions/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`; the script loads
`.env` itself). Creates throwaway users/rows prefixed `regenproof`, drives the
real regenerate pass with an injected Anthropic double, renders the real
`AnswersPanel`, asserts, then deletes everything it made.

Expected evidence:
- `PASS` assertions for: one-call replacement of drafts/blanks; grounding
  (seeded company + goal text present in the prompt the double received);
  owner-authored rows kept byte-identical with dedup against them; blank/
  enabled/never-drafted replacements in kept-then-generated order;
  broken-client no-op; tenant isolation; rendered Regenerate control; row
  counts back to baseline.

Secondary guards:
- Repo gate (`$HOME/.claude/scripts/gate`) stays green.

## Environment And Data
- Local dev Postgres via `.env` `DATABASE_URL`; no provider credentials
  (client doubled at the Anthropic boundary; embedding keys blanked).
- All fixtures created and removed by the script (`regenproof` prefix).

## Anti-Gaming Constraints
- Only the outermost Anthropic client may be doubled; guard, dedup,
  persistence, and the panel render run for real.
- Grounding must be read off the double's received prompt, not inferred from
  output rows.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The server action itself is a thin auth + revalidate wrapper around the
  proven pass; clicking the live button is a manual spot-check (auth-bound
  session).

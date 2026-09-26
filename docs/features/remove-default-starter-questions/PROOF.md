# Proof Plan — Remove default starter questions

## Definition Of Done
- `provisionUserDefaults` creates **zero** canned answers for a new account;
  every other starter catalog (profile, persona, theme, ingestion sources) is
  still provisioned.
- `seedStarterAnswers` no longer exists in `lib/canned.ts`, and no source file
  outside `docs/` references it.
- `starterChipsFor` returns the owner's enabled rows in order, and `[]` — never
  the hardcoded list — when the account has no usable rows (no rows at all, or
  only disabled ones).
- The five generic questions from `lib/theme.ts` reach no public page: with an
  empty table, the rendered public page contains none of their text.
- Onboarding-time generation still writes its questions into an empty table,
  and its guard still refuses to overwrite owner-authored rows.
- A generation failure or deadline overrun leaves zero rows and does not throw.
- `app/Chat.tsx` renders with `starters={[]}` without crashing and emits no
  chip buttons.
- `lib/theme.ts`'s `starterQuestions` const still exists and is still used by
  `app/opengraph-image.tsx`.
- Another tenant's rows are never touched; the database returns to baseline.

## Primary Proof
Type: integration (internal contract at the provisioning/database boundary
plus a server-render assertion of the real public page component — same style
as personalized-starter-questions and regenerate-starter-questions)

Command:
```bash
npx tsx docs/features/remove-default-starter-questions/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`; the script loads
`.env` itself). Creates throwaway users prefixed `nodefaultproof`, drives real
`provisionUserDefaults`, real `starterChipsFor`, and real onboarding
generation with an injected Anthropic double, renders the real `Chat`
component, asserts, then deletes everything it made.

Expected evidence:
- `PASS` assertions for: zero canned answers after provisioning, with the
  other starter catalogs still populated; `starterChipsFor` returning `[]` for
  an account with no rows and for one whose rows are all disabled; none of the
  five generic question strings present in the rendered public page for an
  empty account; generation writing into an empty table and the public page
  then showing exactly those questions; the guard still declining to overwrite
  an owner-authored row; a failing/timing-out client leaving zero rows without
  throwing; `Chat` rendering with `starters={[]}` and emitting no chip button;
  `seedStarterAnswers` absent from `lib/canned` exports and unreferenced
  outside `docs/`; `starterQuestions` still exported from `lib/theme` and
  still imported by `app/opengraph-image.tsx`; tenant isolation; row counts
  back to baseline.

Secondary guards:
- Repo gate (`$HOME/.claude/scripts/gate`) stays green — covers typecheck for
  the removed export's former call sites and the updated sibling proof scripts.

## Environment And Data
- Local dev Postgres via `.env` `DATABASE_URL`; no provider credentials
  (client doubled at the Anthropic boundary; embedding keys blanked).
- All fixtures created and removed by the script (`nodefaultproof` prefix).

## Anti-Gaming Constraints
- Only the outermost Anthropic client may be doubled; provisioning, the
  guard, persistence, and the `Chat` render run for real.
- The "no generic questions leak" assertion must be made against the rendered
  public page output and the five strings read from `lib/theme.ts` at runtime
  — not against a hardcoded copy of them, and not merely by counting rows.
- The absence of `seedStarterAnswers` must be checked against the real module
  namespace and a repo grep, not asserted in prose.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- That the collapsed chip row leaves no visual gap on the live page is a
  one-time visual spot-check; the proof asserts only that no chip buttons are
  emitted.

# Proof Plan — Admin user management

## Definition Of Done
- The account-admin module (`lib/accountAdmin.ts`) exists and every behavior
  below holds against the real local Postgres.
- A disabled account is refused by the shared eligibility check that the login
  action and `currentUser()` both consult, so disabling revokes both new
  logins and live sessions.
- No proof step deletes or mutates rows owned by real (non-seeded) users.

## Primary Proof
Type: integration (DB-backed internal contract, the repo's `proof.ts` pattern)

Command:
```bash
npx tsx docs/features/admin-user-management/proof.ts
```

Runs against the local dev Postgres from `.env` `DATABASE_URL` (the script
loads `.env` itself, like the other feature proofs). Seeds throwaway users
(emails prefixed `useradminproof-`), exercises the real `lib/accountAdmin.ts`
code paths, asserts, and cleans up.

Expected evidence — all assertions PASS:
1. **Listing & search** — `listAccounts` returns the seeded users with name,
   email, slug, createdAt, onboarding and disabled status; a text query
   matches on name, email, or slug; pagination returns disjoint pages and an
   accurate total.
2. **Edit with validation** — `updateAccount` renames a user; changing email
   to another account's email returns a readable error (not a throw); same
   for a slug collision; a dirty slug is normalized through the existing
   `slugify` rules and reserved slugs are refused.
3. **Disable revokes access** — after `setAccountDisabled(id, true, actor)`,
   the row has `disabledAt` set and `accountActive(user)` is false — the
   check `currentUser()` and the login action share. Re-enabling restores it.
4. **Self-disable refused** — an operator disabling their own id gets an
   error and the row is untouched.
5. **Replacement password** — `issuePassword` returns a generated password
   that verifies via `lib/auth.ts` `verifyPassword` against the stored hash;
   the previous password no longer verifies.
6. **Operator gate** — with `OPERATOR_EMAILS` set, only listed emails (case-
   insensitive) pass `isOperator`; with it unset, exactly the founding user
   passes.
7. **Disable is non-destructive** — a disabled user's owned rows (sources)
   are byte-count identical before and after disable/enable.
8. **Cleanup** — seeded users and their rows are removed; table counts return
   to the pre-run baseline.

Secondary guards (not proof):
- `npx tsc --noEmit` clean.
- `npx next lint` clean on touched files.
- Static check: `lib/auth.ts` `currentUser` and the login action in
  `app/admin/actions.ts` both consult the shared disabled-eligibility check.

## Environment And Data
- Local Postgres reachable via `.env` `DATABASE_URL`, schema migrated
  (includes the new `User.disabledAt` column).
- No external providers, credentials, or network calls.

## Anti-Gaming Constraints
- No mocks: assertions read persisted state back from Postgres.
- Password assertions must round-trip through the real scrypt
  `hashPassword`/`verifyPassword` pair, not string comparison.
- The proof must not be weakened to pass (e.g. dropping the collision or
  self-disable cases).

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Red Expectation
Before implementation the script fails at import time:
`lib/accountAdmin.ts` does not exist.

## Manual Gaps
- Nav visibility (Users tab hidden from non-operators) and the panel's
  rendered UI are verified manually in the running app; the repo has no
  browser E2E harness yet.

# Proof — Bulk site builder

## Definition Of Done

- `startBulkBuild` (lib/bulkBuild.ts) takes a pasted link list, normalizes and
  dedupes it, creates one username-based account per site, runs the site
  extraction with the configured concurrency, auto-saves every stage's result
  through `saveOnboardingReview`, stamps `onboardedAt`, and isolates failures.
- Bulk accounts have a username (no `@`), a ≥12-char temporary password, a
  hostname slug, and log in through the real login credential check.
- `POST/GET /api/admin/bulk-build` refuse anyone who is not an operator and
  serve the build's wire payload (credentials included) to the operator.
- The Bulk builder panel is an operator-only Settings subtab.

## Primary Proof

Type: integration (real Postgres under throwaway tenants; the site
extraction — crawler + model — is injected, everything after it is real)

Command:

```bash
npx tsx docs/features/bulk-site-builder/proof.ts
```

Runs against the local dev Postgres (`DATABASE_URL` from `.env`, loaded by the
script). Starts a build over a fixture link list with an injected
`extract` runner that yields canned stage results (one site succeeds fully,
one throws at the theme stage, one throws at the core stage), waits for the
build to settle, then checks the assertions below through Prisma and the real
route handlers / credential check, and deletes every account it created.

Expected evidence: every line `PASS`, `All checks passed.`, exit 0.

### Assertions

1. Link parsing: newline/comma/space separated input, `https://` added,
   duplicates (same host, trailing slash, case) collapse, a malformed entry
   is dropped and reported; order preserved.
2. Accounts: each site's user exists with a username without `@`, the stored
   email is `<username>@<reserved domain>`, slug derived from the hostname,
   `passwordHash` is scrypt, and the build payload's password is ≥ 12 chars.
3. Auto-approve: the fully successful site's Profile carries the canned
   company name/phone/email, the address + hours text, its social links,
   gallery Photo rows (from `/api/uploads/...` srcs), ThemeConfig colors /
   fonts / radius, PersonaConfig tagline + brand values, and the account's
   display name is the extracted company name; `onboardedAt` is set.
4. Failure isolation: the theme-throwing site is `done_with_warnings` with
   its profile saved and theme at defaults; the core-throwing site is
   `failed`, its account no longer exists, and the other two still do.
5. Concurrency: with `BULK_BUILD_CONCURRENCY=1` the injected runner never
   observes two sites running at once; with 2 it observes two.
6. Login: `authenticate(username, password)` from the build returns the user;
   the wrong password and an unknown username return null; the same email
   login path still works for an ordinary account.
7. Routes: `POST /api/admin/bulk-build` answers 401 signed out and 403 for a
   non-operator, 200 with `{buildId}` for the operator (runner injected via
   the registry's test hook); `GET ...?buildId=` returns the rows with
   username, password, slug, status; an unknown id is 404.
8. Nav: `NAV_GROUPS` Settings contains `bulk` flagged `operator`, and
   `fixedPanelEntries(false)` omits it while `fixedPanelEntries(true)` has it.

Secondary guards:
- `npx tsc --noEmit` and `npm run lint` clean.

## Environment And Data
- Local Postgres from `.env`; no model key needed (runner injected).
- `docs/features/bulk-site-builder/crosscheck.ts --urls a,b [--base URL]
  [--keep]` drives the REAL route on a running dev server (the pipeline needs
  the Next runtime for next/font) with a session minted for the founding
  user, prints the rows and the built tenant's row counts; used for the live
  check, not the primary proof.

## Anti-Gaming Constraints
- Only the extraction runner (crawler + model boundary) is injected. Account
  creation, the save module, the build registry, the route handlers, the
  credential check and Prisma are the real code.
- The proof must not import the onboarding stage functions to fake saves;
  saves happen through the orchestrator only.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The panel is not clicked through by Claude (operator login required —
  Claude does not enter passwords). The live crosscheck covers the pipeline.

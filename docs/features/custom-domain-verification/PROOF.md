# Proof Plan — Custom domain verification

## Definition Of Done
- `CustomDomain` carries `verificationToken`, `status`, `lastCheckedAt`,
  `lastError` and `verifiedAt`, with a checked-in migration.
- The token is generated with `node:crypto` `randomBytes`, is per-domain, and is
  stable across repeated checks (a failed check never rotates it).
- `lib/customDomains/verify.ts` owns every transition through one `advance()`
  function, over an injectable DNS seam (`node:dns/promises` in production, a
  scripted resolver in the proof) — the `ModelClient`/`llm` seam idiom the repo
  already uses in `lib/brain.ts` and `lib/onboarding/services.ts`.
- The TXT check passes only on exact equality with the stored token, compared in
  constant time, and distinguishes: record missing, NXDOMAIN, wrong value, and
  lookup failure — four states, four messages.
- The routing check accepts a CNAME toward the platform ingress and an
  A/AAAA record that resolves toward it (apex domains cannot hold a CNAME), and
  reports "ownership proved, traffic not pointed" as its own state.
- Transitions are exactly: `pending_dns` → `pending_certificate` (TXT +
  routing pass) → `live` (certificate confirmed). `failed` carries `lastError`.
  Every call stamps `lastCheckedAt`.
- A transient lookup failure (timeout, SERVFAIL) leaves `status` untouched — it
  never demotes a `live` domain and never marks a valid domain `failed`.
- Re-verification demotes a `live` domain whose TXT record has been removed or
  whose routing has been repointed away.
- Every lookup has a bounded timeout.
- Checks are rate limited per user and per domain; over the limit returns a
  try-again message without performing a lookup.
- Operator can list domains awaiting a certificate.

## Primary Proof
Type: integration (repo-native proof script over the real DB and the real
`advance()` state machine, with only the outermost DNS resolver doubled at its
injectable seam)

Command:
```bash
npx tsx docs/features/custom-domain-verification/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: a throwaway user and its
  `CustomDomain` rows, with `status`, `lastError` and `lastCheckedAt` read back
  from the database after each `advance()` — never from the return value alone.
- The full lifecycle driven by changing only what the scripted resolver returns:
  no records → `pending_dns`; TXT only → still `pending_dns` with a
  routing-specific message; TXT + CNAME → `pending_certificate`; certificate
  present → `live`.
- Each distinguishable failure asserted by its own message: missing record,
  NXDOMAIN, wrong value.
- Token stability asserted across a failing check.
- A timeout injected at the resolver leaves a `live` row `live`.
- Removing the TXT record from the scripted resolver demotes a `live` row.
- Rate limiting asserted by the resolver recording zero lookups for the
  over-limit call.
- Red run recorded before implementation: the script fails to import
  `lib/customDomains/verify.ts`.

Secondary guards:
- `npx tsc --noEmit` clean.
- `grep` shows the token compared with `timingSafeEqual`, not `===`.
- Migration checked in under `prisma/migrations/`.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), loaded by the script itself.
- **No network.** The DNS resolver is the injected scripted double, so the proof
  is deterministic and makes no outbound lookups.
- All rows are created under a throwaway user
  (`proof-domain-verification@example.invalid`) and deleted in a `finally`.

## Anti-Gaming Constraints
- Only the outermost DNS resolver may be doubled. `advance()`, the status
  transitions, the token comparison, the rate limiter and all persistence must
  be the real code.
- Status assertions must read the row back from Postgres, not trust `advance()`'s
  return value.
- The "transient failure does not demote" assertion must inject a real thrown
  timeout at the resolver seam, not a special-cased status input.
- The distinguishable-failure assertions may not be satisfied by one generic
  message; each must differ.
- Rate limiting may not be proven by asserting an error string alone — the
  scripted resolver must record that no lookup was attempted.
- Do not weaken `FEATURE.md`: in particular, do not make the TXT check accept a
  substring or prefix match, and do not let `pending_certificate` serve traffic.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- A real registrar, real DNS propagation, and Railway actually issuing a
  certificate for a live hostname. None is reproducible locally or
  deterministically; the scripted resolver proves our side of every transition,
  and the first real domain is verified by hand on the deployment.
- Visual check of the records display and copy controls in the Domains panel.

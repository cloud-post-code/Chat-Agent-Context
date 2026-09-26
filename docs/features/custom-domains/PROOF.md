# Proof Plan — Custom domains

## Definition Of Done
- `CustomDomain` exists as a Prisma model with a checked-in migration (never
  `db push`): unique normalized `hostname`, required `userId` FK, and the
  `status` column the verification feature drives.
- `lib/customDomains.ts` is a data-and-rules module over Prisma:
  `normalizeHostname`, `addDomain`, `listDomains`, `removeDomain`, and
  `resolveHost` — every write scoped by `userId`.
- `normalizeHostname` lowercases, strips scheme, port, path, userinfo and a
  trailing dot, and rejects: empty input, single-label hosts, `localhost`, bare
  IPv4/IPv6, hosts over 253 characters, labels over 63 characters, invalid
  characters, and the configured platform domain. Rejections return a reason,
  never throw.
- `addDomain` rejects a hostname already held by any user, with an error that
  does not disclose the holder.
- `resolveHost` returns the owning `User` for a `live` hostname and `null` for
  every other status, for an unknown hostname, and for malformed input. It
  never falls back to `foundingUser()`.
- A live custom domain's root serves the same tenant page as `/a/<slug>`, by
  rewrite (URL stays on the custom domain), with the resolved tenant's real
  `slug` passed to `<Chat>` so `/api/chat`, `/api/booking` and `/api/order`
  keep resolving that tenant.
- `/admin`, `/signup` and `/agent` on a custom domain redirect to the platform
  domain; `/api/*`, `/api/uploads/*` and `/.well-known/*` still answer.
- Middleware performs no database work when the request host is the platform
  domain.
- A Domains panel exists in `app/admin/panels.tsx`, built once and used by both
  the dashboard and admin chat, matching the Booking panel idiom.

## Primary Proof
Type: integration (repo-native proof script over the real DB, with the HTTP
layer driven black-box against a running dev server — the `scripts/proof-multi-tenant.ts`
precedent, which already drives real requests at `PROOF_BASE_URL`)

Command:
```bash
npx tsx docs/features/custom-domains/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: two throwaway users and their
  `CustomDomain` rows.
- Normalization and rejection assertions run against the real
  `normalizeHostname`, including every rejected shape listed above.
- `resolveHost` assertions for each status value, driven by flipping the real
  row's status — not by stubbing the function.
- With a dev server reachable at `PROOF_BASE_URL`, a request carrying the live
  custom domain's `Host` returns the tenant's page (asserted by a distinctive
  tenant string in the HTML) and a 200; the same request with an unregistered
  host returns 404; a request for `/admin` on the custom domain returns a
  redirect to the platform host. When no server is reachable the HTTP block
  reports `SKIP` and the script still fails on any non-HTTP assertion.
- Red run recorded before implementation: the script fails to import
  `lib/customDomains.ts`.

Secondary guards:
- `npx tsc --noEmit` clean.
- Migration checked in under `prisma/migrations/`; `grep` shows no `db push`
  added to `npm start`.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), loaded by the script itself
  the way sibling proofs do (tsx does not load `.env`).
- `PROOF_BASE_URL` (default `http://localhost:3100`) for the HTTP block, matching
  `scripts/proof-multi-tenant.ts`.
- No network beyond that local server: this feature performs no DNS work.
- All rows are created under throwaway users
  (`proof-custom-domains-a@example.invalid`, `…-b@example.invalid`) and deleted
  in a `finally`.

## Anti-Gaming Constraints
- `resolveHost` must be the real function reading the real row; the proof may
  not stub it, and may not assert host resolution by re-implementing the lookup.
- The HTTP assertions must go through the real server over a real `Host` header.
  Calling the page component directly does not prove the rewrite.
- The "unknown host is not served" assertion may not be satisfied by the absence
  of a route; it must observe a 404 while a *known* live host on the same server
  returns 200, so the two are distinguished.
- Cross-tenant isolation must be asserted with two distinct tenants, each with
  its own domain, and each host must serve only its own tenant's content.
- Do not weaken `FEATURE.md` — in particular do not make `resolveHost` serve
  non-`live` statuses to make an assertion pass.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Real DNS pointed at a real deployment, and Railway certificate issuance for a
  live hostname — neither is reproducible locally; the sibling verification
  feature owns the checks that approximate them.
- Visual click-through of the Domains panel (add/remove, records display) —
  client component state, verified in the browser preview; the actions it calls
  are proven above.

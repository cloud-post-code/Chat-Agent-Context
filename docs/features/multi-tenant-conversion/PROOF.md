# Proof — multi-tenant conversion

## Primary proof

```
npx tsx scripts/proof-multi-tenant.ts
```

An end-to-end script against a running dev server (`PROOF_BASE_URL`, default
`http://localhost:3000`) and the dev database. It must print `PROOF PASS` after:

1. Signing up two fresh users (A and B) via the real `/signup` flow.
2. Logging each in and ingesting one distinct text source each through the
   admin ingest path.
3. Asking each user's agent page chat (`/api/chat` with that user's slug) a
   question answerable only from that user's own source, and asserting the
   answer contains the user's own fact and not the other user's.
4. Cross-tenant probes: with A's session cookie, hitting admin mutations and
   `app/api/admin/*` routes using B's resource ids — every probe must return
   403/404 (or an equivalent refusal that provably does not touch B's data).
5. Asserting the directory page lists both users' agent pages.
6. Asserting the founding user still owns every pre-existing row (backfill
   counts match).

## Secondary checks (not proof)

- `npm run lint` and `npm run build` pass clean.
- Backfill rehearsal: before/after row counts per table on a copy of the real
  database, all rows owned by the founding user, zero rows lost.

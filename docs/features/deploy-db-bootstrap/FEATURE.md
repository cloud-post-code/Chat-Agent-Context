# Feature — Deterministic DB bootstrap on deploy, and the legacy prune

## What

**Bootstrap.** `instrumentation.ts` (Next's server-startup hook) runs
`bootstrapDatabase()` from `lib/bootstrap.ts` on every deployment/server
start, right after `prisma db push` has applied the schema. It is idempotent
and best-effort (a DB hiccup never blocks boot), so the database begins —
and stays — in the correct structure at every point in time:

- seeds the starter **ingestion sources**, **cards**, and **canned
  answers** into empty tables (the same into-empty-only semantics as before,
  now at boot instead of lazily on first dashboard load — the dashboard
  becomes a plain reader);
- **migrates legacy persona storage**: personaSections JSON written under
  the retired 21-section catalogue is folded into the single `persona` field
  and rewritten in the current shape;
- **migrates the legacy `Profile.linkedin` column**: a non-empty value is
  prepended to `socials` (if not already there) and the column is cleared.
  The column itself stays in the schema one release (dropping it in the same
  release would destroy the value on `db push` before the migration runs);
  it is commented for removal next release.

**Prune.** With migrations owning the old shapes, runtime legacy code goes:

- `LEGACY_CONTENT_TABS` (`knowledge` → `links` deep-link shim) removed from
  `contentTabs.ts`; an ancient `?tab=knowledge` link now just opens the
  dashboard default. The two proofs that asserted the shim are updated to
  assert its absence.
- `LEGACY_SECTIONS` + `foldLegacy` removed from `lib/persona.ts` —
  `safePersonaSections` reads only the current catalogue. The fold logic
  lives solely in the bootstrap migration. The persona-sections proof is
  updated accordingly.
- The dashboard's linkedin→socials render shim, the `saveDetails` linkedin
  write, `connectBlock`'s linkedin line in `lib/knowledge.ts`, and the
  seed's linkedin field are removed.
- The dashboard's lazy `seedStarter*` calls are removed (bootstrap owns
  seeding); `draftBlankAnswers` stays lazy because it calls the model.

**Deliberately kept (not DB legacy):**
- A2A `LEGACY_METHODS` and the `/.well-known/agent.json` legacy discovery
  path — protocol back-compat for external agent clients, mandated by the
  A2A spec's transition guidance; removing them breaks interop, not cleanup.
- `clearOriginChunks`' empty-`originId` matching in the indexer — active
  defensive deletion that prevents duplicate chunks for rows indexed before
  the origin columns existed.

## Why

"Everything begins in the database, in the correct structure, on deploy" —
seeding and migration become a deterministic boot step rather than
side-effects of visiting the admin, and the runtime no longer carries
old-shape compatibility branches.

## Out of scope

Dropping the `Profile.linkedin` column (next release, after the migration
has run in production).

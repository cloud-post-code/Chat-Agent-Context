# Proof — Deploy DB bootstrap + legacy prune

## Primary proof command

```
npx tsx docs/features/deploy-db-bootstrap/proof.ts
```

Local dev Postgres via `.env`; zero model calls. Profile fields it touches
are snapshotted and restored in a `finally`; seeded rows are checked by
count deltas only (the tables are already non-empty locally, which is
exactly the idempotence case).

## Assertions (all must pass)

1. **`bootstrapDatabase()` is idempotent on a populated DB**: running it
   twice changes no row counts in IngestionSource or CannedAnswer.
2. **`foldLegacySections` folds retired-catalogue text** into one labeled
   prose block, and returns "" for current-shape input.
3. **Persona migration round-trip**: a Profile whose `personaSections`
   holds only legacy keys is rewritten by `bootstrapDatabase()` to the
   current single-key shape, preserving the text; a current-shape value is
   left byte-identical.
4. **Linkedin migration round-trip**: a non-empty `Profile.linkedin` is
   prepended to `socials` exactly once (re-running does not duplicate it)
   and the column is cleared.
5. **The runtime is pruned** (source-level): `contentTabs.ts` has no
   `LEGACY_CONTENT_TABS`; `persona.ts` has no `foldLegacy`/`LEGACY_SECTIONS`;
   the dashboard has no linkedin shim and no `seedStarter` calls;
   `actions.ts` no longer writes `linkedin`; `knowledge.ts` no longer
   formats it.
6. **`safePersonaSections` now drops legacy keys on read** instead of
   folding them (fold is migration-only).
7. **`instrumentation.ts` wires the bootstrap** and guards on the nodejs
   runtime.
8. **The repointed proofs pass**: `resolveAdminTab("knowledge")` passes
   through (no shim) — asserted here and in the two updated tab proofs.

## Red expectation

Before implementation, `lib/bootstrap.ts` does not exist — the import fails
and the proof exits non-zero.

## Secondary checks (not proof)

- Re-run all six earlier proofs (two of them updated by this feature)
- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Dev server boot log shows the bootstrap ran once at startup

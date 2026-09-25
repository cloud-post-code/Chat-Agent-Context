# Proof — Per-source split mode

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/per-source-split-mode/proof.ts
```

Local dev Postgres via `.env`; zero model calls. `proof-psm-` markers,
`finally` cleanup.

## Assertions (all must pass)

1. **`SPLIT_MODES` is `split | single`** and `saveIngestionSource` rejects
   an unknown mode; omitting it defaults to `split`.
2. **A `single` source never splits**: a file ingest with a fake splitter
   that WOULD return 3 items stores exactly one summarized row — and the
   splitter client is never called (call-count 0, so no model spend).
3. **A `split` source still splits** through the same path (3 rows).
4. **Flipping a source to `single` via `saveIngestionSource` changes
   behavior** on the next ingest (round-trip through the edit path's lib).
5. **The builder draft carries the mode**: `validateDraft` keeps a valid
   `splitMode`, coerces junk to `split`; the builder system prompt teaches
   setting `single` when the admin asks for one-item-per-upload.
6. **The UI is wired** (source-level): the edit page and manual create form
   post a `splitMode` select; `updateIngestionSourceAction` and
   `createIngestionSourceAction` forward it; the builder test pane shows
   the draft's mode.

## Red expectation

Before implementation, `SPLIT_MODES` does not exist in
`lib/ingestionSources.ts` — the import fails and the proof exits non-zero.

## Secondary checks (not proof)

- Prior proofs still green (split-ingest-items, ingestion-sources-table)
- `npx tsc --noEmit`, gate PASS
- Browser: edit a source to "one item per upload" and see the setting stick.

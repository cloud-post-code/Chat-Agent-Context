# Proof — Delete (full data purge) and hide ingestion sources

## Definition Of Done

- `deleteIngestionSourceAndData(id)` deletes the `IngestionSource` row and, for
  a custom source, every `Source` row it marked (`kind = "ingest:<key>"`)
  together with those rows' retrieval chunks.
- `setIngestionSourceHidden(id, true)` sets `enabled = false` so
  `contentTabsFromSources` drops the tab; `setIngestionSourceHidden(id, false)`
  brings it back. Hiding touches no ingested rows.
- The edit page renders a Danger zone whose delete form requires a checked
  "I understand" checkbox (HTML `required`) before submitting to
  `deleteIngestionSourceAction`, and the warning states the item count and
  irreversibility.

## Primary Proof

Type: integration (local dev Postgres, zero model calls — injected extractor,
`splitMode: "single"` so the splitter never runs, and empty embed keys force
local hashed embeddings)

Command:

```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/delete-hide-ingestion-sources/proof.ts
```

The proof creates a marker custom source (`proof-dhis-src`), ingests two texts
through it, then:

1. hides it and checks `enabled === false` and that `contentTabsFromSources`
   excludes it while its ingested rows survive;
2. shows it again and checks the tab returns;
3. deletes it via `deleteIngestionSourceAndData` and checks the source row,
   both marked `Source` rows, and all their chunks are gone.

Built-in purge branches (`links`/`pdfs`/`text`/`projects`/`photos`/
`experience`/`persona`) are NOT exercised against the shared dev database —
they would destroy real dev content; they follow the same `dropOrigin`
retraction the custom branch proves and are covered by review.

All marker rows are removed in `finally`.

## Secondary checks

- Gate: `~/.claude/scripts/gate`
- Manual: dashboard shows Hide next to "Edit ingestion"; hidden sources listed
  with Show; edit page Danger zone blocks submit until the checkbox is ticked.

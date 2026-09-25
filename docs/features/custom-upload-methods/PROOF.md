# Proof — Upload methods drive the ingest forms

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/custom-upload-methods/proof.ts
```

Local dev Postgres via `.env`; zero model calls (injected extractors,
embedding keys forced local). Seeded rows carry `proof-cum-` markers and are
deleted in a `finally`.

## Assertions (all must pass)

1. **The `ingestFormsFor` matrix**: `url`→url only; `file`/`resume`→docFile
   only; `textarea`/`form`→textarea only; `image`→image only;
   `generic`→textarea+image; unknown→generic behavior; storage gating —
   text-only kills the image control, image-only kills text-shaped
   controls; a contradictory config (image method, text storage) yields no
   controls.
2. **`ingestCustomUrl`** refuses image-only sources; with a fake extractor
   it upserts a `Source` row marked `ingest:<key>` carrying the extracted
   summary, and re-ingesting the same URL updates rather than duplicates.
3. **`ingestCustomFile`** refuses image-only sources; with a fake extractor
   it stores a marked row from uploaded bytes, and the item lists uniformly
   as text.
4. **`GenericIngestPanel` follows the mapping** (server-rendered): a `url`
   source shows the URL field and no textarea; a `file` source shows a
   document input accepting .pdf/.docx; a contradictory config renders the
   explanatory note and no forms.
5. **The builder test pane follows the same mapping** (source-level):
   `SourceBuilder.tsx` imports `ingestFormsFor` and renders test controls
   for url and document uploads; its test handlers still touch no server
   action.
6. **Wiring**: dashboard passes `urlAction`/`fileAction`; the new actions
   exist and wrap the lib fns; the builder system prompt names the
   per-method guidance.

## Red expectation

Before implementation, `ingestFormsFor` does not exist — the import fails
and the proof exits non-zero.

## Secondary checks (not proof)

- Prior proofs still green (`create-ingestion-source`, `source-builder-chat`)
- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Browser: a `file`-method draft's test page shows a document upload control.

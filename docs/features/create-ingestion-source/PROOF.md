# Proof — Create ingestion sources

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/create-ingestion-source/proof.ts
```

Local dev Postgres via `.env`; zero model calls (extractor and describer are
injected fakes; embedding keys forced to the local hashed embedder). Seeded
rows carry `proof-cis-` markers and are removed in a `finally`, including the
written upload file.

## Assertions (all must pass)

1. **`ingestCustomText` refuses a source whose `storageKinds` is
   image-only**, and **`ingestCustomImage` refuses text-only** — the uniform
   rule is enforced at the write.
2. **`ingestCustomText` stores a `Source` row marked `ingest:<key>`** with
   the fake-extracted summary, and the item then appears as a `kind:"text"`
   item from `listIngestedItems(key)`.
3. **`ingestCustomImage` writes the bytes to the upload dir and a `Photo`
   row marked `ingest:<key>`**, appearing as a `kind:"image"` item whose
   `imageUrl` targets `/api/uploads/`.
4. **Custom rows do not leak**: after seeding, `galleryBlock("carousel")`
   omits the custom photo, and `listIngestedItems("text")` /
   `listIngestedItems("photos")` omit the custom rows.
5. **`GenericIngestPanel` renders both ingest forms for a `text+image`
   source and hides the image form for a text-only source** (server-rendered
   markup).
6. **`GenericIngestPanel` renders the source's items**: a text item's title
   and an image item's `<img src>`.
7. **The create page and dashboard are wired** (source-level):
   `app/admin/sources/new/page.tsx` posts to the create action;
   the dashboard renders `GenericIngestPanel` for non-builtin rows and links
   to `/admin/sources/new`; `lib/knowledge.ts` and `lib/imageGen.ts` exclude
   `ingest:` marks.

## Red expectation

Before implementation, `lib/customIngest.ts` and
`app/admin/GenericIngestPanel.tsx` do not exist — the import fails and the
proof exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Browser: create a source in the admin, see its tab appear, ingest a note
  and an image, see both listed.

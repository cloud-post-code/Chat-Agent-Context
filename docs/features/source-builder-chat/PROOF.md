# Proof — Source builder: chat + test-only sample page

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/source-builder-chat/proof.ts
```

Fully offline: the builder client is an injected fake (zero model calls), the
component renders via `renderToStaticMarkup`, and the wiring checks read
source. No DB writes.

## Assertions (all must pass)

1. **A valid model JSON turn yields a validated draft**: reply extracted,
   label/systemPrompt carried, vocabulary fields intact.
2. **Out-of-vocabulary `uploadMethod`/`storageKinds` coerce to safe
   defaults** (`generic` / `text`) instead of crashing or persisting junk.
3. **Non-JSON model output degrades**: the raw text becomes the reply and
   the draft is null.
4. **A draft without a label is no draft** (reply still returned).
5. **The split page renders**: `SourceBuilder`'s initial markup has the
   builder-chat pane and the sample test pane side by side (both pane
   headings present), with a test-mode notice and no draft placeholder.
6. **The test pane is test-only** (source-level): `SourceBuilder.tsx` never
   imports the real ingest actions (`ingestCustomTextAction` /
   `ingestCustomImageAction`), and its ingest forms are `onSubmit`-handled
   locally; persistence goes only through `saveBuiltSourceAction`.
7. **Wiring**: `/admin/sources/new` renders `SourceBuilder` and keeps the
   manual `createIngestionSourceAction` fallback; the API route checks
   `isAuthed` and returns 401 before any model call;
   `saveBuiltSourceAction` wraps `saveIngestionSource`.

## Red expectation

Before implementation, `lib/ingestionBuilder.ts` and
`app/admin/SourceBuilder.tsx` do not exist — the import fails and the proof
exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Browser: /admin/sources/new shows chat left, test page right; a test
  ingest adds a local item and the DB stays untouched.

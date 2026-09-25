# Proof — Split ingests into one item per point

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/split-ingest-items/proof.ts
```

Local dev Postgres via `.env`; zero model calls (extractors and the split
client are injected fakes; embedding keys forced local). Rows carry
`proof-sii-` markers and are deleted in a `finally`.

## Assertions (all must pass)

1. **`splitIntoItems` parses a fake model JSON array** into `{title, text}`
   items, drops blank/invalid entries, and caps at `MAX_SPLIT_ITEMS`.
2. **The source's `systemPrompt` is the lens**: the fake client sees it in
   the request; with an empty prompt the default lens text is sent instead.
3. **A file ingest that splits into 3 items stores 3 marked rows and no
   parent blob row**; `listIngestedItems` shows 3 uniform text items, each
   tagged with the parent document's label.
4. **Split failure falls back to one row**: a throwing client (and a
   garbage-JSON client) leaves exactly the single summarized row of today's
   behavior — the upload is never lost.
5. **A 0-or-1-item split also falls back** to the single row (splitting a
   one-point note must not churn).
6. **URL re-scan replaces, never duplicates**: first scan → 2 item rows;
   re-scan with a different fake split → the new 2 rows only, and no
   doc-level URL row remains.
7. **Pasted text splits through the same pass.**
8. **The builder prompt teaches the lens** (source-level): it says
   splitting is automatic and the prompt should describe one item.

## Red expectation

Before implementation, `splitIntoItems` / `MAX_SPLIT_ITEMS` do not exist in
`lib/customIngest.ts` — the import fails and the proof exits non-zero.

## Secondary checks (not proof)

- Prior proofs still green (create-ingestion-source, custom-upload-methods)
- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Browser: re-ingest the 16-page brief into Work Initiatives and see
  multiple initiative cards.

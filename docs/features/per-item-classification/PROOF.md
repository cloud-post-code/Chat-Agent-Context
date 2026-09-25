# Proof — Per-item classification override

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/per-item-classification/proof.ts
```

Local dev Postgres via `.env`; zero model calls (fake extractor and fake
splitter injected, embedding keys forced local). `proof-pic-` markers,
`finally` cleanup.

## Assertions (all must pass)

1. **All four tiers are selectable**, and a non-public source classification
   saves instead of being refused.
2. **No override → inherits the source**, flagged `overridden: false`.
3. **Inheritance is live, not copied**: re-classifying a source moves every
   item that was never overridden.
4. **An ingest-time choice overrides the default** for that document only —
   its siblings are undisturbed.
5. **Setting an item back to the source default clears the override**, and the
   cleared item then follows the source again. An unknown value is treated as
   "no override" rather than stored.
6. **A split document's items all carry the document's choice**, not the
   source default (one upload → three items → three overrides).
7. **Cleanup**: deleting an item deletes its override row; purging a source
   clears every override it owned.
8. **Panel wiring**: every ingest form renders a `name="classification"`
   picker defaulting to "Same as this source", and each listed item shows the
   tier it resolved to.

## Red expectation

Before implementation, `lib/itemClassification.ts` does not exist — the
import chain through `lib/ingestedItems.ts` fails with MODULE_NOT_FOUND and
the proof exits non-zero. Confirmed by moving the module aside and re-running.

## Secondary checks (not proof)

- `npx tsc --noEmit` clean.
- The four neighboring ingestion proofs still pass (`delete-ingested-items`,
  `create-ingestion-source`, `custom-panel-code`,
  `ingested-items-pagination`).
- Browser: ingest a document on a custom tab with a non-default tier and
  watch the badge render as an override.

## Not proven here

Enforcement. Classification is recorded, not enforced — retrieval does not
filter on it, so every item still reaches every visitor. That is deliberate
scope (see FEATURE.md), not a gap in this proof.

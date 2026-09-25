# Proof — Delete individual ingested items

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/delete-ingested-items/proof.ts
```

Local dev Postgres via `.env`; zero model calls (fakes injected, embedding
keys forced local). `proof-dii-` markers, `finally` cleanup.

## Assertions (all must pass)

1. **Deleting a text item removes its `Source` row and its chunks** (the
   row's chunks are gone after the delete).
2. **Deleting an image item removes its `Photo` row.**
3. **Ownership is enforced**: deleting an id owned by a DIFFERENT source is
   refused and the row survives; deleting a built-in (unmarked) row's id
   through this path is refused; an unknown id shape is refused.
4. **The panel renders a Delete button per item** (server-rendered markup,
   one per item) and posts the item id + source key.
5. **Wiring** (source-level): the dashboard passes `deleteItemAction`; the
   action wraps `deleteIngestedItem` behind admin auth and calls
   `dropOrigin` retraction inside the lib.

## Red expectation

Before implementation, `deleteIngestedItem` does not exist in
`lib/customIngest.ts` — the import fails and the proof exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`, gate PASS
- Browser: delete an item on a custom tab and watch it leave the list.

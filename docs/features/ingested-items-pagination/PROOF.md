# Proof — Pagination on custom sources' item lists

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/ingested-items-pagination/proof.ts
```

Fully offline: server-renders the components with synthetic items. No DB,
no model calls.

## Assertions (all must pass)

1. **25 items render only the first page** (10 titles present, the 11th and
   25th absent) with controls: "Page 1 of 3", the item count, and Prev /
   Next buttons (Prev disabled on page 1).
2. **10 or fewer items render no pagination controls** — short lists are
   untouched.
3. **The page size is respected**: with `pageSize` 5 and 12 items, page 1
   holds exactly 5 rows and reports "Page 1 of 3".
4. **GenericIngestPanel uses `Paginated`** for its items (25 synthetic
   items → first 10 titles only, controls present), and each rendered row
   still carries its Delete form (`itemId` posted) — pagination does not
   break the per-item actions.

## Red expectation

Before implementation, `app/admin/Paginated.tsx` does not exist — the
import fails and the proof exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`, gate PASS
- Browser: a long custom-source list shows 10 items and pages through.

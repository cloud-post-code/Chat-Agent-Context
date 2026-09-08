# Proof — Ingestion sources as data

## Primary proof command

```
npx tsx docs/features/ingestion-sources-table/proof.ts
```

Runs against the local dev Postgres via `.env` (the script loads it itself,
never overriding already-set values). No model calls. Sources are per-account,
so the proof creates two throwaway `proof-ing-user-*` accounts and works only
inside them; both are deleted in a `finally` and their sources cascade with
them, leaving real accounts untouched.

## Assertions (all must pass)

1. **`STARTER_INGESTION_SOURCES` defines exactly the four onboarding tabs in
   display order** `blog, testimonials, about-team, services` — the same four
   things onboarding extracts from a business's site.
2. **Every starter carries the full contract**: non-empty `label`,
   `systemPrompt`, `uploadMethod` from the closed vocabulary, `storageKinds`
   from `text | image | text+image`, non-empty `outputMethod`.
3. **`seedStarterIngestionSources(userId)` installs exactly the starters into
   an empty account**, and a second seed of that account changes nothing —
   row count identical before/after, so deletions are never resurrected.
4. **`saveIngestionSource` rejects an unknown `uploadMethod`** with an error
   string, and rejects an unknown `storageKinds`.
5. **A blank key is derived from the label and slugified**; a colliding key
   for a NEW row gets a `-2` suffix instead of overwriting the owner. The key
   is unique **per account**: the same key in a second account is stored
   plain, not suffixed.
6. **New rows append at `max(order)+1`** and `listIngestionSources(userId)`
   returns that account's rows only, ordered by `order` ascending.
7. **`deleteIngestionSource(userId, id)` removes the row** — a subsequent
   list does not contain it — and cannot reach a row owned by another
   account.

## Red expectation

Before implementation, `import { listIngestionSources } from
"@/lib/ingestionSources"` fails (module does not exist), and Prisma has no
`ingestionSource` delegate — the proof exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`
- `npx next lint`
- `$HOME/.claude/scripts/gate` PASS

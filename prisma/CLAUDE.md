# prisma — schema and migrations

Postgres only. `schema.prisma` has 31 models, every tenant-scoped one carrying
`userId` with `onDelete: Cascade` from `User`.

## Rules
- Migrations get a unique timestamp prefix (two once shared `20260923120000`; Prisma
  orders by name, which worked by luck). `npx prisma migrate dev --name <slug>` locally;
  `scripts/migrate.mjs` runs `prisma migrate deploy` on every start (it marks the
  baseline `0_init` applied on a pre-migrations database).
- Additive first: new columns take a default so existing rows keep working; a drop is
  its own later migration after a backup.
- A new per-user model must be added to `lib/accountWipe.ts` (or cascade from one that
  is); `tests/lib/accountWipe.test.ts` fails otherwise.
- JSON-in-text columns (`config`, `customer`, `pricing`, `answers`, …) are read through
  their sanitizers in `lib/`, never `JSON.parse` at the call site.
- No SQLite: the migrations are Postgres SQL (`@db.Text`, advisory locks).

## Local database
`DATABASE_URL` in `.env`; `npx prisma migrate deploy` brings a fresh database up;
`npx prisma studio` to browse. The proofs seed and delete their own throwaway users.

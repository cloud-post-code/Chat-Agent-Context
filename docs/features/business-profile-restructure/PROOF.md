# Proof Plan

## Definition Of Done
- A fresh Postgres database migrated with `prisma migrate deploy` contains
  `Profile` with exactly `id, company_name, owner_name, company_address,
  company_phone_number, company_email, company_hours, updatedAt`; `PersonaConfig`
  with exactly `id, company_logo (nullable), tagline, personaSections,
  updatedAt`; `ThemeConfig` with exactly `id, themeFont, themeBodyFont,
  themeColors, themeRadius, themeFontSize, themeHeadingWeight, aesthetic,
  updatedAt`; and no `Booking` table.
- Singleton loaders in `lib/db.ts` (`getProfile`, `getPersonaConfig`,
  `getThemeConfig`) each create/return the `id: 1` row.
- `lib/persona.writePersonaSections` persists to `PersonaConfig`, and
  `buildSystemPrompt` carries that persona text.
- `app/api/booking/` and `lib/booking/` no longer exist; the Prisma client has
  no `booking` model.
- `grep` over `app/`, `lib/`, and `prisma/` finds no reference to removed
  fields (`headshot`, `booking*`, `experienceSummary`, …) or `prisma.booking`.
- Typecheck, lint, and build pass clean.

## Primary Proof
Type: migration + integration

Command:
```bash
bash docs/features/business-profile-restructure/proof/run.sh
```

Expected evidence:
- `prisma migrate deploy` applies every migration to the fresh container DB
  without error.
- All shape, loader, persona-pipeline, booking-removal, and grep checks in
  `proof/proof.ts` print `PASS`; the script exits 0.

Secondary guards:
- `npx tsc --noEmit` and `npm run lint` clean.
- Repo safety gate (below).

## Environment And Data
- Docker available locally (throwaway `postgres:16-alpine` container on port
  55432, override with `BPR_PROOF_PG_PORT`). No live `DATABASE_URL` is used or
  touched; `run.sh` injects its own.
- No fixtures needed — the proof runs against an empty, freshly migrated DB and
  exercises the real singleton-creation paths.

## Anti-Gaming Constraints
- The shape assertions read `information_schema` from the live migrated DB, not
  the Prisma schema file — the migration itself is what is proven.
- No mocks: `writePersonaSections` and `buildSystemPrompt` are the real
  modules against the real database.
- Do not weaken the exact-column-set assertions to subset checks.
- The grep guard must stay over `app/`, `lib/`, and `prisma/` — not a narrower
  path.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Production data: the live Railway database's `Profile` row values (bio,
  experience, booking rows) are destroyed by this migration on deploy. Row
  counts in the production `Booking` table cannot be read from this
  environment (no `DATABASE_URL` locally) and must be checked on Railway
  before deploying. User approved the destructive change 2026-08-28.
- Admin UI is not browser-driven by this proof; the reworked Profile/Persona/
  Theme tabs need a manual click-through after implementation.

# Business profile restructure: split Profile into Profile / PersonaConfig / ThemeConfig, drop native booking

## Summary
The singleton `Profile` table currently mixes personal identity, resume content,
chatbot persona, theme settings, and native-booking configuration. Restructure it
into three singleton tables with clear ownership — business identity in `Profile`,
brand voice in `PersonaConfig`, visual styling in `ThemeConfig` — and remove the
native booking feature (the `Booking` table and everything that serves it) along
with all retired and personal-resume fields.

## Desired Behavior
- `Profile` holds exactly six fields (plus `id`/`updatedAt`): `company_name`,
  `owner_name`, `company_address`, `company_phone_number`, `company_email`,
  `company_hours`. Nothing else.
- `PersonaConfig` (new singleton, `id @default(1)`) holds `company_logo`
  (`String?`, same type/nullability as the old `headshot`), `tagline`, and
  `personaSections`. The chatbot persona pipeline (`lib/persona.ts`,
  `lib/ingestedItems.ts`) reads and writes these from `PersonaConfig`.
- `ThemeConfig` (new singleton, `id @default(1)`) holds `themeFont`,
  `themeBodyFont`, `themeColors`, `themeRadius`, `themeFontSize`,
  `themeHeadingWeight`, and `aesthetic`. The live site's CSS variables and the
  admin Theme tab read and write these from `ThemeConfig`.
- The `Booking` table no longer exists. The native booking feature is removed
  end-to-end: API routes (`app/api/booking/*`), service/guard/slots libs
  (`lib/booking/*`), the booking UI card, and the admin booking surfaces.
- These `Profile` fields no longer exist anywhere: `name`, `location`, `socials`,
  `email`, `github`, `linkedin`, `bio`, `experience`, `experienceSummary`,
  `other`, `persona`, `overview`, `values`, `tone`, `headshot`, `tagline`
  (moved), `personaSections` (moved), `aesthetic` (moved), `bookingEnabled`,
  `bookingTz`, `bookingMinutes`, `bookingHours`, `bookingLeadHours`,
  `bookingDays`, `bookingBufferMinutes`, `bookingTitle`, `bookingLink`, and all
  `theme*` fields (moved).
- All call sites compile and run against the new shape: `lib/db.ts` (singleton
  loaders for all three tables), `lib/persona.ts`, `lib/ingestedItems.ts`,
  `lib/bootstrap.ts`, `app/admin/actions.ts`, `prisma/seed.ts`, and any UI that
  rendered removed fields.
- A generated Prisma migration applies cleanly to a fresh database.

## Scope
- `prisma/schema.prisma` and a new migration.
- All application code referencing `Profile`, `Booking`, or removed fields.
- Admin UI: Profile tab reworked for the six business fields; Persona tab writes
  `PersonaConfig`; Theme tab writes `ThemeConfig`; booking surfaces removed.
- Stale feature proofs that exercise removed features (`booking-card`,
  `booking-link`, `experience-timeline-card`, and any proof touching removed
  fields) are retired or updated so the repo's checks pass.

## Non-Goals
- No data migration of existing row values into the new business fields (the new
  fields have no source data; they start at defaults).
- No changes to tables not named here (`Source`, `Chunk`, `Entity*`, `Photo`,
  `Project`, `Chat*`, `GmailAuth`, `A2ATask`, etc.).
- No replacement booking feature; the external-link and native flows are both
  gone.
- No backward-compatibility shims for removed fields.

## Scenarios
- Fresh database: migration + seed run cleanly; app boots; admin shows the six
  business-identity fields, persona editing works against `PersonaConfig`, theme
  editing works against `ThemeConfig`.
- Chat prompt build: `buildSystemPrompt` composes identity from the new
  `Profile` business fields and persona from `PersonaConfig.personaSections`
  without referencing any removed field.
- Persona ingestion: uploading persona material updates
  `PersonaConfig.personaSections`, not `Profile`.
- Visitor chat: no booking card is ever offered; `/api/booking/*` routes return
  404 (removed).
- Grep check: no source file references a removed field name or the `Booking`
  model.

## Constraints
- Destructive change, explicitly approved by the user (2026-08-28), including
  dropping live booking data and resume/bio content.
- All three new/kept tables remain singletons with `id Int @id @default(1)`.
- `company_logo` keeps the old `headshot` semantics: nullable string holding an
  `/api/uploads/<file>` path.
- Postgres provider; migration must be a proper Prisma migration (not `db push`).
- No live `DATABASE_URL` in the dev environment — migration validity is proven
  against a fresh local/ephemeral database.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

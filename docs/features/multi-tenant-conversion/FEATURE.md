# Multi-tenant conversion

Convert the app from single-admin to multi-tenant: many public agent pages, each
owned and managed by exactly one user through their own admin dashboard.

## Phases

1. **Users and auth.** `User` model (unique email, display name, unique slug,
   scrypt password hash). Sign-up (`/signup`) and login (`/admin`) pages with
   per-user sessions, built by extending the existing HMAC signed-cookie
   mechanism in `lib/auth.ts` (no auth library — the repo avoids new
   dependencies when stdlib suffices). The founding user is created by the
   migration when tenant data exists and "claimed" at boot from
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` env, so the pre-existing admin keeps logging in.
2. **Data ownership.** Required `userId` FK on every tenant model; child tables
   (Chunk→EntityMention, ChatSession→ChatMessage, Entity→EntityEdge→EntityEdgeOrigin)
   inherit scope through their parent FK. Global uniques become compound
   (`@@unique([userId, x])`); the three singleton config rows and GmailAuth become
   per-user rows. Backfill all existing rows to the founding user inside the same
   migration, before tightening NOT NULL. `npm start` moves from
   `prisma db push --accept-data-loss` to a baseline-aware `prisma migrate deploy`.
   Every read and write in `app/admin/actions.ts`, `app/api/admin/*`,
   `app/api/chat`, and `lib/` takes an explicit `userId`.
3. **Multi-tenant pages.** Public agent page per user at `/a/[slug]`, chatting
   only against that user's data, themed by that user's PersonaConfig/ThemeConfig.
   Admin dashboard shows and edits only the logged-in user's data.
4. **Directory.** Public root page lists every agent page with name and link.

## Constraints

- Zero data loss: every existing row ends up owned by the founding user.
- Railway deployment keeps working; new config only via env vars
  (`ADMIN_EMAIL`, optional).
- Out of scope: teams, roles beyond owner, billing, email verification,
  password reset. The legacy A2A endpoint stays bound to the founding user.

## Done when

- Two fresh users can sign up, log in, ingest a source, and see their own agent
  page in the directory.
- Cross-tenant isolation holds everywhere, including direct API requests with
  another tenant's resource ids (403/404).
- The pre-existing admin's data is intact under the founding user's account.
- `npm run lint` and `npm run build` pass clean.

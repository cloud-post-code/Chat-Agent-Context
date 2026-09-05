# Feature — Admin user management (Users tab)

## Summary
An operator-gated **Users** tab in the admin dashboard where a platform operator
can see and manage every tenant account: search the list, edit identity fields,
disable/enable login, and issue a replacement password. Every User row is a
tenant (an agent-page owner); today nobody can administer accounts except by
poking the database.

## Who is an operator
The schema has no role field and this feature does not add a role system.
An operator is a signed-in user whose email appears in the `OPERATOR_EMAILS`
env var (comma-separated, case-insensitive). When `OPERATOR_EMAILS` is unset,
the founding user (`lib/users.ts` `foundingUser()`) is the sole operator, so
existing deployments get the feature without new configuration.

## Desired Behavior
- Operators see a **Users** entry in the admin dashboard nav; non-operators
  never see it, and direct navigation renders nothing sensitive.
- The tab lists all accounts — name, email, slug, created date, onboarding
  status, disabled status — paginated, with text search over name/email/slug.
- An operator can edit a user's name, email, and slug. Email and slug
  uniqueness are validated with a readable error, never a crash; slugs are
  normalized through the existing `slugify`/reserved-slug rules.
- An operator can **disable** an account: the user can no longer log in, and
  existing sessions stop working (a disabled user reads as logged out).
  Enable restores access. Operators cannot disable themselves.
- An operator can **set a replacement password** for an account: a generated
  password is shown once to the operator; the stored hash uses the existing
  scrypt format from `lib/auth.ts`.
- An operator can **create an account** (name + email): the account gets the
  same starter provisioning as signup and a generated password shown once.
  Duplicate emails are a readable error.
- An operator can **delete an account** after an explicit confirmation step.
  The delete is hard: every row the account owns goes with it (the schema
  cascades), other accounts are untouched, and operators cannot delete
  themselves.
- An operator can **view an account's chat history**: the visitor
  conversations (sessions and their messages) that account's agent page has
  had, read-only.
- An operator can **enter an account** ("log in as"): one click switches the
  operator's session to that account, landing on its control room. Logging
  out returns to the login page.

## Scope
- New `disabledAt DateTime?` column on `User` via a Prisma migration.
- Account-admin logic in a request-free `lib` module; server actions in
  `app/admin/actions.ts` are thin auth + revalidate wrappers (repo pattern).
- Operator gate helper usable by both nav rendering and every action.
- Users panel UI following the existing admin tab/panel conventions
  (`app/admin/Tabs.tsx`, `Paginated.tsx`).

## Non-Goals
- No role/permission system beyond the operator gate above.
- No changes to signup, guided onboarding, or the public `/a/<slug>` pages
  (a disabled account's public page is untouched).
- No email delivery for password resets or new accounts; the operator hands
  the generated password over out of band.
- No audit log, no soft-delete/undo, no "return to operator" shortcut after
  entering an account (log out and back in).

## Scenarios
- Operator searches "blake", opens the account, fixes a typo in the slug, and
  the change is visible on the next list load.
- Operator disables a spam account; that account's next request to the admin
  dashboard lands on the login page, and login attempts fail even with the
  correct password.
- Operator tries to disable their own account and gets a refusal.
- Operator renames a user's email to one that already exists and gets a
  validation error, not a 500.
- A non-operator user's dashboard shows no Users tab, and calling the account
  actions directly returns an authorization error.
- Operator creates an account for a client, hands over the shown-once
  password, and the client logs in straight to onboarding.
- Operator deletes a spam account; its data is gone but every other account's
  rows are exactly as before. Trying to delete their own account is refused.
- Operator opens a user's chat history and reads what visitors asked; opens
  "log in as" to see that user's control room exactly as the user does.

## Constraints
- Disabling must not delete or alter any of the user's owned rows.
- The disabled check must cover session validation, not just the login form.
- Schema change ships as a real migration under `prisma/migrations/` (deploys
  run `scripts/migrate.mjs`).

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

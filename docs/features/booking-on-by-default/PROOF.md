# Proof — Booking on by default, the form the site's own, settings on their panel

## Primary proof command
```
npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-on-by-default/proof.ts
```
(The `--tsconfig` override sets `jsx: react-jsx` for this run only. The repo
builds with `jsx: preserve` for Next, under which tsx renders no component —
the proof renders the real admin panels, so it needs the automatic runtime.
Path aliases still come from the extended root tsconfig.)
Runs against the local dev Postgres (`.env` `DATABASE_URL`; the script loads
`.env` itself). Seeds throwaway users, drives the real
`extractServicesAndBooking` with fixture `Page`s, a scripted `llm` (services)
and `formLlm` (the form transcription) — the two injectable seams — with the
browser's `readForm` answering null so the linked page's HTML is read
statically, asserts the rows actually written, then deletes everything it
made.

Panel placement (section C) is asserted structurally, not visually: the proof
imports `adminPanelKeys` and renders the real panels, so a regression fails
the command rather than needing a human to look.

## Assertions (all must pass)

### A. Booking on by default
1. **Fresh profile has booking on** — a user created through the real profile
   path has `bookingEnabled === true` with no explicit set. Reading it through
   `getBookingConfig` reports `enabled: true`.
2. **Existing tenants are not flipped** — a profile explicitly set to
   `bookingEnabled = false` still reads `false` after the migration path runs.
   The migration changes the column default, never existing rows.
3. **Off still means off** — `setBookingEnabled(user, false)` then
   `createBooking` is rejected with the disabled error, and
   `getBookingConfig().enabled` is `false`. The toggle is not one-way.

### B. The form: nothing seeded, the site's own form copied
5. **Enable seeds nothing** — a fresh tenant has booking on and an empty
   form; turning booking off and on again writes no question.
6. **No booking form on the site** — services found, no booking link: the
   stage reports `formFound: false`, `formHow: "none"`, no transcriber call;
   the form stays empty; the services are seeded as `Service` rows; the
   booking card books through the services with no questions at all.
7. **The site's own form is copied** — a homepage linking a plain HTML form:
   the stage reads it from the page's HTML (`formHow: "static"`), transcribes
   it, and writes its questions in order with their marks and roles
   (`Your name*` → `name`, `Phone` → `phone`), all marked `generated`.
11. **A site that says nothing** — no services, no form: nothing written,
    nothing thrown, and no booking card is drawn (nothing to ask or sell).
13. **A hand-written form is the tenant's** — one hand-authored question,
    then the stage with the form pages: the form is exactly as it was, and
    the log says the site's form was not copied over a form edited by hand.
14. **Idempotent** — running the stage twice on a still-generated form
    leaves keys, order, labels and screens identical.
15. **Tenant isolation** — one tenant's copied form never reaches another's.
16. **Best-effort** — a failing field write mid-stage does not throw out of
    the stage; the report says no rows were written; the services knowledge
    written earlier survives; no half-written form is left behind.

### C. Settings › Booking
17. **Always present** — `adminPanelKeys` includes `booking` for a tenant
    with booking ON and for one with booking OFF (it holds the switch).
18. **The combined calendar is retired** — no `calendar` key either way.
19. **The settings render the toggle** — `BookingSettings` for an ON tenant
    renders "turn booking off".
20. **Grid hidden when off, toggle shown** — with booking off the settings
    still render "turn booking on", and `AppointmentsPanel` does not render
    the month grid but points at the booking tab; with booking on the grid
    shows.

### D. Cleanup
22. Every seeded user, profile, field, appointment, source, and chunk row
    returns to the pre-run baseline.

## Retired
The seeded-defaults contract (a `name`/`email` floor, a generated service
picker, its ordering, `reason` kept or dropped, colliding requirement labels)
is gone with the planner: enabling seeds nothing, and the only questions
onboarding writes are the business's own, copied from its site's form
(`docs/features/custom-booking-form`).

## Secondary checks (not proof)
- `npx tsc --noEmit` clean.
- `npx prisma migrate diff` shows the default change and no data mutation.

## Run record
- 2026-09-25 — `All checks passed.`, 31 assertions (A 5, B 17, C 7, D 1).

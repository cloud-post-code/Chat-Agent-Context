# Proof — Booking on by default, seeded from services extraction, on Calendar

## Primary proof command
```
npx tsx docs/features/booking-on-by-default/proof.ts
```
Runs against the local dev Postgres (`.env` `DATABASE_URL`; the script loads
`.env` itself, the `onboarding-booking-extraction/proof.ts` precedent). Seeds
throwaway users, drives the real `extractServicesAndBooking` with fixture
`Page`s and a scripted `llm` double — the one injectable seam — and asserts the
rows actually written, then deletes everything it made.

Panel placement (section C) is asserted structurally, not visually: the proof
imports `adminPanelKeys` and the dashboard's panel registry and checks the keys
and their contents, so a regression that detaches the settings from the
Calendar fails the command rather than needing a human to look.

## Assertions (all must pass)

### A. Booking on by default
1. **Fresh profile has booking on** — a user created through the real profile
   path has `bookingEnabled === true` with no explicit set. Reading it through
   `getBookingConfig` reports `enabled: true`.
2. **Existing tenants are not flipped** — a profile explicitly set to
   `bookingEnabled = false` still reads `false` after the migration path runs.
   The migration changes the column default, never existing rows.
3. **Off still means off** — `setBookingEnabled(user, false)` then
   `createAppointment` is rejected with the disabled error, and
   `getBookingConfig().enabled` is `false`. The toggle is not one-way.

### B. Form seeded from the extraction
4. **Red — the current gate produces nothing** — with an extraction reporting
   services but `requirements: []`, the pre-change code seeds zero
   `AppointmentField` rows. This is the reported bug: booking on, form empty.
5. **Never zero questions** — after the services stage with that same
   requirement-less extraction, the catalog is non-empty and contains the
   `DEFAULT_APPOINTMENT_FIELDS` floor (`name`, `email`).
6. **Seeded even when `takesAppointments` is false** — an extraction with
   `takesAppointments: false` and no requirements still leaves a usable
   catalog. Enablement no longer gates the form.
7. **Extracted requirements become questions** — with requirements present,
   each one exists as a field with its extracted `type` and `required`
   preserved, and an off-whitelist type degrades to `short_text`.
8. **Service picker generated** — when services were extracted, exactly one
   additional field asks which service is being booked, its label contains the
   extracted service names, and its type is `short_text`.
9. **Service picker ordering** — its `order` places it before the extracted
   requirements and after the defaults.
10. **Label survives the 120-char cap** — an extraction with many long service
    names produces a picker label at or under the cap that does not end
    mid-service-name, and the field saves without `saveAppointmentField`
    returning an error.
11. **No services, no picker** — an extraction with zero services seeds the
    defaults only, and `reason` is KEPT (nothing more specific replaced it).
12. **`reason` dropped only when replaced** — with a service picker present,
    `reason` is absent; assertion 11 is its counterpart.
13. **Existing catalog untouched** — a user with one hand-authored field runs
    the stage and still has exactly that one field, unedited.
14. **Idempotent** — running the stage twice does not duplicate fields; the
    catalog after run two equals the catalog after run one, keys and order.
15. **Tenant isolation** — a second user's extraction seeds only their own
    fields; user A's service names never appear in user B's catalog.
16. **Best-effort** — a `saveAppointmentField` failure mid-seed does not throw
    out of the stage; the services knowledge written earlier survives.

### C. Settings live on the Calendar
17. **Calendar always present** — `adminPanelKeys` includes a `calendar` entry
    for a tenant with booking ON and for one with booking OFF. Previously the
    off case had none.
18. **`booking` retired as a separate panel** — `adminPanelKeys` returns no
    standalone `booking` key, and the dashboard's Agent Behavior sub-tabs no
    longer list it.
19. **Settings render inside the Calendar panel** — the Calendar panel's
    content includes the booking toggle and the question catalog: rendering it
    for a tenant produces both the enable/disable control and a field row per
    catalog question.
20. **Grid hidden when off, settings shown** — with booking off the Calendar
    panel still renders the toggle, and does not render the month grid.
21. **Canned reference still resolves** — a canned answer naming the old
    booking panel resolves to the Calendar rather than drawing nothing.

### D. Cleanup
22. Every seeded user, profile, field, appointment, source, and chunk row
    returns to the pre-run baseline.

## Red expectation
Before implementation the script fails at assertions 1, 5, 6, 8, 17, and 18:
`bookingEnabled` reads `false` on a fresh profile, the requirement-less
extraction seeds zero fields, no service picker field exists, and
`adminPanelKeys` returns a `booking` key with no `calendar` key when booking is
off.

## Secondary checks (not proof)
- `npx tsc --noEmit` clean.
- `$HOME/.claude/scripts/gate` PASS.
- `npx prisma migrate diff` shows the default change and no data mutation.
- A real onboarding run ends with the Calendar tab present, booking on, and a
  service-named question in the catalog.

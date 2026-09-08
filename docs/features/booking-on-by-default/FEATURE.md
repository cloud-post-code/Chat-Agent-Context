# Booking on by default, seeded from services extraction, living on Calendar

## Problem

Three defects, one surface.

**1. Booking starts off.** `Profile.bookingEnabled` is `@default(false)`
(prisma/schema.prisma:606). A new tenant has no Calendar tab
(`lib/adminBrain.ts:100`, `app/admin/dashboard/page.tsx:155`), the booking card
never hydrates (`lib/cards.ts:114`), and `createAppointment` rejects every
submission (`lib/appointments.ts:144`). Booking is the product's headline
capability and it is invisible until someone finds the Appointments panel and
flips it.

**2. The extraction never produces a form.** `extractServicesAndBooking`
(lib/onboarding/services.ts) does read the site and *does* sanitize a
`requirements` list, but the seeding is behind two ANDed gates:
`clean.takesAppointments && clean.requirements.length`. A site that plainly
offers services but never spells out "you provide your phone number when
booking" extracts services fine, reports `takesAppointments`, and seeds
**nothing**. The onboarding log even says so —
`"your booking questions were left as they are"` (lib/onboarding/jobs.ts:381).
So the common case is: booking now on (defect 1's fix), zero questions, and a
wizard with nothing to ask. The extracted **services** — the single most useful
thing the crawl learned — never reach the form at all; they are written to
knowledge and dropped.

**3. Appointments settings are buried away from the appointments.** The
Appointments panel (key `booking`) is a sub-tab of *Agent Behavior*
(app/admin/dashboard/page.tsx:151) while the Calendar is a sibling top-level
tab that only exists when booking is on. The toggle that creates the Calendar
lives in a different part of the app from the Calendar. An admin looking at an
empty calendar has no path to the questions that fill it.

## Desired behaviour

### A. Booking is on for every new tenant
1. `Profile.bookingEnabled` defaults to `true`, with a migration.
2. The default applies at profile creation, so a tenant who never onboards
   still has booking on.
3. **Existing tenants are untouched.** The migration changes the column default
   only; it does not `UPDATE` existing rows. Someone who deliberately turned
   booking off stays off.
4. Turning booking off still works and still hides the Calendar. On/off remains
   the tenant's decision — this changes only where the switch starts.

### B. Onboarding always leaves a usable, service-aware form
The seeding block in `extractServicesAndBooking` is replaced by one rule:
**after the services stage, the tenant has a non-empty question catalog.**

5. **Never a zero-question wizard.** When the catalog is empty, it is seeded —
   regardless of what the model said about `takesAppointments`, and regardless
   of whether it found explicit `requirements`. The floor is
   `DEFAULT_APPOINTMENT_FIELDS`.
6. **Extracted requirements are used when present.** Requirements the model
   found are saved as questions, with their extracted `type` and `required`,
   after the defaults.
7. **A service picker is generated.** When the extraction returned services, one
   additional question asks which service the visitor is booking, and its label
   names the extracted services so the wizard asks in the tenant's own words.
   It is a `short_text` question. It is seeded before the extracted
   requirements, because it is the primary thing being booked.
8. **`reason` is dropped when a service picker exists.** The current code
   already filters `reason` out of the defaults; that stays, but only when
   something more specific — the service picker or an extracted requirement —
   takes its place. Otherwise `reason` is kept, so the fallback form still asks
   something useful.
9. **An existing catalog is never overwritten.** The `count === 0` guard is
   preserved and is the only gate. A tenant who has edited their questions, or
   a re-onboard, changes nothing.
10. The onboarding activity log reports what was actually seeded, and no longer
    tells the tenant to "turn Appointments on" — it is already on.

### C. Appointments settings live on the Calendar page
11. The Appointments settings panel moves out of the Agent Behavior sub-tabs and
    onto the Calendar tab, rendered alongside the month grid: calendar first,
    then the toggle and the question catalog.
12. **The Calendar tab is always present.** It can no longer be conditional on
    `bookingConfig.enabled`, because it now contains the only control that
    enables booking — a tenant who turns booking off must still be able to turn
    it back on. When booking is off, the tab shows the settings without the
    grid.
13. This holds on **both** admin surfaces — the dashboard tab strip and the
    chat-revealed panels (`adminPanelKeys`) — since `CalendarPanel` is
    deliberately one implementation for both.
14. The `booking` key is retired as a separately addressable panel. Anything
    that named it (`lib/canned.ts`, the labels map, `FIXED_PANELS`) resolves to
    the Calendar instead, so an existing canned answer or a chat request for
    "appointments" still lands somewhere real rather than drawing nothing.

## Out of scope
- The visitor-facing booking wizard, its A2UI rendering, and the availability
  model (no change).
- `createAppointment` validation (no change).
- Backfilling `bookingEnabled = true` for existing tenants.
- Changing the extraction prompt or `sanitizeServices`. The service picker is
  built from data the extractor already returns.
- Making the service picker a typed enum/select. `FIELD_TYPES` has no choice
  type; adding one is its own feature.

## Constraints
- No new dependency.
- Seeding stays inside the existing `saveAppointmentField` path — no direct
  `createMany`, so key generation and validation stay in one place.
- Per-tenant throughout; one tenant's services must never seed another's form.
- Extraction remains best-effort: a seeding failure must not fail onboarding.
- Field labels are capped by `saveAppointmentField` (120 chars). The service
  picker label must be built to survive that cap without truncating mid-service.

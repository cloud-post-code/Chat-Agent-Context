# Feature — Appointment booking: an A2UI multi-question flow, an admin calendar, and appointments as knowledge

> **Superseded / what changed (2026-09-26, custom-booking-form):** the
> one-question-at-a-time wizard and `createAppointment`, the write path this
> feature introduced, are gone. Booking is now a conversation of cards down
> the chat, one step at a time in the business's own order
> ([`docs/features/booking-in-chat`](../booking-in-chat/FEATURE.md)), backed
> by `lib/booking/store.ts` `createBooking`; the question catalog this
> feature seeded name/email/reason into is now filled by copying the
> business's own booking form verbatim
> ([`docs/features/custom-booking-form`](../custom-booking-form/FEATURE.md)).
> The admin calendar and appointments-as-knowledge pieces below are
> unchanged in substance, just fed by the newer write path.

## Summary

Visitors can book an appointment through the chat agent via a multi-step A2UI
flow that asks one question at a time — the questions being the operator's own
configured fields plus a date and time — and the tenant can see and manage those
appointments on a calendar, both by asking the admin chat agent and on a
dashboard panel. Booked appointments are embedded into the knowledge index so
the agent can answer questions about them. The whole capability is off until the
tenant enables it, and the set of questions is customizable per tenant.

This is a rebuild of booking after the native Google-Calendar booker was
deliberately removed in 466b00e (see docs/features/booking-card for the old
design and google-connect-button in status.json for why it died: the manual
Google Cloud Console registration step). This version has **no external calendar
dependency at all** — appointments live in this app's own Postgres and nothing
else.

## Desired Behavior

### Enabling and configuring (admin)
- An Appointments admin surface lets the tenant turn booking on and off.
  Booking defaults **off**; while off, no booking tool is offered to the
  visitor-chat model and the calendar panel does not exist.
- When enabled, the tenant sees a list of booking fields — the questions the
  flow will ask — seeded with sensible defaults (name, email, reason for the
  meeting) that they can edit: add a field, remove one, reorder, rename the
  label, choose a type (short text, long text, email, phone), and mark it
  required or optional.
- Changing the fields changes what the very next booking flow asks. No
  redeploy, no re-enable.

### Booking (visitor chat)
- When booking is enabled, the visitor-chat agent can draw a `booking` A2UI
  card (a `show_booking` tool, gated exactly like other cards: withheld from
  the model when disabled, guarded in hydration so stale canned answers draw
  nothing).
- The card is a multi-step wizard: one question per configured field, in the
  tenant's configured order, then a date-and-time step, then a review/confirm
  step. Required fields must be answered to advance; optional ones can be
  skipped.
- Confirming submits once. The server validates: booking must be enabled, all
  required fields present, the time must be in the future, and the exact slot
  must not already be taken for this tenant. A rejected submit shows an error
  state in the card with the reason; the visitor's answers are not lost.
- A successful booking shows a confirmation state in the card with the booked
  date and time. Times are stored as instants (UTC) and rendered in the
  viewer's timezone.

### Managing (admin)
- A Calendar panel shows the tenant's appointments: a month view with days
  carrying their appointments, plus the detail of each appointment's answers.
  Past and upcoming are both reachable.
- The panel exists in both admin surfaces from one implementation: as a
  dashboard tab and as a revealable panel in the admin chat (the agent's
  `show_panel` gains a `calendar` key when booking is enabled).
- The tenant can cancel an appointment from the panel; a cancelled appointment
  leaves the calendar and its slot becomes bookable again.

### Appointments as knowledge
- A booked appointment is indexed into the retrieval store under a new
  `appointment` origin kind, so the agent can answer questions like "do I have
  anything booked on Friday?" conversationally, not only via the panel.
- Cancelling an appointment removes its knowledge entry.
- Visitor-typed answers are untrusted input. When indexed, they are framed as
  quoted visitor-submitted data (following the repo's existing precedent that
  visitor content is not treated as owner-authored knowledge), never as
  instructions or owner statements.

## Scope
- Prisma models for appointments and per-tenant booking fields; an enable flag
  in per-tenant config.
- A `booking` A2UI block + `show_booking` tool in the visitor chat pipeline
  (schema in `lib/cards.ts`, renderer in `app/cards/Cards.tsx`, tool gating in
  `lib/brain.ts`, prompt guidance in `lib/knowledge.ts`).
- Booking API routes (fetch flow config, submit a booking).
- Admin: Appointments settings surface, Calendar panel wired into
  `app/admin/panels.tsx`, server actions in `app/admin/actions.ts`, admin-chat
  panel key in `lib/adminBrain.ts`.
- Knowledge: `appointment` origin kind in `lib/retrieval/origins.ts` with
  index-on-book and drop-on-cancel.

## Non-Goals
- Availability windows, slot math, buffers, lead time, or any free/busy engine.
  The visitor proposes a time; the only conflict rule is "two appointments
  cannot share the exact same start time".
- External calendar anything: no Google/Outlook sync, no invite emails, no
  .ics files.
- Notifications and reminders of any kind.
- Visitor-side cancellation or rescheduling.
- Recurring appointments, multiple meeting types, or per-appointment durations.
- The external `booking_link` card (still removed; independent of this).

## Scenarios
- Happy path: tenant enables booking, keeps default fields, visitor asks to
  book, answers three questions, picks tomorrow 2pm, confirms; the appointment
  appears on the Calendar panel, the admin chat reveals the calendar when asked,
  and the agent answers "what's booked tomorrow?" from knowledge.
- Custom fields: tenant adds a required "company" field and removes "reason";
  the next visitor flow asks name, email, company — nothing else.
- Slot race: two visitors confirm the same start time; the first wins, the
  second sees "that time was just taken" and can pick another without retyping.
- Disabled: booking off → no `show_booking` tool offered, a canned answer
  naming it draws nothing, the calendar panel key is absent from the admin chat.
- Cancel: tenant cancels an appointment; it leaves the calendar, its knowledge
  entry is gone, and the slot can be booked again.
- Injection: a visitor's "reason" answer contains instruction-like text; the
  agent's later answers about that appointment quote it as visitor data and do
  not act on it.

## Constraints
- Postgres via Prisma is the only store; migrations via `prisma migrate`, never
  `db push`. No new external services or dependencies.
- Follow the existing A2UI patterns exactly: data-block cards for visitor chat,
  pre-rendered panel-reveal for admin chat. No new streaming mechanism.
- Fail closed: any error path (disabled, malformed config, DB failure) yields
  no booking tool / no slots, never an open booker.
- The server never trusts the client: submitted bookings are re-validated
  server-side against the tenant's live config.
- Per-tenant isolation: every row is scoped by userId like every other model.
- Field config follows the `IngestionSource` per-tenant catalog idiom
  (key/label/enabled/order with `@@unique([userId, key])`).

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

# Proof Plan — Appointment booking

## Definition Of Done
- `lib/appointments.ts` is a data-only form store over Prisma: the booking
  switch (`bookingEnabled`) and the per-tenant question catalog, role-tagged
  and screen-grouped — every function scoped by userId. Enabling flips the
  switch and nothing else: no question is seeded.
- With booking enabled, the visitor brain offers a `show_booking` tool; a
  scripted call to it yields a `booking` card event carrying the tenant's own
  fields in order (roles included) and the flow beside them. With booking
  disabled, the tool is not offered and a stale scripted call hydrates to
  nothing (no card event). Enabled with nothing to ask and nothing to sell,
  a call draws no card either.
- A booking is `createBooking` (`lib/booking/store.ts`) through that form. It
  rejects: booking disabled, a missing required answer (by the question's
  label), a past start time, and the same slot twice (the race guard, as
  *full*) — each with a reason, never by throwing. A valid submit persists a
  real `Appointment` row whose `customer` is read out of the role-tagged
  answers.
- Cancelling (`setBookingStatus`) removes the appointment from `listBookings`
  and frees the exact slot for rebooking.
- A booked appointment is indexed under the `appointment` origin kind
  (`ORIGIN_KINDS`): real `Chunk` rows exist for it, their text carries the
  visitor's answer framed as quoted visitor data, and cancelling drops them.
- `adminPanelKeys` includes `appointments` and `booking` when booking is
  enabled and `booking` (the switch) when disabled.

## Primary Proof
Type: integration (repo-native proof script over the real DB, model doubled
only at the Anthropic client boundary per `lib/brain.ts`'s `ModelClient` seam)

Command:
```bash
npx tsx docs/features/appointment-booking/proof.ts
```

Expected evidence: 34 `PASS` lines, `All checks passed.`, exit code 0.

Assertions, by section:
1. **Off** (4) — the switch reads off; `show_booking` not offered; a stale
   call draws no card; the booking settings key is present (it holds the on
   switch).
2. **Enable seeds nothing** (4) — enabled after the toggle; the form is
   empty; `show_booking` is offered on the switch alone; with nothing to ask
   and nothing to sell a call draws no card.
3. **The tenant writes the form** (5) — a name question (role `name`), an
   email question and a custom question save; the form is what was written,
   in order, minus what was deleted; each question carries its role and a
   screen of its own.
4. **Enabled with a form** (4) — the tool is offered; a card event is
   emitted; its fields match the live config in order with roles; the flow
   rides beside them.
5. **Validation** (2) — a missing required answer is rejected by the
   question's label; a past time is rejected.
6. **Happy path** (7) — accepted; listed; the customer read out of the
   name-role answer; the origin kind exists; chunks indexed; the chunk
   carries the visitor's answer; framed as visitor data.
7. **Race guard** (1) — the same slot twice is rejected as full.
8. **Panel keys** (1) — `appointments` and `booking` present while enabled.
9. **Cancel** (3) — leaves the list; chunks dropped; the freed slot books
   again.
10. **Disable** (3) — a submit is rejected; the form survives the switch;
    the booking settings key is still present.

Secondary guards:
- `npx tsc --noEmit` clean.
- `prisma migrate` migrations checked in (no `db push`).

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: the visitor model client is a scripted double implementing
  `ModelClient`; embedding falls back to the local hashed model when no
  provider key is set, which is sufficient for chunk-existence assertions.
- All rows are created under a throwaway user
  (`proof-appointment-booking@example.invalid`) and deleted in a `finally`.
  The tenant's hours are set to round-the-clock so a slot a day ahead is
  always on the grid.

## Anti-Gaming Constraints
- Only the outermost Anthropic client boundary may be doubled; tool gating,
  hydration, validation, persistence, and indexing must be the real code.
- No assertion may rely on model-authored text; assertions read brain events
  and DB rows.
- The disabled-state checks may not be satisfied by the proof toggling
  anything client-side: the tool list offered to the model is captured at the
  `ModelClient` boundary from the params the brain actually sends.
- Do not weaken `FEATURE.md` (e.g. dropping the race guard or the knowledge
  drop-on-cancel) to make the proof pass.

## Retired
The legacy intake path this proof once covered — default questions seeded on
enable, `createAppointment`, `cancelAppointment`, `listAppointments` — no
longer exists: nothing is seeded on enable, and a booking is `createBooking`
through the tenant's role-tagged form. The gating, indexing, race-guard and
cancel assertions carry over unchanged in substance.

## Run record
- 2026-09-25 — `All checks passed.`, 34 assertions.

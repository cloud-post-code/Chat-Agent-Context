# lib/booking — the booking model

One model: `Service`, `StaffMember`, `BookingLocation`, `BookingSettings` (rules,
hours, flow order) plus the business's own form fields (`AppointmentField`, read
through `lib/appointments.ts`), all writing `Appointment`.

| Concern | Module |
|---|---|
| CRUD, `getBookingFlow`, `quoteBooking`, `availability`, `createBooking` (the only writer; holds the advisory lock), `listBookings`, `setBookingStatus` | `store.ts` |
| shapes, sanitizers, `pricingFromText`, `formatMoney` (ISO currency) | `types.ts` |
| pure engines | `availability.ts`, `pricing.ts`, `time.ts` (`pad2` lives here), `hours.ts`, `matchImages.ts` |
| the form as steps and screens | `formSpec.ts`, `flowSteps.ts`, `steps.ts`, `flowEdit.ts` |
| the booking conversation's session and the folded history line | `session.ts` |

## Invariants
- The server recomputes duration, price, provider and slot from ids on submit; the
  card's figures are convenience. Never trust a client total.
- `createBooking` is the one write path (the intake-only `createAppointment` is gone;
  do not reintroduce a second writer or a second lock).
- Booking is a conversation of cards: `show_booking` starts a session, each step is a
  card, and the model sees one "Booking so far" line (`foldBookingLines`).

## Testing
`npm test`: `tests/lib/bookingTypes.test.ts` (the pure contract). Proofs:
`booking-flow` (engines + store + card, 190 checks), `booking-in-chat`,
`custom-booking-form`, `appointment-booking`.

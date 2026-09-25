# Feature — Onboarding: the booking form, tried and talked into shape

## Summary

Requested 2026-09-25: a step in the onboarding conversation specifically for
the booking form, second to last. It shows the steps the form asks, lets the
owner try the form, and has a text chat to say what is missing or needs
adding; the change is made and the form is shown again with it.

Until now the booking form was built out of sight: the services extractor ran
inside the knowledge stage, after the owner had already left for the
dashboard, and the first time anyone saw the form was when a visitor tried to
book. Anything wrong with it meant finding Booking › Questions and learning
the form builder.

## Desired Behavior

### Where it sits
- Site path: contact → locations → social → photos → theme → **booking form**
  → knowledge pick (the last step, "Last step: which of these…").
- Manual path (no site): contact → locations → social → theme → **booking
  form** → dashboard. There is nothing to extract, so the form step is where
  setup completes.

### The booking stage (`advance("booking")`)
- After the theme review the services-and-booking read
  (`lib/onboarding/services.ts`) runs as its own stage: the services pages,
  the business's own booking page, services saved to knowledge and the booking
  catalog, the intake form built by the planner — exactly what the knowledge
  stage's `services` agent did, moved earlier so the chat can show the result.
- Phase `booking` → `booking-done`; `stepBooking` on the wire carries the
  services report (or `null` when the read failed) and the chunk count.
- Fail-soft: a read that fails logs one line ("…You can build the form in the
  next step") and the step shows the form on file. The onboarding never fails
  on this stage.
- The knowledge stage skips `services` when `stepBooking` is set, carries its
  report, chunks and pages over (the goals and cards passes still read the
  services pages and are told services produced content), and the knowledge
  pick no longer offers "Services & how you take bookings". The unattended
  bulk runner is unchanged: with no review to show, it still runs services
  inside knowledge.

### The step (`app/admin/onboarding/BookingFormStep.tsx`)
- The assistant says what it built ("I built your booking form from your site
  — 12 services and 3 questions"), or that it found no services, or that it
  couldn't read them; on the manual path it introduces the form.
- **The steps**: a numbered list in the order a customer meets them — pick a
  service (count, sections), options and add-ons (when any service has them,
  marked "sometimes"), choose who you'd like to see, where, date and time,
  your details (the asked customer fields, required ones starred), each intake
  question (type, required, range, "only when…"), review and confirm (instant
  or a request). `lib/booking/steps.ts` (pure) describes them from the same
  `BookingFlow` the card draws, so the list is the card.
- **Try the form**: the real `BookingFlowCard` in a new `preview` mode — every
  step is real (live availability from the hours, the real quote), confirming
  draws the real confirmation screen but books nothing, and the card can be
  started over. The card says "Preview — nothing gets booked." on every screen.
- **The chat**: a text box ("What's missing or wrong?"). Each message goes to
  `POST /api/admin/onboarding/booking-form` and one round of
  `lib/onboarding/bookingFormChat.ts` runs: the model, told the form as it
  stands (services with ids, providers, customer fields' state, questions with
  keys, the step order), makes the change with tools and answers in a sentence.
  The reply and the list of changes appear in the step's chat, the form is
  re-read and shown again with new and changed steps marked (and removed ones
  named), and the preview card remounts on the new form.
- Booking off (a tenant who turned it off before re-onboarding): the step says
  so and offers "Turn booking on"; "Continue without booking" moves on.
- Done collapses the step into one line: "Booking form: 7 steps, 2 changes
  made." / "…, kept as built."

### What the chat can change (tools)
`add_question` (label, type, required, options with price/duration/group,
allowOther, min/max, waiver text, only-when condition, `after` a key or
"first"), `edit_question`, `remove_question`, `reorder_questions`,
`set_customer_field` (ask / required / label on the details step),
`set_staff_selection` (hidden / optional / required), `set_confirmation`
(instant / request — counts as the owner's choice), `add_service` /
`edit_service` / `remove_service` (price only as stated; none → "varies").

Rules the model is given: name, email and phone are customer details, never
questions; pick the right question type; keep labels short and written to the
customer; several changes in one message are all made; an ambiguous request
gets one question and no change; never invent services, prices, staff or
options.

### Whose form it is
A chat edit is an admin edit: every write goes through the same store the
Booking panels use, so the form stops being onboarding's to rebuild
(`claimForm` clears `generated`) — "Refresh from my site" will never overwrite
what the owner asked for here.

## Scope
`lib/booking/steps.ts` (new, pure), `lib/onboarding/bookingFormChat.ts` (new),
`app/api/admin/onboarding/booking-form/route.ts` (new),
`app/admin/onboarding/BookingFormStep.tsx` (new), `lib/onboarding/jobs.ts`
(booking stage), `app/api/admin/onboarding/advance/route.ts`,
`app/admin/onboarding/OnboardingFlow.tsx`, `app/cards/booking/BookingFlowCard.tsx`
and `ReviewStep.tsx` (`preview`), `lib/appointments.ts`
(`reorderAppointmentFields`), the chat-transcript proof, `agent.md`, README.

## Non-Goals
- Adding providers, locations or hours from the chat (the panels do that; the
  model says so when asked).
- Streaming the model's reply into the step; one round is one request.
- Rebuilding the form from the site after a chat edit (it is the owner's now).
- Payments, deposits and pricing rules beyond a service's price.

## Constraints
No new dependency, no migration. The form editor needs the model key like the
rest of onboarding; without it the step still shows and previews the form and
the chat says it isn't configured. Multi-tenant: every read and write is
threaded with the session user's id.

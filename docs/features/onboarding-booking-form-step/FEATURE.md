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
- The assistant's opener (`bookingIntro` in `OnboardingFlow.tsx`) says what
  the read found. A form copied from the site (`report.formFound === true`,
  or — for a job from before that flag — `seededFields > 0`): "I copied your
  booking form from your site — 4 questions on 2 screens, in the same order.
  Try it, then tell me what to change." (the screens clause only when
  `formScreens` is reported). No form found, a failed read, or the manual
  path: "I couldn't find a booking form on your site to copy, so it's empty.
  What do you need to know from a customer to book them? Tell me the
  questions in order and I'll build it." `formFound` and `formScreens` are
  read as optional from `stepBooking.report`.
- **The steps**: a numbered list in the business's own order
  (`flow.rules.flow`, resolved by `sanitizeFlow` exactly as the card's planner
  resolves it) — pick a service (count, sections), options and add-ons (when
  any service has them, marked "sometimes"), choose who you'd like to see,
  where, date and time, each screen of questions, review and confirm (instant
  or a request; always last). A screen holding one field is a `question` step
  (`q:<key>`: the label; type, required, range, "only when…"); a screen holding
  several is one `screen` step (`screen:<n>`: the flow step's title or the
  fields' labels with required ones starred, each field listed under it).
  Contact details are ordinary fields with a `role`, so there is no fixed
  "Your details" step — an existing tenant's migrated form shows its contact
  screen (First name*, Last name*, Email*, Phone*, Text me appointment
  reminders) as the first screen step. `lib/booking/steps.ts` (pure) describes
  them from the same `BookingFlow` and fields the card draws, so the list is
  the card.
- **The empty form** (onboarding found no form to copy): the step list shows
  only the engine steps, then the line "No questions yet — tell me what you
  need to know from a customer."; the "Try it" preview is hidden until the
  form has a question; the chat box is focused, headed "What do you need to
  know from a customer?", with the placeholder "e.g. Name, phone, and whether
  it's a first visit" and a "Build the form" button. The model is told the
  form has no questions yet and builds every question the owner names, in
  the order given, on one screen (roles set for name / email / phone), then
  asks at most one short question back. Once a question exists the step is
  the ordinary one.
- **Try the form**: the real conversation of cards (`BookingThread`, in a
  `preview` mode) over a local thread of its own — every step is real (live
  availability from the hours, the real quote), confirming draws the real
  confirmation card but books nothing, and the thread remounts fresh on the
  current form after every edit. Every card says "Preview — nothing gets
  booked."
- **The chat**: a text box ("What's missing or wrong?"). Each message goes to
  `POST /api/admin/onboarding/booking-form` and one round of
  `lib/onboarding/bookingFormChat.ts` runs: the model, told the form as it
  stands (services with ids, providers, then the steps in order, each with its
  id in brackets — `1. [service] Pick a service`, `4. [screen:1] "How do we say
  hello?" — first_name*, phone*, email` — and every field under its step: key,
  wording, type, required, role, screen, options, placeholder), makes the
  change with tools and answers in a sentence.
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
"first", `role` — one of `FIELD_ROLES`: none / name / first_name / last_name /
email / phone / notes / policy — and `screen`: `"new"` = a screen of its own,
`"previous"` = the screen of the question before it in order (or the last
screen), or a screen number), `edit_question` (the same, only the fields given
change), `remove_question`, `reorder_questions`, `set_staff_selection` (hidden
/ optional / required), `set_confirmation` (instant / request — counts as the
owner's choice), `add_service` / `edit_service` / `remove_service` (price only
as stated; none → "varies"). There is no separate customer-details tool:
`set_customer_field` is gone.

The order is the owner's, and three tools move it:
- `move_question {key, before?, after?, first?}` moves one question before or
  after another (by key) or first — `reorderAppointmentFields` — without
  changing its screen. No destination, or an unknown key, moves nothing.
- `set_screen_title {screen, title}` names a screen of questions: the
  `questions` step for that screen in `sanitizeFlow(settings.flow, fields)`
  gets the title (an empty title removes it) and the flow is saved; a screen
  no field is on changes nothing.
- `set_step_order {steps: string[]}` sets the order of whole steps by the ids
  the step list shows: `service | provider | location | time | screen:<n> |
  review`, and `q:<key>` for the screen that question is on. Unknown ids
  (`options`, a screen with no field) are ignored; steps left out keep their
  place after the named ones; review is always last (`sanitizeFlow` appends
  the missing engine steps and screens). Screen and review titles are carried
  over from the current flow. Saved as `{flow}`.

Rules the model is given: name, email and phone are ordinary questions with a
`role` so the calendar knows which answer is which — add or change them with
the question tools and set the role, keep the owner's wording, and several
questions can share a screen; never add a question the form already asks;
pick the right question type; keep labels short and written to the customer;
the order is the owner's (`set_step_order` moves whole steps, `move_question`
one question, `set_screen_title` names a screen); if the form has no questions
yet the owner is describing it from scratch — create every question they name,
in the order given, all on one screen unless they say otherwise, with the right
role for name / email / phone, then ask at most one short question back;
several changes in one message are all made; an ambiguous request gets one
question and no change; never invent services, prices, staff or options.

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
`app/admin/onboarding/OnboardingFlow.tsx`, `app/cards/booking/BookingThread.tsx`
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

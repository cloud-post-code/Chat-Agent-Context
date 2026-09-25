# Proof — Onboarding: the booking form, tried and talked into shape

## Primary proof command
```
npx tsx docs/features/onboarding-booking-form-step/proof.ts
```
Exit 0 and `All checks passed.` Offline: no model call, no network, no
browser. Runs against the local dev Postgres under a throwaway user, deleted
at the end. The scripted model client handed to `editBookingForm` is the one
doubled boundary; every write goes through the real store.

## Assertions (all must pass)

### A. The steps, described from the flow (`lib/booking/steps.ts`, pure)
1. Order follows the card: service → options → provider → time → details →
   questions → review.
2. The service step counts the services; the options step is listed as
   "sometimes" and says how many services have options; the provider step
   names "anyone available" when selection is optional.
3. The details step lists the asked customer fields with required ones starred.
4. A number question states its range and requiredness; a conditional question
   says when it is asked; the review step says instant or request.
5. Hidden staff selection drops the provider step; booking off means no steps.
6. `diffSteps` marks added, changed (reworded / re-required) and removed steps.

### B. The staged job's booking stage (`lib/onboarding/jobs.ts`)
1. `advance("booking")` is accepted after the theme review and sets the phase.
2. A read that fails is fail-soft: phase `booking-done`, `stepBooking.report`
   null, a log line saying the form can be built in the next step.
3. The wire payload carries `stepBooking` and never the internal service pages.
4. `advance("knowledge")` is accepted from `booking-done`; a stage is refused
   while another runs.

### C. Reading the form as the step sees it
1. The stage's generated form is on file; the summary carries the slug and
   that booking is on; name and phone are the details step, not questions;
   the steps read provider → time → details → the notes question → review.
2. A required legacy phone question makes the details step require the phone.
3. The model is told the question keys, the providers and the customer
   fields' state.

### D. One round changes the form for real and reads it back
1. A scripted `add_question` (number 1–8, `after: "first"`) + `set_customer_field`
   (phone optional) round: the reply is the model's own text, two changes are
   reported in order, the question is stored as a required number 1–8 asked
   first, the re-read steps show its range, the phone field is asked but
   optional, the loop made 2 model calls, and the system prompt carried the
   form as it stood before the change.
2. **A chat edit is an admin edit**: no question stays `generated`.

### E. Services, wording, order, removal, provider choice, confirmation
1. `add_service` with a stated price and length lands on the menu as such and
   the form now opens with the service step.
2. Four changes in one round: reword + make optional (range kept), remove,
   hide provider choice (no provider step), request confirmation (review step
   says so; counts as the owner's choice).
3. A photo question and a conditional question are added; `reorder_questions`
   puts the named keys first and keeps the rest after.

### F. Guard rails
1. A select without options, an unknown key and an unknown tool change
   nothing, and the reply says nothing changed.
2. A model that closes without text gets a reply built from the changes.
3. Earlier rounds are sent to the model as the conversation.
4. No model key: the reply says so, nothing changes, the form still comes back.
5. Booking off: the summary says so with no steps and the model is told there
   is no form; `enableBookingForm` brings it back.

### Z. No proof users left behind.

## Secondary: the conversation end to end (jsdom, real component)
```
npx tsx docs/features/guided-onboarding/proof/chat-transcript.ts
```
Extended for this feature: after the theme review the booking stage runs and
the step appears with the intro naming what was built; the steps are listed in
order; "Try the form" opens the real card in preview on the service step; one
chat message is applied, echoed, its change listed, and the new step shown
marked "new" with the preview remounted; Done collapses the step into
"Booking form: 5 steps, 1 change made." and the knowledge pick — without a
services option — is the last step. `All green`.

## Run record
2026-09-25: primary proof 52 PASS, chat-transcript proof All green,
booking-form-planner / booking-on-by-default / booking-menu-fields /
booking-flow proofs still green, `tsc --noEmit` and `next lint` clean.
Walked in a real browser on the manual path against the dev server (no model
key): the step lists the default form's steps, "Try the form" opens the card
in preview, the chat answers that the editor isn't configured, Done completes
onboarding.

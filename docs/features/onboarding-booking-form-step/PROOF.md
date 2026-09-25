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
   that booking is on; name and phone are fields on screen 1 with their roles,
   notes on screen 2; the steps read provider → time → the contact screen
   (titled by its labels) → the notes question → review.
2. The contact screen step lists the phone as required, with its type.
3. The model is told every field under its step (key, type, requiredness,
   role, screen) and the providers — nothing about a details step.

### D. One round changes the form for real and reads it back
1. A scripted `add_question` (number 1–8, `after: "first"`) + `edit_question`
   (phone optional, role kept) + `add_question` (email, `screen: "previous"`,
   `after: "phone"`) round: the reply is the model's own text, three changes
   are reported in order, the question is stored as a required number 1–8
   asked first, the email lands after the phone on its screen, the re-read
   steps show the range and the three-field contact screen, the loop made 2
   model calls, and the system prompt carried the form as it stood before.
2. **A chat edit is an admin edit**: no question stays `generated`.
3. The tools offered: no `set_customer_field`; the question tools take `role`
   (the `FIELD_ROLES`) and `screen`; `move_question {key, before, after,
   first}`, `set_screen_title {screen, title}` and `set_step_order {steps}`
   are present.
4. The rules say the order is the owner's and how an empty form is built from
   scratch; the model is told each step with its id in brackets
   (`[provider]`, `[time]`, `[screen:1] "…" — name*, phone*`, `[q:notes]`,
   `[review]`).

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

### G. The order is the owner's
1. `set_step_order ["service", "time", "provider", "options", "bogus",
   "screen:99"]` (with provider choice turned back on): the steps read
   service → time → provider → the rest in their old order → review; unknown
   ids are ignored; the stored flow holds the engine steps, every screen and
   review last.
2. `set_screen_title {screen: 1, title: "How do we say hello?"}` titles the
   screen step; a screen not in use changes nothing; the model sees
   `[screen:1] "How do we say hello?" — name*, phone`.
3. `move_question` after another key, then `first`: the keys read in the new
   order; a call with no destination or an unknown key moves nothing; the
   moved question keeps its screen, the screen its title, the form its step
   order.
4. `set_step_order` with `q:name` names the screen that question is on and
   keeps its title.

### H. No form to copy: the owner describes it from scratch
1. A fresh tenant (no fields, no stored order) is `empty`: only the engine
   steps remain and the model is told there are no questions yet, each step
   with its id.
2. One scripted round of three `add_question` calls with roles
   (`screen: "new"` then `"previous"`) builds the contact screen from nothing,
   in the order given (name, phone, first visit); the system prompt carried
   the empty-form rule; the reply is the model's one question back; the new
   screen is asked before review.

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
2026-09-25 (phase 2): primary proof 79 PASS (G: step order, screen title,
move_question; H: the empty form built from scratch), `tsc --noEmit` and
`next lint` clean. The chat-transcript proof still waits for the phase-1
opener ("I built your booking form from your site — 3 services and 2
questions", lines 272, 306 and 331); with the phase-2 opener it reads
"I copied your booking form from your site — 2 questions, in the same order."
— the transcript is to be updated alongside.

2026-09-25: primary proof 52 PASS, chat-transcript proof All green,
booking-form-planner / booking-on-by-default / booking-menu-fields /
booking-flow proofs still green, `tsc --noEmit` and `next lint` clean.
Walked in a real browser on the manual path against the dev server (no model
key): the step lists the default form's steps, "Try the form" opens the card
in preview, the chat answers that the editor isn't configured, Done completes
onboarding.

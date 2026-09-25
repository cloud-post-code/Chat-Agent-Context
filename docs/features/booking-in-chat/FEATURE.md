# Feature — Booking as a conversation of cards

## Summary

Requested 2026-09-25. The visitor's booking is a SEQUENCE of cards down the
chat, not one card with a wizard inside it. `show_booking` (or Book on the
services card) starts a booking session; the host then asks for each step in
turn — an assistant line, typed in, with that step's card under it — and each
finished card answers back as one user line ("Picked: Gel Manicure · $35",
"Provider: Katherine", "When: Fri, Sep 25, 10:00 AM"). Nothing above ever
disappears: every earlier card stays on the page, still editable, and a
change rewrites that step's line in place. A question typed mid-booking is
answered in the thread and the booking carries on below. Reloading the page
restores the same sequence with the visitor's selection in it.

The wizard card (`booking-flow`) put the whole flow inside one bubble with a
"Step 3 of 6" counter, so the conversation stopped being a conversation the
moment booking began: the chat scrolled to a box, the earlier steps were
gone from view, and a question typed into the composer either sat under the
card or restarted it. The engines, the step planner, the step cards and the
API are unchanged; what changes is where the steps live — in the thread.

## Desired Behavior

### Starting a session
- A `booking` block from the model (`show_booking`) is the START of a
  session, never a wizard. The chat gives it a `sessionId` the moment it
  arrives (older stored chats get one on load, `ensureBookingSessionIds`),
  appends a session-start message (`<sessionId>:start`), and asks the first
  step.
- Book on the services card starts a session with that service already
  picked: the `Picked:` line and the next step's ask append at the bottom of
  the thread; the service step is not asked and no service card is drawn.
- A second `booking` block while a session is live does not start another.
  It renders "Your booking is in progress above — keep going there, or say
  'start over'." and the live session keeps its place.

### One step at a time, in the business's order
- The steps are `planSteps` over the business's own flow (`rules.flow`) and
  its role-tagged, screen-grouped fields — the same plan the wizard and the
  onboarding step list use. Review is always last. Step ids:
  `service | options | provider | location | time | screen:<n> | review`.
- Each step is asked as an assistant message whose text is the step's intro,
  static and typed in: the business's own screen title when it has one
  (e.g. "How do we say hello?"), else the fixed line — "Which service would
  you like?", "Any options or add-ons?", "Who would you like to see?",
  "Where?", "When works for you?", "Here's your booking — check it over."
  The step's card mounts once the typing finishes.
- Completing a card appends ONE user line: `Picked: <service> · <price>`,
  `Options: …`, `Provider: <name>` / `Provider: anyone available`,
  `Where: …`, `When: <formatted>`, `Details: <name> · <email> · <phone>`
  (the contact-role fields of a screen) / `Answers: …` (its other fields).
  Then the next step's ask appends below. There is no Back button: the
  earlier card is right there.
- Message ids are stable so a step can rewrite its own line:
  `<sessionId>:<stepId>:ask` (assistant), `<sessionId>:<stepId>:reply`
  (user), `<sessionId>:confirmed:ask`, `<sessionId>:start`. Appending a
  message whose id is already present replaces it in place (`ChatThread`).

### Finished cards stay, and stay editable
- A finished card keeps its state and its controls; its button reads
  "Update". Changing it rewrites that step's reply IN PLACE — same id, same
  position — and the selection is reconciled (`withService`,
  `reconcileSelection`): options reset when the service changes, a provider
  who doesn't perform the new service is let go.
- When the change makes a new step required (switching to a service with
  variants adds `options`), that step's ask is appended BELOW the review
  card, and the review's Confirm is disabled with "One more thing to answer —
  see the step below." until it is answered.

### Confirm
- Confirm → `POST /api/booking` with the selection (serviceId, variantId,
  addonIds, staffId, locationId, startsAt, timezone, answers, customer `{}`
  — the customer is read from the role-tagged answers server-side).
- On success: a user line `Booked: …`, then an assistant message "You're
  booked — the details are below." carrying a `booking_confirmed` card (the
  existing confirmation: every fact, Add to calendar, the tenant's note).
  Every step card of the session locks: controls disabled, no button.

### The model sees one line
- A typed question mid-booking goes to `/api/chat` as usual, but the
  history is folded (`foldBookingLines`): each session's ask/reply lines
  become ONE user line `Booking so far: …` at the position of the session's
  last reply, and no message with empty content is sent (the session-start
  message, an ask with no text). The reply appends below and the booking
  continues — the live cards are untouched.
- The prompt rule: while a booking is in progress the model answers the
  question and does not draw another booking card; it may say "start over"
  is available. A second block, if it does draw one, is the in-progress note
  above.

### Reload
- The chat is restored from `chat:<slug>:<id>` (messages with their ids;
  the transient `typed` flag is never saved), the session from
  `booking:<slug>:<sessionId>` (selection, answered steps, locked state).
  The same sequence renders with no typing and the selection in every card.
- If only the `booking:*` keys are gone (cleared storage, another browser),
  the session's cards are pruned from the thread and the first step is
  asked again; the model's own lines around it survive.

### The onboarding preview
- The owner's preview (the booking-form step) runs the same conversation of
  cards over a local thread (`LocalChatThreadProvider`), so the owner sees
  exactly what a visitor will: the intros, the cards, the lines. It still
  says "Preview — nothing gets booked." and confirms nothing.

## Scope
- `app/Chat.tsx`: messages gain ids and a transient `typed` flag; the thread
  is provided to cards (`ChatThreadContext`); bubbles carry `data-who`; the
  history sent to the model is folded; sessions restore and prune on load.
- `app/ChatThread.tsx`: the thread interface and the local provider.
- `lib/booking/session.ts`: the pure rules — ids, step ids, intros, next
  step, review readiness, selection reconciliation, the fold.
- `app/cards/Cards.tsx`: `booking` starts a session; the client-only
  `booking_step` and `booking_confirmed` blocks; the services card's Book.
- `app/cards/booking/*Step.tsx`: optional `onBack` (none in the thread),
  `nextLabel` ("Update"), `locked`; the review's `ready` / `notReady`.
- `lib/chatStore.ts`: `StoredMsg.id`, `typed` stripped on save.

## Non-Goals
- No change to the engines, the planner, the API or the admin panels.
- No new dependency, no new CSS file.
- No model-written intros: the lines are static so the proof can pin them
  and a visitor sees the same words every time.
- No server-side session: the session lives in the visitor's browser like
  the chat itself.

## Scenarios
1. "Can I book something?" → the model's text, then "Which service would you
   like?" with the service tiles under it. Tap Gel Manicure → "Picked: Gel
   Manicure · $35" → "Who would you like to see?" → Katherine, Next →
   "Provider: Katherine" → "When works for you?" → a day, a slot, Next →
   "When: Fri, Sep 25, 10:00 AM" → "How do we say hello?" (the business's
   own screen) → Ada / phone / email, Next → "Details: Ada ·
   ada@example.invalid · 5551234567" → "Here's your booking — check it
   over." with the review. Everything above is still on the page.
2. Tap Long Hair Cut on the service card that is still there: the Picked
   line changes in place; "Any options or add-ons?" appears under the
   review; Confirm is disabled with the note; pick a length, Next →
   "Options: Shoulder length"; Confirm is enabled.
3. Type "do you do gel?": the model gets one "Booking so far:" line and no
   empty turn; its answer appends below the review; the booking is still
   live.
4. Confirm → "Booked: …", "You're booked — the details are below." with the
   confirmation; every card locks.
5. Reload: the same bubbles in the same order, no typing, Long Hair Cut
   pressed, Katherine chosen, "Ada" in the box, still booked. Clear only the
   `booking:*` keys and reload: the session's cards are gone and "Which
   service would you like?" is asked again, once.
6. "What do you offer?" → the services card; Book on Gel Manicure → "Picked:
   Gel Manicure · $35" and "Who would you like to see?" at the bottom; no
   service card. Ask to book again → "Your booking is in progress above —
   keep going there, or say 'start over'."

## Constraints
- The order of messages in the thread is the order of the conversation:
  appends go to the end; only a rewrite by id changes something above.
- A card that finds no thread (server render, an old page) draws itself and
  does nothing more — it never throws.
- The fold never leaks a bare ask or reply line to the model, and never
  sends an empty message (the API refuses one).
- The intros are the strings in `lib/booking/session.ts intro()`; the
  proof pins them.
- Message ids are the only link between a session and its lines; a session
  whose storage is gone must prune by id, never by text.

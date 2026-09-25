# Proof — Booking as a conversation of cards

## Primary proof command
```
npx tsx docs/features/booking-in-chat/proof.ts
```
Exit 0 and `All checks passed.` Fully client-side: no database, no model
call, no browser process. Section A imports the pure rules; section B runs
`proof/chat-thread.ts` as a child process —
```
npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-in-chat/proof/chat-thread.ts
```
(the `--tsconfig` override sets `jsx: react-jsx` for this run only) — which
mounts the REAL visitor `Chat` (`app/Chat.tsx`) in a jsdom document and books
the way a visitor would. The network is one scripted `fetch` double keyed by
URL: `POST /api/chat` answers NDJSON (`{t:"text"}` then `{t:"card"}`), the
flow, availability (a month of open days; two slots at 10:00 and 11:00 UTC on
any day), the quote (the real `priceBreakdown`) and the booking; every
request body is recorded so the proof reads what the app sent. Timers are
clamped and `Date.now` runs fast so the typed intros finish at once;
`new Date()` is untouched so the calendar's "today" is the real day.
Nothing to clean up.

Fixture: Moonlight Nails Spa — Gel Manicure ($35, 45 min, no options) and
Long Hair Cut (two variants), one provider Katherine, `staffSelection:
"optional"`, no locations, hours Mon–Sat 9–17, the business's own order
`service → provider → time → questions(screen 1, "How do we say hello?") →
review`, fields first_name* (role first_name), phone* (role phone), email
(role email) on screen 1.

## Assertions (all must pass)

### A. The sequencing rules (`lib/booking/session.ts`, pure)
1. `ids(session)` gives `<sessionId>:<stepId>:ask` / `:reply` and
   `<sessionId>:confirmed:ask`; a session owns exactly its own ids.
2. Step ids: engine steps by kind, a screen by its number, review.
3. The intros are the fixed lines; a screen's intro is the business's own
   title; a titled review keeps its title.
4. `nextUnasked` walks the plan in the business's order.
5. `foldBookingLines`: a session's ask/reply lines fold into ONE user line
   "Booking so far: …" carrying what was picked, at the position of the
   session's last reply (after the model's opener, before the new question);
   no empty turn and no bare ask/reply line reaches the model.
6. A thread with no booking passes through, empties dropped.
7. Two sessions fold into two lines, each at its own place.

### B. The conversation of cards (`proof/chat-thread.ts`, jsdom, the real Chat)
1. **show_booking starts a session.** After the model's reply: the question,
   the model's text, then the assistant line "Which service would you like?"
   with the service card (tiles Gel Manicure, Long Hair Cut) below the
   model's text; the ask is an assistant bubble of its own; no "Step 1 of".
2. **Each step: card → one user line → the next ask.** Gel Manicure →
   exactly one new user line `Picked: Gel Manicure · $35` → "Who would you
   like to see?" with Katherine and "Anyone available"; Katherine + Next →
   `Provider: Katherine` → "When works for you?" with the calendar; the
   first open day, the 10:00 slot, Next → a `When:` line carrying the hour →
   the assistant line is exactly "How do we say hello?" and the screen card
   shows "First name *", "Phone *", "Email"; Ada / 5551234567 /
   ada@example.invalid + Next → `Details:` with name, email and phone →
   "Here's your booking — check it over." with the review and its price
   breakdown. Each completion adds exactly one user line.
3. **Nothing above changed.** The whole conversation reads top to bottom in
   order; every earlier card is still mounted (tiles, provider tile,
   calendar, contact inputs); finished cards read "Update"; one user line
   per answered step; Confirm is enabled.
4. **Editing in place.** Long Hair Cut on the service card still on the page
   → the `Picked:` line changes to `Picked: Long Hair Cut …` and there is
   still exactly one `Picked:` line, in the same place; "Any options or
   add-ons?" appends BELOW the review card; Confirm is disabled with "One
   more thing to answer"; the variants are offered; pick one + Next →
   `Options:` names it; Confirm is enabled and the note is gone.
5. **A question mid-booking.** "do you do gel?" → the recorded `/api/chat`
   body has exactly ONE user message starting `Booking so far:` containing
   Long Hair Cut, Katherine and Ada; no message with empty content; no bare
   ask/reply line; the fold sits after the model's opener and before the new
   question; the visitor's own lines still travel; the reply appends below
   the review and options; Confirm is still enabled.
6. **Confirm.** `POST /api/booking` carries serviceId = Long Hair Cut, the
   variantId, staffId, the 10:00 startsAt, `answers.first_name === "Ada"`
   and a customer object; user line `Booked:`; assistant "You're booked —
   the details are below." then the Confirmed card ("You're booked."); the
   service tiles are disabled; the confirmation names the service and the
   provider.
7. **Reload.** The chat is under `chat:<slug>:<id>` and the session under
   `booking:<slug>:<sessionId>`; stored messages carry the session's ids
   (`:service:ask`, `:service:reply`, `:review:ask`, `:confirmed:ask`); no
   `typed` flag is saved. Remount and open the chat (what `Chat` restores
   itself, else the sidebar): every intro is complete the moment the thread
   paints (real clock — no typing); the same bubbles in the same order; Long
   Hair Cut pressed, Katherine checked, "Ada" in the box; still booked and
   locked; no second `POST /api/booking`. Clear only the `booking:*` keys
   and remount: the service ask is asked again, exactly once; the later asks
   and the session's reply lines are gone; the model's own text and the
   question survive.
8. **Book from the services card.** Home → "What do you offer?" → a
   `services` block with `booking` → Book on Gel Manicure → `Picked: Gel
   Manicure` then "Who would you like to see?" at the bottom; exactly one
   `Picked:` line; no service ask and no service card; a new
   `booking:<slug>:<sessionId>` key.
9. **A second booking block while a session is live** renders "Your booking
   is in progress above — keep going there, or say 'start over'."; still one
   provider ask and no service ask; the live card is still there.

Secondary guards:
- `npx tsx docs/features/guided-onboarding/proof/chat-transcript.ts` — the
  onboarding preview now opens on "Which service would you like?" (no
  "Step 1 of") and still says "Preview — nothing gets booked."
- `npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-flow/proof.ts`
  still green (engines, store, static card render).
- `npx tsc --noEmit` and `npm run lint` clean.

## Result
_Run record to be added on merge._ Written against the contracts commit
(`e20f62d`) before Teams T and S landed: at that commit section A fails at
A5 (the fold is a stub) and section B fails at its first wait ("the service
ask and its card" — the old wizard draws "Step 1 of 5" instead), with 66
FAIL / 30 PASS lines and exit 1. Expected green with no edits once the thread
and the cards are merged.

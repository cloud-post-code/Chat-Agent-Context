# Agent behavior

How the visitor-facing agent (`lib/brain.ts`) decides what to say. Update this
file whenever prompts, tools or routing change.

## Turn flow

1. **Canned answer?** A matching `CannedAnswer` with a card attached (or on a
   channel that can't draw cards) is served as-is, zero model calls. Without a
   card it becomes the model's script (`APPROVED ANSWER`).
2. **Prompt** (`lib/knowledge.ts`): persona core + `KNOWLEDGE FOR THIS
   QUESTION`, one retrieval keyed on the visitor's message
   (`lib/retrieval/search.ts`): stemmed BM25 + same-model cosine, source titles
   scored, one-hop graph expansion. Small multi-chunk sources (a price list)
   are served whole.
3. **Tools**: catalog cards (`show_projects`, `show_project`, `show_gallery`,
   `show_contact_form`, `show_card`), `show_booking` when booking is on (with
   an optional `service` to open the flow on the service the visitor named),
   and `search_knowledge` on every unscripted turn.
4. **Loop**: up to 4 model turns; tool results are fed back so the model can
   close.

## Booking

`show_booking` draws the whole flow (`lib/booking/store.ts` → `getBookingFlow`):
services with photos and prices, providers, locations, live availability,
customer details, intake questions, review, confirm. The `BOOKING` prompt
section tells the model to draw it rather than collect details in
conversation, and never to promise a time the card has not shown. The server
recomputes duration, price, provider and slot from ids on submit; the card's
figures are convenience.

## search_knowledge

The model's second look at the knowledge base, in its own words. The
`LOOKING THINGS UP` prompt section lists the knowledge sections and requires a
search before telling a visitor something is unavailable. Results go to the
model only. Not offered on scripted turns.

## Answer rules

Facts only from the prompt or a search. Lead with what is known; when the exact
thing isn't listed, give the closest related facts and name the gap; asked for
everything, give the full list. Then, and only then, hand off to the owner.

## Testing

`docs/features/dynamic-knowledge-answers/` — the question set (`questions.ts`),
offline proof, and `--live` answer eval.

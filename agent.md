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
   `show_contact_form`, `show_card`), `show_booking` when booking is on, and
   `search_knowledge` on every unscripted turn.
4. **Loop**: up to 4 model turns; tool results are fed back so the model can
   close.

## search_knowledge

The model's second look at the knowledge base, in its own words. The
`LOOKING THINGS UP` prompt section lists the knowledge sections and requires a
search before telling a visitor something is unavailable. Results go to the
model only. Not offered on scripted turns.

## Answer rules

Facts only from the prompt or a search. Lead with what is known; when the exact
thing isn't listed, give the closest related facts and name the gap; asked for
everything, give the full list. Then, and only then, hand off to the owner.

## Onboarding: the booking form

The services extractor (`lib/onboarding/services.ts`, `SERVICES_SYSTEM_PROMPT`)
also reads the business's own booking page, offsite widgets included
(`=== BOOKING PAGE <url>`), and reports the booking `kind`, `staff` a customer
can ask for (kept only when the name is in the text read), whether `phone` /
`email` are asked, and `notes`. It is told not to report the service choice or
the date and time as requirements. `lib/bookingFormPlan.ts` turns those facts
into the questions — no model call; site evidence beats the per-kind norm —
and `rebuildUntouchedForm` writes them only over a form nobody has edited.
Checked live against a real booking page by
`docs/features/booking-form-planner/crosscheck.ts`.

## Testing

`docs/features/dynamic-knowledge-answers/` — the question set (`questions.ts`),
offline proof, and `--live` answer eval.

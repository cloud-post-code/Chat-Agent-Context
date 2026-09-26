# Feature — experience timeline card

## What
A sixth card, `show_timeline`: Blake's work history rendered in the chat as
a vertical timeline — a rail down the left, a dot per role, each with its dates,
title, company and what he did — instead of the model reciting the same list as
a paragraph.

## Why
"What's your background?" is one of the questions a personal site exists to
answer, and it was the one question with no card behind it. The answer came back
as prose the model reassembled from retrieved chunks: slower, longer, and
lossy — dates and company names are exactly the kind of detail a language model
paraphrases away, and the site's own rule is *never invent jobs, dates or
credentials*. A card renders the stored rows verbatim, so the facts on screen
are Blake's, not the model's recollection of them.

The data already existed. `Profile.experience` has held
`{role, company, dates, description}` entries since the Experience editor
shipped, and `Profile.experienceSummary` holds his own prose paragraph about
them. Until now both reached the chat only as retrieval text.

## Shape
- Block: `{ type: "timeline"; items: TimelineEntry[]; summary: string }`
- Tool: `show_timeline`, no arguments — there is one work history.
- Hydrator: `experienceTimelineBlock()` in [`lib/cards.ts`](../../../lib/cards.ts),
  reading the singleton Profile row through `safeExperience`.
- Renderer: `Timeline` in [`app/cards/Cards.tsx`](../../../app/cards/Cards.tsx).

The summary rides on the block rather than being left to the model to speak,
because it is prose Blake wrote about his own career and it belongs at the head
of the card in his words.

## Decisions

**Stored order is preserved; nothing is sorted.** `dates` is free text the admin
types — `2021–2024`, `Summer '19`, `2023 – present`, `Jan 2020 - Mar 2022`. Any
sort has to parse that, and a parser that gets one format wrong silently
reorders a correct history into a false one. Chronology is a claim about Blake's
life; the code should not be guessing at it. The order in the Experience editor
is the order on the card.

**Rejected: a `layout` argument** (`compact` / `detailed`), the way
`show_gallery` takes one. Two layouts means two things to keep good, and there
is no question a visitor asks where a *worse* view of a work history is the
right answer. The card collapses past four roles instead, which solves the same
"this is too long for a chat bubble" problem without a decision for the model to
get wrong.

**Rejected: rendering the timeline on the homepage too.** This is a card for the
conversation. The profile page is a separate surface with its own layout, and
sharing a component across both would make the chat card answer to constraints
it does not have.

**Not withheld when empty**, unlike `show_booking`. An empty booking card is a
broken promise — it offers to meet and cannot. An empty timeline is just an
empty state, and the tool description tells the model when to reach for it; a
conditional tool would add a Profile read to every single message to save a rare
"No experience added yet."

## Touches
Six places, the standard checklist for a card in this repo:
1. `lib/cards.ts` — `TimelineEntry`, the union member, `experienceTimelineBlock()`
2. `app/cards/Cards.tsx` — the mirrored union member, the branch, `Timeline`
3. `lib/brain.ts` — the tool definition and the `hydrate()` case
4. `lib/canned.ts` — `CARD_TOOLS`, so a canned answer can draw it for free
5. `lib/knowledge.ts` — the "when to call it" line in the card prompt block
6. `README.md` — the cards table

No schema change. No migration. No new dependency.

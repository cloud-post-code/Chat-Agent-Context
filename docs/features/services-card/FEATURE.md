# Feature — An automatic services card, with booking one tap away

> **Superseded / what changed (2026-09-26, custom-booking-form):** Book no
> longer opens a single wizard card — it starts a booking session that draws
> one card per step down the chat
> ([`docs/features/booking-in-chat`](../booking-in-chat/FEATURE.md)), with the
> tapped service already picked. `createAppointment`, named below as the
> write path the card never bypasses, is gone; `lib/booking/store.ts`
> `createBooking` is that path now, still server-validated the same way.

## What
A first-class card, `show_services`: the business's services listed in the
chat — name, what it includes — each with a **Book** button that opens the
appointment wizard with that service already chosen.

"Automatic" in two senses. Its content is never written by hand or by a card
designer: it is read, at chat time, from the services knowledge onboarding
already saved. And it is added to a new tenant's catalog on its own: the
onboarding card planner places it whenever services were found.

## Why
"What do you offer?" is the first question most visitors of a business site
ask, and the answer was the one card every tenant got a *different shape* of.
Onboarding planned a "designed" services-and-prices card, which the card builder
drew as a custom stack for one tenant and coded HTML for the next — a frozen
copy of the services as they were on the day it was built, with no way to book
from it. The visitor read the list, then had to ask again to book, then type
the service name they had just been looking at into the wizard.

A fixed block fixes all three: every tenant's services card has the same
structure as every other card element (typed block → hydrator → renderer), it
is always current, and booking is on the card.

## Shape
- Block: `{ type: "services"; items: ServiceCard[]; booking: ServiceBooking | null }`
  - `ServiceCard = { id, name, description }`
  - `ServiceBooking = { fields: BookingField[]; serviceKey: string | null }`
- Tool: `show_services`, no arguments — there is one services list.
- Reader: `listServices()` and hydrator `servicesBlock()` in
  [`lib/cards.ts`](../../../lib/cards.ts).
- Format: [`lib/serviceCatalog.ts`](../../../lib/serviceCatalog.ts) — stated
  once for the writer (the onboarding services extractor) and the reader.
- Renderer: `ServicesCard` in [`app/cards/Cards.tsx`](../../../app/cards/Cards.tsx);
  booking reuses `BookingCard`, which gained `prefill` and `intro`.

## Decisions

**Services stay knowledge; no `Service` table.** Onboarding already saves the
services as one `Source` (title "Services", kind `ingest:services`) that the
agent retrieves from. The card reads that same record, so what the card lists
and what the agent can say never drift, deleting the record on the Content →
Services tab takes the card's content away with it, and there is no migration.
The cost is that structure has to live in text: the record's `rawText` is now
one paragraph per service, name on the first line, description on the next.
The retrieval chunks are untouched — they stay sentence-shaped
("Name. Description"), which is what embeds well.

**Records saved before the format are still read.** They hold
`Name. Description` on one line per service. Such a record is recognized as a
whole (every paragraph a single line with a period), and split at the first
`". "`. A legacy name with a period inside it ("St. Tropez Tan. …") splits
early; a re-onboard rewrites the record in the exact format. Rejected: a
version marker in the text — it would show up in the admin's Content tab as
noise on every tenant to fix a case few have.

**The booking config rides in the block**, as it does for `show_booking`. The
card books through the wizard the tenant configured at the moment it was drawn,
and `booking: null` — booking off, or no questions — draws the same list with
no Book button. One card, not a bookable variant and a plain one.

**Which question the service answers is decided server-side.** `serviceKey` is
the picker onboarding seeds (key `service`), else the generic `reason` default,
else null. Rejected: matching on label text ("any question mentioning
service") — "How did you hear about our services?" matches too, and a service
name filed under the wrong question is worse than one not filed. With null the
wizard still opens; nothing is pre-answered.

**A pre-answered question is not asked again — unless it is a pick-any menu.**
Tapping Book *is* the answer to a text or pick-one service question, so the
wizard runs one step shorter. When the service question is a `multi_select`
menu (the booking-form work that landed alongside this card), the tapped
service arrives as the first pick, already ticked and totalled, and the step
stays so the visitor can add a second service. Either way the choice stays
visible — "Booking **Gel Manicure** · Change" heads every step, and the review
lists it under the tenant's own question label. Change returns to the list.
The prefill is a plain string holding the service's name; menu option labels
are the same names, so the server's `resolveAnswer` matches it to its option.

**No new write path.** The service travels as an ordinary answer in the
existing `POST /api/booking` body, validated by the existing
`createAppointment`. Nothing about the server trusts the card.

**Null when there are no services**, like `show_booking` and unlike the
gallery's empty state. An empty price list on a business's site reads as "we
sell nothing"; with `null` the model is told "No data available." and answers
in words. The renderer still has an empty state, for stored samples.

**Gated by the catalog, like every other card.** A row naming `show_services`
is what offers the tool. Onboarding writes that row whenever services were
found (the planner is told to *always* plan it then, and never to plan a
designed card that lists services). Tenants onboarded earlier add it from
Build a card, where it is a live-data route; the builder is told which
services are on file so it cannot choose a card that would draw nothing.

**The list folds past five services and clamps long descriptions.** A chat
bubble is not a menu page. Stored order is kept — it is the site's order.

## Touches
1. `lib/serviceCatalog.ts` — new: the format, its parser, the record's title
2. `lib/onboarding/services.ts` — writes `rawText` in the format
3. `lib/cards.ts` — types, the union member, `listServices()`, `servicesBlock()`
4. `app/cards/Cards.tsx` — mirrored types, the branch, `ServicesCard`,
   `ServiceRow`, `BookingCard`'s `prefill`/`intro`
5. `lib/brain.ts` — the tool definition and the `hydrate()` case
6. `lib/canned.ts` — `CARD_TOOLS`, so a starter question can carry it for free
7. `README.md` — the cards table

No schema change. No migration. No new dependency. No new endpoint.

## Out of scope
- Structured price and duration fields. The extractor keeps them inside the
  description, as the site wrote them; splitting them out is an extraction
  change, not a card change.
- Editing services from the admin. The record is replaced by re-onboarding and
  removed from the Content → Services tab, as today.
- Per-service booking rules (different lengths, different questions).

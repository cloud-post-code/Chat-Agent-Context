# app/cards — the A2UI renderer

`Cards.tsx` is the one switch over `UiBlock.type`: projects, project, gallery,
services, contact, custom, html, booking (+ the client-only `booking_step` /
`booking_confirmed`), menu, cart, social. Sub-renderers: `MenuCard`, `CartCard`,
`SocialCard`, `BookingQuestion`, and `booking/` (the booking conversation: session,
thread, one card per step).

## Contracts
- Item shapes (`ProjectCard`, `PhotoCard`, `ServiceCard`, `CustomElement`, `SocialItem`)
  come from `lib/cards.types.ts`; `Cards.tsx` re-exports them. The client `UiBlock`
  union in `Cards.tsx` extends the server one (`lib/cards.ts`) with the client-only
  booking kinds; the server never emits those.
- `HtmlFrame.tsx` is the only sandboxed iframe (coded cards and the admin's custom
  source pages both use it). Never render stored HTML any other way.
- Styles: `styles.ts` (`card`, `cf`, `linkBtn`, `liveBtn`, `textBtn`, `chip`,
  `stepBtn`, `clamp2`) for cards; `booking/ui.tsx` re-exports what is identical and
  keeps only the booking-specific variants. No new style-object sets.
- Streams are read with `lib/client/ndjson.ts` (`readNdjson`), never a hand-rolled
  reader loop.
- Adding a card kind: the server block in `lib/cards.ts` (+ hydration), the client
  union and a branch in `Cards.tsx`, the tool in `lib/brain.ts`, a case in
  `tests/cards/Cards.test.tsx`, and `shown.ts` if the card takes part in card memory.

## Testing
`npm test`: `tests/cards/*` (every kind renders; `parseSampleBlock`),
`tests/client/ndjson.test.ts`. Live behaviour: the `composable-a2ui-elements`,
`services-card`, `menu-cart` and `booking-in-chat` proofs.

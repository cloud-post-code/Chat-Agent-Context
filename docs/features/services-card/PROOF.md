# Proof Plan — Services card

## Definition Of Done
- A `services` card block and a `show_services` tool exist with the same
  structure as every other card: a typed union member in `lib/cards.ts`
  mirrored in `app/cards/Cards.tsx`, a hydrator reached through `hydrate()`, a
  `CARD_TOOLS` entry, a storable sample type, a renderer branch.
- The card's content is automatic: `servicesBlock()` draws from the live
  booking flow's `Service` rows when the extractor seeded any, else from the
  services Source the onboarding extractor writes, through one shared format
  (`lib/serviceCatalog.ts`). Names with periods survive; records saved before
  the format still parse; a sweep page under the same ingest mark is not read
  as services.
- Booking is on the card: the block carries `booking: {fields, flow}` — the
  tenant's own form (role-tagged, screen-grouped) and the live flow whose
  services are the card's items, so Book opens the booking with the tapped
  service already chosen. Nothing is pre-answered into a question: the
  service is a step of the flow, not a field. Booking off → the same list
  with `booking: null`.
- No services on file → no card is drawn and the model is told there is no
  data.
- The tool is catalog-gated like every other card, and a canned answer naming
  it draws it with zero model calls.
- Onboarding plans the card automatically when — and only when — services are
  on file, writes the row with the tenant's own services as its preview, and
  attaches it to the starter question the plan names.
- The card builder accepts `show_services` as a live-data route and rejects it
  with a non-`services` sample.
- A booking submitted in the shape a Book tap sends (service preselected by
  id, the form's answers) is accepted by `createBooking` and records the
  service.

## Primary Proof
Type: integration (repo-native proof script over the real DB; doubled only at
the two injectable seams — the onboarding `llm` and the brain's `ModelClient`)

Command:
```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/services-card/proof.ts
```
(The `--tsconfig` override sets `jsx: react-jsx` for this run only — section 3
renders the real `BookingThread` to static markup; the `booking-flow`
precedent.)

Expected evidence: 50 `PASS` lines, `ALL PASS`, exit code 0.

Assertions, by section:
1. **Catalog format** (10) — round-trip; a period inside a name; a line break
   inside a description flattened; an empty description; a legacy record; a
   names-only record not mistaken for legacy; four junk inputs.
2. **Extractor → record** (7) — three services reported; the Source exists
   under the catalog title; its `rawText` is the format; chunks stay
   "Name. Description"; stored order; unique ids; the sweep page ignored.
3. **Hydration** (9) — block from the seeded `Service` rows; `booking` is
   `{fields, flow}` with the tenant's own phone question role-tagged and the
   three services in the flow; the items are the flow's services; no
   `service`/`reason` field is pre-answered; Book outside a chat renders the
   booking thread shell on the server with the service preselected (no step,
   no crash); a tenant with no form still books through the flow (fields
   empty); a hand-written question rides in the block as it is; booking off
   → `booking: null`; no services → null.
4. **Brain** (12) — canned tool; not offered without a row yet still
   hydratable; row accepted; sample parses; offered with the row; one card
   event; real content with a flow; "Card rendered"; empty tenant → no card
   and "No data available."; canned answer → zero model calls, card drawn.
5. **Card builder** (2) — accepts the route; rejects a mismatched sample.
6. **Onboarding planner** (6) — kept with services, dropped without; the
   corpus states the count; the row is written; its preview is live and
   bookable; the starter question carries the tool.
7. **Booking** (3) — the tapped service has a slot; the Book tap's submit
   shape books through `createBooking`; the booking records the service and
   the phone by its role.

Secondary guards:
- `npx tsc --noEmit` clean.
- The card, its fold, a long description's More/Less, Book → the booking
  conversation with the service already chosen → review, exercised in the
  browser preview on the admin card tab's live preview (that tab has since been removed).

## Environment And Data
- Local dev Postgres from `.env`, same as sibling proofs. No network: both
  model boundaries are doubled; embeddings fall back to the local hashed model
  when no provider key is set.
- All rows live under throwaway users (`proof-services-card-*@example.invalid`)
  deleted in a `finally`.

## Anti-Gaming Constraints
- Only the two injectable seams may be doubled. The extractor's write, the
  catalog parse, hydration, tool gating, the catalog write, the planner's
  sanitizer/placement/attachment, and `createBooking` are the real code.
- No assertion reads model-authored text; they read brain events, the params
  the brain sent the model, DB rows and static markup.
- The services the card shows must come from the rows the real extractor
  wrote — the proof never writes a services Source or a Service row by hand.

## Run record
- 2026-09-25 — `ALL PASS`, 50 assertions. Rewritten for the picker-free form:
  the block's `booking` is `{fields, flow}` (no `serviceKey`), the booking
  goes through `createBooking` with the service preselected by id.

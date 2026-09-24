# Proof Plan — Services card

> **Superseded (2026-09-24).** The intake-only wizard, the service-picker
> prefill and the read-time picker upgrade this proof exercised were removed
> by `docs/features/booking-setup-in-chat`: the booking flow's own steps ask
> for the service and the person, and the intake is only what the flow has no
> step for. The assertions below that reach those paths no longer run green;
> the replacement rules are proven there.


## Definition Of Done
- A `services` A2UI block and a `show_services` tool exist with the same
  structure as every other card: a typed union member in `lib/cards.ts`
  mirrored in `app/cards/Cards.tsx`, a hydrator reached through `hydrate()`, a
  `CARD_TOOLS` entry, a storable sample type, a renderer branch.
- The card's content is automatic: `servicesBlock()` reads the services Source
  the onboarding extractor writes, through one shared format
  (`lib/serviceCatalog.ts`). Names with periods survive; records saved before
  the format still parse; a sweep page under the same ingest mark is not read
  as services.
- Booking is on the card: the block carries the tenant's live booking fields
  and the key of the question the tapped service pre-answers (`service`, else
  `reason`, else null). Booking off → the same list with `booking: null`.
- No services on file → no card is drawn and the model is told there is no
  data.
- The tool is catalog-gated like every other card, and a canned answer naming
  it draws it with zero model calls.
- Onboarding plans the card automatically when — and only when — services are
  on file, writes the row with the tenant's own services as its preview, and
  attaches it to the starter question the plan names.
- The card builder accepts `show_services` as a live-data route and rejects it
  with a non-`services` sample.
- A booking submitted in the shape the card's wizard sends (service
  pre-answered) is accepted by the existing `createAppointment` and records
  the service.

## Primary Proof
Type: integration (repo-native proof script over the real DB; doubled only at
the two injectable seams — the onboarding `llm` and the brain's `ModelClient`)

Command:
```bash
npx tsx docs/features/services-card/proof.ts
```

Expected evidence: 47 `PASS` lines, `ALL PASS`, exit code 0.

Assertions, by section:
1. **Catalog format** (10) — round-trip; a period inside a name; a line break
   inside a description flattened; an empty description; a legacy record; a
   names-only record not mistaken for legacy; four junk inputs.
2. **Extractor → record** (7) — three services reported; the Source exists
   under the catalog title; its `rawText` is the format; chunks stay
   "Name. Description"; stored order; unique ids; the sweep page ignored.
3. **Hydration** (7) — block shape; live fields in order; `serviceKey` =
   `service`; null with neither question; `reason` fallback; booking off →
   `booking: null`; no services → null.
4. **Brain** (12) — canned tool; not offered without a row yet still
   hydratable; row accepted; sample parses; offered with the row; one card
   event; real content; "Card rendered"; empty tenant → no card and "No data
   available."; canned answer → zero model calls, card drawn.
5. **Card builder** (2) — accepts the route; rejects a mismatched sample.
6. **Onboarding planner** (6) — kept with services, dropped without; the
   corpus states the count; the row is written; its preview is live and
   bookable; the starter question carries the tool.
7. **Booking** (2) — the submit is accepted; the appointment records the
   service.

Secondary guards:
- `npx tsc --noEmit` clean.
- The card, its fold, a long description's More/Less, Book → wizard with the
  service pre-answered → review, and Change → back to the list, exercised in
  the browser preview on the admin A2UI tab's live preview.

## Environment And Data
- Local dev Postgres from `.env`, same as sibling proofs. No network: both
  model boundaries are doubled; embeddings fall back to the local hashed model
  when no provider key is set.
- All rows live under throwaway users (`proof-services-card-*@example.invalid`)
  deleted in a `finally`.

## Anti-Gaming Constraints
- Only the two injectable seams may be doubled. The extractor's write, the
  catalog parse, hydration, tool gating, the catalog write, the planner's
  sanitizer/placement/attachment, and `createAppointment` are the real code.
- No assertion reads model-authored text; they read brain events, the params
  the brain sent the model, and DB rows.
- The services the card shows must come from the record the real extractor
  wrote — the proof never writes a services Source by hand.

# Proof Plan — The services card is built from the site's own form

## Definition Of Done
- The services block and the rendered card carry only facts the site stated;
  a missing fact is a missing element. No "Varies", no default appointment
  length, no placeholder tile, no word-overlap image anywhere a visitor sees.
- MoonLight Nails & Spa (booking page: sections, price per row, pick several,
  staff step, search) produces a card with exactly that composition and the
  site's own price strings.
- Anthony's Barber Styling (no form, no prices, "text us", a number per
  barber) produces a name-only card with their text numbers, and a booking is
  still made: a request, the three named people with their numbers, phone
  required, nothing the site never asks.
- A tenant whose catalog holds names only draws a name-only card.
- The repo gate passes.

## Primary Proof
Type: integration (real onboarding stage, real store, real block hydration,
real brain, real card rendered server-side; the model is the one scripted
boundary)

Command:
```bash
npx tsx docs/features/services-card-from-site-form/proof.ts
```

Expected evidence: exit 0 and `All checks passed.` with every line `PASS`:
- A1–A5: the sanitizer carries `form`, `staffContacts` and the `text` channel
  through as recorded, drops a garbled form, and never defaults one.
- B1–B13: MoonLight's block has nine rows priced with the page's own strings,
  under the page's headings in its order, `form` equal to the screenshot's
  layout, `request: false`; its markup shows prices and headings, a pick
  control per row with one Continue, a search box, and none of the fill-ins;
  the brain yields the same block; no service row got an image by matching.
- C1–C13: Anthony's block lists the two things the bios name, flat, with no
  price/duration/image; channels are "text" each barber at the stated
  number; `request: true`; a booking exists with those three people and
  numbers, confirmation `request`, phone required; settings record the
  channel and a null form; no address, party size, job or service menu is
  asked; the flow's services carry no amount.
- D1–D4: an image the extractor tied to one item stays on that item, its
  neighbour under the same heading has none, a stated duration shows as
  written and an unstated one is absent, the render has exactly one `<img>`.
- E1–E2: a name-only catalog (the `/a/blake` state) renders names only.
- F1: nothing on file → null block.
- Z: no proof users left behind.

Red today: `sanitizeServices` returns no `form`, `servicesBlock` sets
`priceLabel: "Varies"` and a `duration`, `Cards` draws the tile, and
`store.ts` matches images by word overlap — A1, B2–B11, C2–C11, D2–D4 and
E1–E2 fail.

Secondary guards:
- `docs/features/booking-form-planner/proof.ts`, `docs/features/services-card/proof.ts`,
  `docs/features/booking-flow/proof.sections.ts`, `docs/features/booking-menu-fields/proof.ts`
  keep passing (the planner, the catalog record, the flow and the picker are
  touched by this change).
- Type check via the gate.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), migrated. The proof loads
  `.env` itself.
- No network, no model key: the extractor's `llm` seam is scripted with the
  answers recorded in `truth.ts`, which mirror what the live extractor read
  from each site on 2026-09-23 (MoonLight's slice is the booking-form-planner
  truth file; Anthony's is the page text cut from the live site).
- Throwaway users `proof-site-form-*@example.invalid`, deleted in `finally`.

## Anti-Gaming Constraints
- The scripted model answer is the only double. Sanitizing, the knowledge
  write, menu rows, service/staff seeding, settings, block hydration, the
  brain's tool path and the React render all run for real.
- The forbidden strings (`Varies`, `placeholder-image`, `· 30 min`, `<img`)
  are asserted on rendered markup, not on the block alone, so the renderer
  cannot keep drawing fill-ins from an empty block.
- A missing fact must be a missing key; `price: ""` or `duration: ""` fails
  B4/C3/E1. `pricingLabel` may not be changed to print "" for `variable` as
  the fix — the block must not carry a label at all.
- No new fixture may state a fact the site does not: `truth.ts` is held to
  the screenshot and the live page text in its header comment.
- Not satisfied by weakening `FEATURE.md` or by skipping the render.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Live crosscheck: after deploy, run Refresh from my site on the blake tenant
  and confirm the card shows MoonLight's prices under its headings with no
  images. Not automatable offline (real crawl, real model, production data).
- Anthony's per-barber `sms:` links open a messaging app; the proof checks
  the numbers are on the card, not that a phone opens them.

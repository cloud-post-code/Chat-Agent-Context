# Proof Plan — Menu and cart

## Definition Of Done
- `menu` and `cart` A2UI blocks with `show_menu` / `show_cart` tools, typed in
  `lib/cards.ts` and mirrored in the renderer, hydrated through `hydrate()`,
  `CARD_TOOLS` entries, storable sample types, renderer branches.
- The extractor writes `MenuItem` rows from the model's report through the
  sanitizer; unstated fields stay empty; tenants without rows get a menu from
  the services catalog.
- `show_menu` with no filter draws the full grouped menu; with keys/tags a
  curated list; unknown keys are dropped; nothing matching → null.
- The prompt carries the menu index and the visitor's cart; `add_to_cart`
  checks the key and emits a `cart` event.
- `createOrder` enforces every rule in FEATURE.md and computes totals from the
  rows on file; a timed order with booking on also lands as an appointment.
- The planner's `menu` kind is gated on items on file and wins over `services`.
- The rendered menu card shows rows, badges, a customizer with required
  choices and a disabled Add; the rendered cart card shows lines, steppers and
  Checkout.

## Primary Proof
Type: integration (repo-native proof script over the real DB; doubled only at
the injectable seams — the onboarding `llm` and the brain's `ModelClient`)

Command:
```bash
npx tsx --tsconfig docs/features/menu-cart/tsconfig.proof.json docs/features/menu-cart/proof.ts
```

Expected evidence: 79 `PASS` lines, `All checks passed.`, exit code 0.

Sections:
1. **Pure rules** — sanitizer enums/caps/no-invention, keys, price parsing,
   line and cart totals with floors, line validation (required, min/max,
   quantity, note).
2. **Extractor → rows** — items written with their facts; services Source
   still in the catalog format; fallback from a services-only tenant.
3. **Hydration** — full menu grouped; curated by keys/tags/category; unknown
   keys; null.
4. **Brain** — tools gated by the catalog; menu index and cart section in the
   prompt; `show_menu` card event; `add_to_cart` → `cart` event; unknown key →
   no event; canned answer draws the menu with zero model calls.
5. **Orders** — accepted order with server-computed totals; rejections
   (unknown item, unavailable, quantity, required choice, off-list pick,
   contact, past time); a timed order books on a form it can answer and
   saves without a calendar entry on one it cannot.
6. **Planner** — `menu` kept with items, dropped without, wins over
   `services`; the row's sample is live.
7. **Render** — static markup of the menu and cart cards.

Secondary guards: `npx tsc --noEmit` clean; gate; the cards exercised in the
browser preview.

## Environment And Data
Local dev Postgres from `.env`; throwaway users `proof-menu-cart-*` deleted in
a `finally`. No network.

## Anti-Gaming Constraints
Only the two seams are doubled. No assertion reads model-authored text. The
menu the card shows must come from rows the real extractor path wrote.

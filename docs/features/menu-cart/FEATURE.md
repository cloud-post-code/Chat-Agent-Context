# Feature — A menu you can order from: rich items, a cart, quantities, checkout

> **Superseded / what changed (2026-09-26, custom-booking-form):**
> `createAppointment`, named below as how a timed order lands on the
> calendar, no longer exists — `lib/orders.ts` `bookFromOrder` now calls
> `lib/booking/store.ts` `createBooking`, answering the tenant's own form by
> its fields' roles instead of a fixed customer-details shape. Booking itself
> is a conversation of cards down the chat now, not the single wizard "Book"
> opened at the time this was written
> ([`docs/features/booking-in-chat`](../booking-in-chat/FEATURE.md)).

## Summary

Requested 2026-09-23. The `services` card lists names and descriptions with a
Book button that opens the wizard for one service. A restaurant, a bakery, a
spa with add-ons, a shop — most businesses' sites show a *menu*: items with
prices, sale prices, sizes, add-ons, dietary tags, allergens, "choose one
side", "serves 2", "4 remaining", pickup or delivery. Visitors want to pick
several things, change how many, and order or book the lot in one go.

This adds two first-class card elements — **menu** (`show_menu`) and **cart**
(`show_cart`) — fed by a structured menu the onboarding extractor reads from
the site, a cart that lives with the visitor across every card in the chat,
and an order write path the server validates from the menu on file.

## Desired Behavior

### The menu on file
- `MenuItem` rows (new table), one per item, keyed `(userId, key)` where `key`
  is derived from the name (`chicken-parmigiana`). `data` holds the structured
  item; every field is optional and comes only from the site. Closed vocabulary
  in `lib/menuTypes.ts` (import-free, shared by client, server and extractor):
  name, category, subcategory, shortDescription, fullDescription, image,
  gallery, price, priceType (`fixed | starting_at | market | varies | free`),
  originalPrice, salePrice, currency, unit, availability
  (`available | unavailable | limited | unknown`), availabilityWindow,
  locations, modifiers (name, required, min/max picks, default, choices each
  with an optional price delta — sizes, sides, temperature, add-ons),
  quantity min/max, ingredients, dietaryTags, allergens, warnings,
  customization (takes special requests), nutrition, servingSize, popularity
  (`popular | bestseller | new | staff_pick`), rating, reviewCount,
  estimatedTime, inventory, fulfillment (`pickup | delivery | dine_in |
  appointment | shipping`), related / upsells / pairings (names of other
  items).
- **Written by onboarding's services extractor** in the same call that reports
  services: the prompt now asks for the menu facts per item, the corpus carries
  each page's image URLs with alt text so an item image can be matched, and the
  sanitizer (`sanitizeMenuItem`) never invents — unstated stays empty. The
  services knowledge `Source` is written as before (the agent's words, the
  booking picker) plus a facts line per chunk (price, dietary tags) so the
  agent can answer from it.
- **Existing tenants need nothing**: `listMenu` falls back to the services
  catalog on file (name, description, price and duration read from prose,
  like the booking picker) when no rows exist.

### The menu card (`show_menu`)
- Tool input: `keys` (item keys), `category`, `tags` (dietary/popularity),
  `title`. All optional. No filter → the **full menu**, grouped by category,
  every section collapsed to a header with its count except the first, each
  item one compact row (name, price with sale/original, one-line description,
  badges). A filter → a **curated list** under the model's title, in the
  model's order. Unknown keys are dropped; nothing left → null, and the model
  is told "No matching items".
- The prompt carries a `MENU INDEX` (key | name | category | price | tags,
  capped) when the card is in the catalog, so the model can curate by key or
  tag ("anything vegan?" → `tags:["vegan"]`, "what's good for two?" → keys).
- A row expands to the item's detail: image and gallery, full description,
  ingredients, allergens, warnings, nutrition, serving size, availability
  window and locations, estimated time, inventory, rating, pairings /
  related / upsells (listed by name), and the customizer: every modifier drawn
  from its rules (required, min–max, default preselected, choice price
  deltas), a quantity stepper within the item's rules, and a note box when the
  item takes customization. **Add** is disabled until required choices are
  made; an unavailable item cannot be added.
- Once an item is in the cart its row shows a − n + stepper instead of Add.
- A footer on every menu card shows the cart's count and total and opens the
  cart inline.

### The cart (`show_cart` and the footer)
- One cart per visitor per agent, shared by every menu and cart card in the
  thread and kept in `localStorage` (`cart:<slug>`) so it survives a reload.
  Lines carry the item key and name, quantity, chosen modifier picks with
  their deltas, the note, and the unit price — totals are drawn client-side
  for the visitor and **recomputed by the server** on checkout.
- The cart card lists lines (name, choices, note, − n + stepper, remove, line
  total), the subtotal with a "+" when any price is a floor, and Checkout.
- Checkout asks only what an order needs: fulfillment (when the menu offers
  more than one), name, phone and/or email (required per the tenant's booking
  contact questions when it has them, else email), a requested time when
  fulfillment is `appointment` or `dine_in` (optional for pickup/delivery),
  and notes. `POST /api/order`.
- The model sees the visitor's cart: the chat request carries its lines and
  the prompt gets a `VISITOR'S CART` section. `add_to_cart {key, quantity}` lets
  the model put an on-menu item in the cart ("add two garlic breads"): the
  server checks the key and emits a `cart` event the page applies.
- `show_cart`, `add_to_cart` are offered whenever `show_menu` (or a
  `show_cart` row) is in the catalog.

### Orders (`lib/orders.ts`, `Order` table)
- `createOrder` fails closed: every line's item must be on the menu and
  available; quantity inside the item's rules (1–20 default); each modifier's
  picks on its list, count inside min–max, required ones made; a note only
  when the item takes customization; contact must include a name and a phone
  or email; a requested time must be in the future. Line and order totals are
  computed from the menu on file, never from the card. Stored: lines (name,
  quantity, choices, note, unit price, line total as text), contact,
  fulfillment, requested time, notes, subtotal, currency.
- When the order has a requested time and booking is enabled, an
  `Appointment` is also created **through the real `createAppointment`** with
  the answers the order knows (name, phone, email, the items as service picks,
  the lines as the notes answer) — best-effort: if the form asks something the
  order cannot answer, the order still saves, the calendar entry does not.
- The Calendar panel lists orders (newest first) with lines, contact,
  fulfillment, time and total, and a Remove button.

### Catalog, planner, builder
- `CARD_TOOLS` gains `show_menu` and `show_cart`; sample types `menu` and
  `cart` are storable; the card builder accepts them as live-data routes.
- The onboarding planner (and the site-cards planner) gains kind `menu`, gated
  on items on file AND on at least one item carrying a real fulfillment other
  than `appointment` (`CardSignals.menuOrderable`) — an appointment-only
  service list stays `services`, whatever add-ons it has, since there is
  nothing to check out without booking a visit. It is told: plan `menu` when
  the business sells things a visitor picks several of and can buy on the
  spot (dishes, products, treatments with add-ons sold on their own); a plain
  list booked one at a time keeps `services`; never both — `menu` wins.

## Scope
`prisma/schema.prisma` + migration (`MenuItem`, `Order`), `lib/menuTypes.ts`
(new), `lib/menu.ts` (new), `lib/orders.ts` (new), `app/api/order/route.ts`
(new), `lib/cards.ts`, `lib/brain.ts`, `lib/canned.ts`,
`lib/onboarding/services.ts`, `app/api/chat/route.ts`, `app/cards/cart.tsx`
(new), `app/cards/MenuCard.tsx` (new), `app/cards/CartCard.tsx` (new),
`app/cards/Cards.tsx`, `app/Chat.tsx`, `app/admin/CalendarPanel.tsx`,
`app/admin/panels.tsx`, `app/admin/actions.ts`, README, agent.md.

## Non-Goals
- Payments, taxes, tips, delivery fees, coupons, stock decrement.
- Editing menu items in the admin (re-onboarding rewrites them).
- Pushing orders into a third-party POS or booking system.
- Slot availability for the requested time.

## Constraints
- Cards: blocks carry data, never markup; the client renders from the closed
  vocabulary and skips what it doesn't know.
- The server never trusts the card: prices, rules and availability come from
  the rows on file at checkout.
- Never invent a price, tag or rule. Additive migration only.

# Feature — Booking questions that fit a menu: choices with prices, pick-many, counts, yes/no

> **Superseded / what changed (2026-09-26, custom-booking-form):**
> `lib/bookingMenu.ts` (the automatic menu-from-services builder this feature
> introduced) is gone, along with the service picker it built — a business's
> service step now comes from `Service` rows (seeded by
> `lib/onboarding/bookingSeed.ts`) or from a menu the business's own booking
> form listed, copied verbatim by
> [`docs/features/custom-booking-form`](../custom-booking-form/FEATURE.md).
> `createAppointment`, the write path this feature validated answers through,
> no longer exists; `lib/booking/store.ts` `createBooking` does that now. The
> question-type rules this feature introduced (`select`, `multi_select`,
> `number`, `yes_no`, `config`, `sanitizeFieldConfig`) are unchanged and still
> load-bearing.

## Summary

The booking wizard could ask exactly one kind of question: a text box. So the
"which service?" step onboarding generated was a text box whose *label* tried
to be the menu — "Which service are you booking? Basic Manicure, Gel Manicure,
Gel Manicure + Removal, French, or something else" — and a visitor facing it
saw four of thirty services, no prices, no way to pick two things, and had to
retype a name from memory. The owner who reported it put it plainly: "I have
no idea what is needed."

This adds the question types a small business actually asks with, draws each
as its own A2UI control, and builds the service question from the tenant's
menu automatically.

## Desired Behavior

### Question types (the closed vocabulary the card renders from)
- `short_text`, `long_text`, `email`, `phone` — unchanged.
- `select` — pick one of the question's options.
- `multi_select` — pick any number of them ("a gel manicure *and* a pedicure").
- `number` — a whole-number count with optional bounds (party size, guests,
  pets, rooms). Drawn as a stepper.
- `yes_no` — two buttons (first visit? any allergies? need parking?).

### Options are a menu
- A choice question's options each carry a name and, optionally, a **price**,
  a **duration**, a one-line **description**, and a **section** ("Manicures",
  "Add-ons"). Price and duration are the business's own words ("$35", "$40+",
  "from £25", "45 min") — text, because menus are full of "and up".
- The card draws options as tappable rows — name left, price right, duration
  and description beneath, grouped under section headings — and scrolls inside
  the card past six rows. Rows are real checkboxes/radios inside labels.
- A pick-many menu shows a running total as the visitor picks: "2 selected ·
  $40 · 1 hr 15 min". A "+" marks a floor (some pick was priced "from", or has
  no price). The review step lists each pick with its price and the estimated
  total.
- A plain pick-one list (no prices or descriptions) longer than eight options
  is drawn as a dropdown instead; sections become `<optgroup>`s.
- A choice question may allow "Something else": a last row that opens a text
  box, for the service the list doesn't have.

### Built automatically
- Onboarding's services extractor now reports each service's price, duration
  and menu category (copied from the site, empty when unstated — never
  estimated), and booking requirements may be `select` / `multi_select` (with
  the choices the site lists), `number`, or `yes_no`.
- The seeded service question is a required pick-many menu — one option per
  service, priced and grouped — with "Something else" on, because a crawl
  never proves a menu complete. The label is just "Which services would you
  like?"; the names live in the options.
- **Existing tenants are fixed without doing anything.** A catalog that still
  holds the old generated text-box question (key `service`, still
  `short_text`, label still beginning "Which service are you booking?") is
  *presented* as the menu, built from the services knowledge on file, with
  prices and durations read out of each service's description where the
  description states exactly one. This happens on read, in `getBookingConfig`,
  so the card, the server-side validator and the admin editor all see the same
  question. The first Save in the admin writes it down. A question the tenant
  has reworded or retyped is theirs and is never touched.

### Editing (admin)
- The Calendar panel's question editor gains the new types. Choosing a choice
  type brings up an options box typed the way a price list reads:

      # Manicures
      Gel Manicure | $35 | 45 min | Includes removal
      # Add-ons
      French tips | $5

  Only the name is required; price and duration may be omitted or swapped.
  Number questions get Smallest / Largest.

### Validation (server)
- `createAppointment` holds every answer to its question: a pick must be on
  the menu unless the question allows "something else"; pick-one takes one; a
  count must be a whole number inside its bounds; yes/no must be yes or no.
- A pick is stored with the price the visitor was shown — "Gel Manicure ($35 ·
  45 min), French tips ($5) — total $40 · 45 min+" — because the menu can
  change after the booking and the owner needs to see what was agreed to.
  Stored answers stay `Record<string, string>`, so the Calendar panel and the
  appointment knowledge index read them unchanged.

## Scope
- `lib/appointmentTypes.ts` — the types and the pure rules (config sanitizing,
  option-line parsing, price/duration arithmetic, `resolveAnswer`), import-free
  so the client wizard, the server validator and the admin editor share them.
- `lib/bookingMenu.ts` — services → options; price/duration read from prose.
- `lib/appointments.ts` — config persistence, typed validation, the read-time
  upgrade of the legacy picker.
- `prisma` — `AppointmentField.config` (JSON text, default `{}`), additive.
- `lib/cards.ts` — `BookingField` carries `config`.
- `app/cards/BookingQuestion.tsx` (new) + `BookingCard` in `app/cards/Cards.tsx`.
- `app/admin/BookingFieldForm.tsx` (new), `BookingPanel.tsx`, the save action.
- `lib/onboarding/services.ts` — extraction prompt, sanitizer, seeding.

## Non-Goals
- Appointment length derived from the picked services, or any slot math (still
  the appointment-booking non-goal).
- Payments, deposits, taxes, tips, per-option quantities.
- Conditional questions ("ask B only if A is yes").
- Live-linking a saved menu question to the services knowledge: once saved,
  the question's options are the owner's to edit.

## Constraints
- A2UI: the block carries data (`type` + `config`), never markup; the client
  renders from a closed vocabulary and skips what it doesn't know.
- The server never trusts the card: the same `resolveAnswer` runs in both, and
  only the server's verdict counts.
- Never invent a price. Unstated stays empty; several stated amounts become a
  floor at the lowest.
- Additive migration only; existing rows read as "no config".

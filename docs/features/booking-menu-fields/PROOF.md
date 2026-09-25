# Proof — Booking questions that fit a menu

## Primary proof command
```
npx tsx --tsconfig docs/features/booking-menu-fields/tsconfig.proof.json docs/features/booking-menu-fields/proof.ts
```
(The `--tsconfig` override sets `jsx: react-jsx` for this run only — section E
renders the real screen card; the `booking-on-by-default` precedent.) Runs
against the local dev Postgres (`.env` `DATABASE_URL`, loaded by the script).
Sections B–D create throwaway users and delete them at the end; the scripted
`llm` passed to `extractServicesAndBooking` is the one doubled boundary.

The menu is a question the OWNER writes — a `select` / `multi_select` with
priced options — and the card draws it with those prices. Nothing plans or
seeds a picker, and nothing is rewritten on read.

## Assertions (all must pass)

### A. The pure rules (`lib/appointmentTypes.ts`, `lib/serviceCatalog.ts`)
1. **Config sanitizing** — options are trimmed, de-duplicated by label
   (case-insensitive), junk dropped; a bare string is an option; a text
   question carries no config; a number keeps sane bounds only; unparseable
   stored JSON reads as an empty config.
2. **The admin's menu text** — `name | price | duration | description`, parts
   swappable, `# Section` lines, a description that merely mentions a number
   stays a description; `formatOptionLines` → `parseOptionLines` round-trips.
3. **Totals** — exact prices add; a "from" price or an unpriced pick makes the
   total a floor (`+`); nothing priced means no total, not `$0`; the currency
   is the menu's own; durations add across units; "varies" is not a price.
4. **`resolveAnswer`** — picks stored with the price shown and their total; an
   off-menu pick rejected unless "something else" is allowed; pick-one takes
   one; no picks is "no answer", not an error; counts must be whole and inside
   their bounds; yes/no normalizes and takes nothing else.
5. **Menu facts read out of prose** (`priceFromText`, `durationFromText`,
   what the services seeder uses for a `Service` row) — one stated amount is
   the price; "starting at" is a floor; several amounts are a floor at the
   lowest; no amount, no price; one stated duration; two durations are not
   guessed between.

### B. The store, the block, the booking
1. A choice question with nothing to choose is refused; a menu question saves.
2. It reads back whole; renaming without resending the menu keeps the menu.
3. `bookingBlock` hands the card the type, the menu, and a number's bounds;
   no service is derived from the menu — the flow sells nothing, the form
   asks it.
4. A two-service booking (`createBooking`) is accepted and the owner's stored
   answer names each service, its price, and the total.
5. The server refuses an off-menu pick, an empty required menu, and a count
   past its bounds; it accepts a bare-text pick.

### C. The menu is the owner's own: nothing is rewritten on read
1. A text question stays a text question, services catalog on file or not;
   the stored row is untouched; the card is handed the text box.
2. The owner rewrites it as a menu with their own prices; it reads back as
   written.
3. The validator sees the same menu the card does and stores the priced
   picks; "something else" is allowed as the owner said.

### D. Onboarding seeds services, never a picker
1. The sanitizer keeps price/duration/category; the extract carries no form
   requirements any more.
2. The stage seeds no question at all (no picker, no defaults); the services
   become the service step, priced from the site's own words; the card sells
   through the flow with nothing to ask.

### E. What the visitor is handed (static render of the real `ScreenStep`)
1. A menu: one checkbox per option plus "Something else", names, prices,
   durations, section headings, **no text box**, and Next `aria-disabled`
   while a required menu has no pick.
2. Pick-one: radios.
3. A long plain list: a `<select>` with `<optgroup>`s.
4. A count: a stepper. 5. Yes/no: two buttons, and optional means "Skip".
6. A text question draws its text box with the required mark on its label.

### Z. No proof users left behind.

## Retired
The read-time upgrade of a legacy text-box picker into a menu built from the
services catalog, and onboarding's generated picker with its ordering, are
gone: the form is what the owner stored, and onboarding's only form writes are
the site's own form (`docs/features/custom-booking-form`).

## Run record
- 2026-09-25 — `All checks passed.`, 75 assertions. `tsc --noEmit` and
  `next lint` clean.

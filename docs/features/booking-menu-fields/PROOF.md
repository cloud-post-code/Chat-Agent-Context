# Proof — Booking questions that fit a menu

> **Superseded (2026-09-24).** The intake-only wizard, the service-picker
> prefill and the read-time picker upgrade this proof exercised were removed
> by `docs/features/booking-setup-in-chat`: the booking flow's own steps ask
> for the service and the person, and the intake is only what the flow has no
> step for. The assertions below that reach those paths no longer run green;
> the replacement rules are proven there.


## Primary proof command
```
npx tsx --tsconfig docs/features/booking-menu-fields/tsconfig.proof.json docs/features/booking-menu-fields/proof.ts
```
(The `--tsconfig` override sets `jsx: react-jsx` for this run only — section E
renders the real wizard; the `booking-on-by-default` precedent.) Runs against
the local dev Postgres (`.env` `DATABASE_URL`, loaded by the script). Sections
B–D create throwaway users and delete them at the end; the scripted `llm`
passed to `extractServicesAndBooking` is the one doubled boundary.

## Assertions (all must pass)

### A. The pure rules (`lib/appointmentTypes.ts`, `lib/bookingMenu.ts`)
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
5. **Services → options** — price/duration read out of prose only when stated
   once (several amounts → floor at the lowest; two durations → none); a stated
   price beats one found in prose; a description that is only a price isn't
   repeated; sections stay together in menu order; a single section is no
   section; no services → no picker.

### B. The store and the block
1. A choice question with nothing to choose is refused; a menu question saves.
2. It reads back whole; renaming without resending the menu keeps the menu.
3. `bookingBlock` hands the card the type, the menu, and a number's bounds.
4. A two-service booking is accepted and the owner's stored answer names each
   service, its price, and the total.
5. The server refuses an off-menu pick, an empty required menu, and a count
   past its bounds; it accepts a bare-text pick (the services card's prefill).

### C. Existing tenants: the legacy text-box picker
1. With no services on file it is left alone.
2. With the catalog on file (in the *older* "Name. Description" format) it is
   presented as a required pick-any menu listing **every** service — not the
   few the label had room for — with prices/durations from the catalog text
   and "something else" open.
3. The stored row is untouched (still `short_text`, config `{}`).
4. The validator sees the same menu the card does, and stores priced picks.
5. A question the tenant has reworded is never upgraded.

### D. Onboarding builds it
1. The sanitizer keeps price/duration/category; de-duplicates a requirement's
   choices; demotes a choice with fewer than two choices to text.
2. The seeded service question is a required `multi_select` with
   `allowOther`, each service an option with price, duration, description and
   section; a price only the description states is still found; no label
   contains a service name any more.
3. Requirements become `select` (with the site's choices), `number`, `yes_no`.
4. Order is who → what → the specifics.

### E. What the visitor is handed (static render of the real `Cards`)
1. A menu: one checkbox per service plus "Something else", names, prices,
   durations, section headings, **no text box**, and a disabled Next while a
   required menu has no pick.
2. Pick-one: radios.
3. A long plain list: a `<select>` with `<optgroup>`s.
4. A count: a stepper. 5. Yes/no: two buttons, and optional means "Skip".
6. A field with no `config` (an old stored block) still draws its text box.

## Result
86 assertions, all passing. `booking-on-by-default` (40 assertions, B8 / B10 /
B13b / B15 rewritten to the new picker contract) passing. `tsc --noEmit` and
`next lint` clean for the touched files.

## Verified live (dev server, `/a/blake` — the tenant from the bug report)
- The stored question is still the legacy text box; the wizard's step 3 is now
  "Which services would you like?" with 40 priced rows + "Something else".
- Picking Gel Manicure + French → "2 selected · $45"; Next enables.
- Review lists `Gel Manicure — $35`, `French — $10`, `Estimated total: $45`.
- Back keeps the picks. "Something else" + text → "3 selected · $45+"; closing
  it → "2 selected · $45".
- A picked row's border goes to `--on-surface` and returns on un-pick; zero
  `console.error` calls across six toggles. No horizontal overflow at 375px.
- Confirm was deliberately not pressed (it would write a real appointment onto
  the tenant's calendar); the submit path is section B/C above.

## Known stale, not caused by this feature
`appointment-booking/proof.ts` (3 checks) and
`onboarding-booking-extraction/proof.ts` (6 checks) fail identically on a
pristine checkout of HEAD: they assert the pre-`booking-on-by-default`
contract (booking off by default, Calendar hidden while off, no generated
picker). Left as found.

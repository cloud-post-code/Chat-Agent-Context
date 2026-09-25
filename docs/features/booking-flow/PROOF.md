# Proof — The full booking flow as an A2UI card

## Primary proof command
```
npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-flow/proof.ts
```
(The `--tsconfig` override sets `jsx: react-jsx` for this run only — section D
renders the real card; the `booking-menu-fields` precedent.) Runs against the
local dev Postgres (`.env` `DATABASE_URL`, loaded by the script). Section C
creates three throwaway users and deletes them at the end. **Zero model calls.**

## Assertions (all must pass)

### A. The contract (`lib/booking/types.ts`, `lib/appointmentTypes.ts`)
1. A business's own price text becomes the right pricing kind — `$35` fixed,
   `$40+` / `from £25` starting at, `$30–$45` a range, `$60/hr` hourly,
   `$12 per person` per person, `Free`, `Call for a quote`, and `""` is
   "varies", never invented.
2. Price labels read as a site would print them (`$45`, `From $45`,
   `$45–$80`, `$45/hr`, `$12/person`, `$40/room`, `Quote`, `Free`, `Varies`,
   `£25`); durations as `45 min` / `1 hr 30 min` / `2 hr`.
3. Pricing sanitizing: a range whose max is below its min drops the max; a
   priced kind with no amount becomes "varies"; an unknown kind never throws.
4. Service config: add-ons de-duplicate by id and drop the nameless; a
   variant keeps its own pricing and duration; deposit percent; unknown modes
   dropped; only our uploads and https images survive; buffers clamped; a
   deposit over 100% is none.
5. Provider config: specialties trimmed and de-duplicated; a backwards hours
   range dropped; time off keeps real ranges only; overrides keep sane
   numbers; no hours at all means the business hours.
6. Location config: postal codes normalized; radius and travel fee kept; an
   http meeting link refused; capacity and per-service prices kept; capacity
   defaults to one room.
7. Tenant rules: booking channels keep the known ones once and confirmation
   is instant or request; unknown timezone falls back; an odd slot interval
   falls back to 30; lead time and advance window clamped; the customer is
   read out of the form's role-tagged answers (`customerFromAnswers`): a
   `first_name` field is an ordinary field that names nobody until answered,
   a `name` answer splits into first and last and the first field per role
   wins; the stored flow keeps its shape only (kinds whitelisted, titles
   flat, a questions step needs a screen); promo codes upper-cased and a
   >100% one dropped; memberships get ids; tip presets past 100% dropped;
   **the public rules carry no promo codes**; defaults are weekday nine to
   five.
8. A submitted selection is normalized: de-duplicated add-ons, integer
   quantity, empty provider = anyone, known customer keys only, recurrence
   count capped, promo code normalized, answers pass through.
9. Intake: a date answer must be a date; an upload must be one of ours (never
   an outside URL); a signature is an upload; an agreed waiver stores
   "Agreed" and an unagreed one is unanswered; waiver config keeps only its
   text.
10. Conditions: a question stays hidden until the other answer matches; a
    condition on an unknown question never hides; empty values mean "when
    answered at all"; a pick-any answer matches on any pick; a bad key is
    dropped.

### B. The engines (`lib/booking/time.ts`, `availability.ts`, `pricing.ts`, `hours.ts`)
1. Wall clock → instant is DST-correct in both directions; calendar
   arithmetic never drifts; parts read in the zone.
2. A nine-to-five day holds fifteen hour-long starts on the half hour; a
   booking removes every overlapping start; holidays and weekends are closed;
   lead time pushes today's first slot past now plus the notice; same-day off
   closes today; after the daily cutoff tomorrow is closed; past the advance
   window is closed; a buffer keeps the next booking off the heels of the
   last; the month lists every day with open ones counted; earliest is the
   first open slot from now.
3. Providers as the resource: one booked, the slot stays open for the other;
   a provider's own hours narrow their slots; "anyone" gets a provider
   assigned; every provider taken is *full* (waitlist-eligible) while an
   instant off the grid is refused but not full; time off closes the day.
4. Rooms as the resource: a two-chair location takes two bookings at once
   and no more.
5. Pricing: a fixed service prices as itself; lines come in order — service,
   add-on, travel, promo, fee, tax, tip — and the total is their sum; the
   location's price applies when no provider overrides it and a provider's
   beats the location's; a variant's own price is what the visitor was shown;
   per person multiplies; "starting at" is an estimate shown as From; a quote
   promises nothing but the add-ons; membership halves it; hourly duration
   scales with hours; add-ons add minutes; promo lookup honours expiry and
   service scope.
6. Hours from a site's own words: `9 AM–7 PM`, two ranges, Closed, day
   names, all-closed = null; Austin, TX is Central; no state is unknown.

### C. The store (`lib/booking/store.ts`), real Postgres
0. Nothing is seeded on enable: the fixture writes the name and email
   questions itself (`saveAppointmentField` with `role`, `screen`,
   `generated`), and they are the whole form, still onboarding's to rewrite.
1. Settings round-trip through the sanitizer.
2. Services, providers and locations save and read back whole (add-ons,
   variants, deposit, an https image); services reorder.
3. The flow carries services, providers, locations and public rules; promo
   codes never leave the server; the preselect names the service; business
   name and zone ride along; booking off is no flow at all.
4. Availability: a month of days with open ones; an open day has slots with
   both providers free and an opening instant; an unknown service draws
   nothing bookable.
5. A quote prices the variant, add-on, travel and promo (`65 + 10 + 15 − 9 =
   81`, deposit `16.20`); outside the service area is refused.
6. "Anyone available" books and assigns a provider with the add-on's minutes
   included; the same slot goes to the other provider; a third is *full*;
   and can join the waitlist; the owner sees who, what, where and what was
   agreed.
7. Rejections the client can't talk past: unknown service, a mode the service
   doesn't offer, a missing required email, an instant off the grid, a
   provider who doesn't perform the service — and a partial save of the
   service keeps its other fields.
8. A weekly series books three, a week apart, tagged as one series; a series
   that can't complete books nothing.
9. Cancelling frees the provider's slot and leaves the owner's list.
10. A booking answered through the form alone (no customer object) names the
    customer by role.
11. A hand-written form with a menu question: every field, contact ones
    included, is in `getBookingFlow().fields` in the stored order; name and
    email are ordinary role-tagged fields, still required; the menu is the
    owner's own — no service is derived from it, the flow sells nothing and
    the card asks it as a question; each hand-written field sits on a screen
    of its own; booking through that form works with no service row at all,
    and the owner sees the pick with its price and the customer by role.
12. A required menu with no pick is refused by the form's own label.
13. Refresh from the site (`enrichServices`): an unpriced service gets its
    price, description, add-on and a photo from the pages; a service the
    site names that the owner lacks is added; a price the owner set is never
    overwritten.
14. A phone-only site (the real services stage with a scripted model): the
    channels are recorded, confirmation becomes a request the owner confirms,
    the card is told the business's number and the mode, an owner's own
    choice outlives a later site read, and a site with no booking link copies
    no form (the tenant's form stays empty).

### D. The card (`app/cards/Cards.tsx`), static render
1. A booking block outside a chat draws its own thread shell; no step is
   asked before the browser takes over and there is no step counter; no
   network needed; the business's number as a tap-to-call link ("Prefer to
   call?"); no preview banner for a visitor, one for the owner. The service
   step opens with a tile per service — the imaged one draws its photo, the
   others a placeholder; prices read as the business would say them;
   durations, the deposit and mode badges; category chips; a finished
   booking locks the card.
2. An old stored block (no flow) renders nothing until the fetch — no crash,
   no question, no step counter — and when no flow comes back the one line
   says booking is unavailable.
3. The services card shows thumbnails, prices and a Book button per service;
   Book outside a chat opens a booking thread of its own with the service
   already chosen (the shell is in place on the server).
4. A migrated tenant walks today's order; the first screen is the old
   details step; the options step appears once a service with options is
   chosen; a block from before roles and screens reads as one question per
   screen.
5. A business whose form asks for details first: that screen is the first
   card asked, its fields together, required ones starred, with the screen's
   own heading, placeholder and help line; no Back button and no step
   counter; Next waits for the required answers; Update on a step already
   answered; a locked step keeps its answers in view.

## Result
190 assertions, all passing (2026-09-25). Rewritten for the picker-free form:
no default seeding, no `customerFields`, no legacy bridge — the form is the
tenant's own, contact details are role-tagged fields, and a booking is
`createBooking` alone. `tsc --noEmit` and `next lint` clean for the whole
repo.

## Verified live (dev server, `/a/demo-salon`, Chromium via Playwright, zero model calls)
A seeded salon (five services with photos, two providers with photos, three
locations, a promo code, tips, a membership, a percent deposit, four intake
questions incl. a conditional photo upload, a waiver and a signature) and a
canned answer carrying `show_booking`. Typing "Book an appointment" drew the
card; the click-through went service tile → detail → Choose → option + add-on
→ Sarah (photo, role, specialties, languages, credential, her own $55, next
available) → Main Street → Earliest available → details → yes/no → the
conditional photo step appeared and was skipped → waiver agreed → a signature
drawn on the pad and uploaded → review (header block, Option, Add-ons,
Provider, Location, Date & time, Duration, Your details, answers with the
signature as a thumbnail, price breakdown, promo WELCOME10 applied, 20% tip,
deposit due today, cancellation policy) → Confirm booking → "You're booked."
with every fact, the tenant's note and Add to calendar. "What services do you
offer?" then drew the services card with thumbnails, prices, durations and a
Book button per service. Found and fixed on the way: "Earliest available" only
picked the day (now picks the slot); a stored-sample block showed "Loading…"
before its first question (now draws at once); the review listed uploads by
path and the variant under Add-ons; and an un-themed tenant got white text on
the light card fill (lib/theme.ts now leaves the stylesheet's own pairing in
place when neither background nor surface is chosen).


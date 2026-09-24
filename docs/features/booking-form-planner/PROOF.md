# Proof — The booking form each business would have built itself

## Primary proof command
```
npx tsx docs/features/booking-form-planner/proof.ts
```
Exit 0 and `All checks passed.` Offline: no model call, no network. Runs
against the local dev Postgres under throwaway users, deleted at the end. The
scripted `llm` passed to `extractServicesAndBooking` is the one doubled boundary.

## Assertions (all must pass)

### A. Finding the booking page (`lib/onboarding/bookingPage.ts`, pure)
1. An offsite "Booking" link to a booking platform is found; a known platform
   host wins over an on-site link that merely says "book".
2. Facebook / Instagram / `mailto:` / `tel:` links never count.
3. `isSafeExternalUrl`: `https` public hostnames pass; `http`, IP literals,
   `localhost`, `.local`, `.internal` fail.
4. The booking corpus is labelled `=== BOOKING PAGE`, and a sentence the widget
   repeats forty times appears once.

5. A trade's "Get a Quote" / "Request Estimate" link is its booking link.
6. A booking platform's own advert ("Powered by", ambassador and `utm_campaign`
   links) is never the booking page.
7. `findBookingFrames`: embedded booking and form widgets (Jotform, OpenTable…)
   are found once each; maps, video and `about:blank` frames are not.

### B. The plan per kind (`lib/bookingFormPlan.ts`, pure)
The plan is the intake alone: the service and the person are steps of the
booking flow, drawn from the Service and StaffMember rows the same stage
seeds, so they are never questions.
1. `personal_service` with services and staff: name, phone (required), email
   (optional), notes — no service or staff question, however many the site names.
2. No staff named → still no staff question.
3. `table`: party size is a required number 1–20; phone required.
3b. `table` never gets a services menu: a restaurant's "services" are dishes.
4. `home_service`: address and job description required; the parts of an
   address (state, city, zip) are not asked beside it; a requirement the plan
   already asks in other words ("Where Is The Project?", "What Do You Need
   Done?") is dropped, as is a file upload the wizard cannot ask — leaving room
   for the business's own question (the recorded parking dropdown).
5. `consultation` / `other` with no services keep "What would you like to talk
   about?"; `other` with services asks nothing more.
6. Site evidence beats the norm (site says email required → required).
7. An extracted requirement that duplicates a planned question — or asks for
   the date and time, which the wizard's last step always does — is dropped;
   the plan never exceeds 8 questions; name is always first and required; at
   least one contact is required.

### C. The onboarding stage against a fresh tenant
1. Booking on by default seeds the three defaults, the untouched form.
2. The services stage writes `Service` rows priced and timed from the menu's
   own words, so the flow has a service step and the card is asked only for
   notes.
3. It rebuilds the untouched form as the intake alone (name, phone, email,
   notes), every question `generated`.
4. Re-running with a changed price rewrites the untouched form and never
   duplicates a service.
5. After one admin save the form is the tenant's: the stage writes nothing,
   and no question is `generated` any more; reordering and deleting claim it too.
6. A staff name the text never contained is dropped; the rest become
   providers, once — the same name seeded twice is one row.

### D. The real business, replayed offline
The scripted model answer mirrors what the live extractor returned for
MoonLight on 2026-09-21 (`truth.moonlight.ts`); the form built from it is held
to what MoonLight's own booking page asks: a sectioned, priced service step
(Basic Manicure $22.00, Gel Manicure $35.00, as `Service` rows), name and
phone required, email optional, a technician preference (optional text — the
page's staff names only render after a service is picked, so no provider
rows exist to make it a step), notes, and nothing else.

### Z. No proof users left behind.

## Secondary: any business, live and unscored
```
npx tsx docs/features/booking-form-planner/try.ts <site url> [more urls…]
```
Prints the form built for a site so it can be held up against that business's
own booking page. `LOCAL_CHECKS.md` records three such comparisons.

## Secondary: live cross-check (not the primary proof)
```
npx tsx docs/features/booking-form-planner/crosscheck.ts
```
Real crawl of moonlightnailsspabrighton.com (and its GoCheckIn page), real
model, throwaway tenant. Prints the form built and scores it against
`truth.moonlight.ts`. Network and one model call; output varies, so a miss is a
prompt to read the output, not a gate.

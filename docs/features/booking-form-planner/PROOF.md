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
1. `personal_service` with services and staff: name, phone (required), email
   (optional), services menu, staff select led by "Any available", notes.
2. No staff named → no staff question.
3. `table`: party size is a required number 1–20; phone required.
3b. `table` never gets a services menu: a restaurant's "services" are dishes.
4. `home_service`: address and job description required; the parts of an
   address (state, city, zip) are not asked beside it; a requirement the plan
   already asks in other words ("Where Is The Project?", "What Do You Need
   Done?") is dropped, as is a file upload the wizard cannot ask — leaving room
   for the business's own question (the recorded parking dropdown).
5. `consultation` / `other` with no services keep "What would you like to talk about?".
6. Site evidence beats the norm (site says email required → required).
7. An extracted requirement that duplicates a planned question — or asks for
   the date and time, which the wizard's last step always does — is dropped;
   the plan never exceeds 8 questions; name is always first and required; at
   least one contact is required.

### C. The recorded failure: an untouched default form
1. **First read** — a tenant with the three defaults and services on file is
   handed the services menu in place of `reason`; it is written down once, so
   what is shown is what is stored, still `generated`; an admin can delete the
   menu and it stays deleted.
2. `createAppointment` validates against that same form (the menu is required;
   a pick is stored with its price).
3. **Onboarding** — running the services stage for that tenant rewrites the
   form (it previously wrote nothing): menu, phone, notes, all `generated`.
4. Re-running with a changed price refreshes the menu.
5. After one admin save the form is the tenant's: the stage writes nothing,
   and no question is `generated` any more.
6. A staff name the text never contained is dropped.

### D. The real business, replayed offline
The scripted model answer mirrors what the live extractor returned for
MoonLight on 2026-09-21 (`truth.moonlight.ts`); the form built from it is held
to what MoonLight's own booking page asks: a sectioned, priced, pick-several
menu (Basic Manicure $22.00, Gel Manicure $35.00), name and phone required,
email optional, a technician preference (optional text — the page's staff
names only render after a service is picked), notes, and nothing else.

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

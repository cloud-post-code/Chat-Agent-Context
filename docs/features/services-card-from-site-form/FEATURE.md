# Feature — The services card is built from the site's own form, never from defaults

## Summary

Requested 2026-09-23. On `/a/blake` (MoonLight Nails & Spa) every service row
reads "Varies · 30 min" beside a photo, while the salon's own booking page
shows a price beside every service and no photo at all. None of the three
things on the row came from the site: "Varies" is what an empty price prints
as, "30 min" is the tenant's default appointment length, and the picture was
matched to the name by word overlap (or drawn as a letter tile when nothing
matched). The card is a fixed template with three slots that get filled
whether or not the site said anything.

This turns the card into a composition: the block carries only the facts the
site stated and the shape of the form the site itself uses, and the renderer
draws an element only when its fact is present. Where the site has no
booking form, a booking is still made from what the site does say — the
people, the way to reach them, the request nature of it — and nothing else.

## Desired Behavior

### What the extractor reports, beyond what it reports today
- `form`: the layout of the site's own service list or booking page, when one
  was read — where it came from (`booking_page` or `services_page`), whether
  it groups services under headings, whether several can be picked at once,
  whether a staff step follows, whether it has a search box, and which facts
  it shows per row (price, duration, image, description). Absent when no
  such page was reachable; never guessed.
- `staffContacts`: a person the text says to reach directly for a booking,
  with the number as written ("TEXT TINA AT (781) 799-1545"). Only names the
  text contains.
- `channels` gains `text` ("text us for an appointment").

### What is stored
- Booking settings keep `siteForm` (the `form` above, or null).
- A staff row keeps `phone` ("" when unstated).
- Nothing else new is stored. Service rows keep their existing shape; a
  service the site did not price stays unpriced, and a service the site did
  not time stays untimed in every visitor-facing place.

### The services block
- Each item carries `id`, `name`, and then only the facts the site stated:
  `price` (the site's exact string, "$22.00" not "$22"), `duration`,
  `description`, `imageUrl`, `category`. A missing fact is a missing key,
  never "Varies", never a default length, never a placeholder.
- An `imageUrl` is only one the extractor tied to that item from the page's
  own structure. No image is ever matched to an item by word overlap, and an
  item never inherits a category banner or a gallery photo.
- `form`: the stored site form, or null.
- `sections`: the items grouped under the site's own headings in the site's
  order, when the form groups them; null otherwise.
- `channels`: the ways the site says to book, each with a label, the person
  it names when it names one, and a `tel:`/`sms:`/`mailto:`/URL target.
- `request`: true when a booking from the card is a request the business
  confirms rather than an instant booking.
- `booking`: unchanged — the tenant's live booking fields and flow.
- Null when nothing at all is on file, as today.

### The card
- A row renders name, then price if present, then duration if present, then
  description if present, then image if present. No image column exists
  when there is no image; no letter tile; no "Varies"; no "· 30 min".
- With `sections`, the rows sit under headings as an accordion, the first
  open. With `form.search`, a search box sits above. With `form.pickMany`,
  rows carry a pick control and one Continue hands the picks to the booking
  flow; otherwise each row has a Book button as today.
- `channels` render under the list as the site's own ways to book ("Text
  Tina · (781) 799-1545"). When `form` is null and the site has an online
  booking link, one line says booking is through their site, with the link.
- The booking tiles inside the booking flow follow the same rule: no
  placeholder image, no invented price or duration.

### A site with no booking form
- The booking is still made, from what the site states: the people it names
  (with their stated numbers), the stated channel, name and phone required
  when the channel is phone or text, notes. It is marked a request the
  business confirms.
- Services appear only if the text names them as offered, unpriced and
  untimed. No service, price, duration, hours or question is invented.

### A tenant onboarded before prices were extracted
- A name-only catalog draws a name-only card: no "Varies", no default
  length, no placeholder. Refreshing from the site fills what the site
  states.

## Scope
`lib/onboarding/services.ts` (prompt, sanitizer, extract type),
`lib/onboarding/bookingSeed.ts` (no image matching for services; no display
duration fallback; staff phone; channels), `lib/booking/types.ts`
(`SiteForm`, `BookingChannel` `text`, `StaffRow.phone`,
`BookingSettings.siteForm`), `lib/booking/store.ts` (persist; no
`bestImageFor` for services in `materializeServices` / `legacyServices`),
`lib/cards.ts` (block shape, `servicesBlock`), `app/cards/Cards.tsx`
(`ServicesCard` exported, composed rendering), `app/cards/booking/ServiceStep.tsx`,
`lib/serviceCatalog.ts` (price, duration, category survive in the record),
README, agent.md.

## Non-Goals
- Slot math, availability, payments — unchanged.
- Reading a form that only renders after a click (staff names behind a
  service pick stay unknown, as recorded in booking-form-planner).
- Editing the site form shape in the admin.

## Scenarios
- MoonLight Nails & Spa: gocheckin booking page → sections (Manicure,
  Pedicure…), price per row, pick several, staff step, search; no image, no
  duration. The card shows exactly that.
- Anthony's Barber Styling: a Wix one-pager with bios, "Text us for an
  appointment", a number per barber, "Our hours vary", no prices, no form.
  The card lists what the bios say is offered, unpriced, with "Text Anthony /
  Tina / Ed" under it; the booking is a request with name, phone, a barber
  pick led by "Any available", and notes.
- Blake's tenant today: names only on file → names only on the card.
- An extractor-named image on one item never spreads to its neighbours.

## Constraints
- A2UI: the block carries data, never markup; the renderer skips what it
  doesn't know.
- Never invent: an unstated fact is absent, not defaulted. The only fallback
  allowed is internal to slot math (a default length for the calendar), which
  never reaches a row the visitor sees.
- Owner-edited rows and settings are never overwritten by a site read.
- Additive migration only.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

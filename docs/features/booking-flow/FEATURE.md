# Feature — The full booking flow as an A2UI card

## Summary

The booking card in the chat becomes a complete booking site, not a
questionnaire with a date box at the end. A visitor picks a service from a
grid of photographed tiles (price, duration, what's included, add-ons,
packages, who performs it, what to prepare, the cancellation policy), a
provider ("anyone available" or a named person with photo, role, bio,
specialties, languages, credentials, their own price and next opening), a
location (a branch, online, or their own address inside a service area with a
travel fee), a live time from a calendar that knows the business's hours,
holidays, lead time, cutoff, buffers, advance window and every provider's
diary, then gives the minimum contact details the tenant asks for, answers the
tenant's own intake questions (text, choices, counts, dates, addresses, file
and photo uploads, a drawn signature, a waiver, conditionally shown), sees a
review screen with a full price breakdown (add-ons, travel, promo codes,
membership, tax, fees, tip, deposit) and taps one prominent **Confirm
booking**. The tenant configures all of it in the admin, and onboarding seeds
it from the business's own website — services with photos, the team, the
locations and hours — so a fresh tenant's card mirrors the booking their site
already offers.

## Why

The appointment wizard (docs/features/appointment-booking, extended by
booking-menu-fields and services-card) asked one configured question at a
time and took any future instant. It could not show a price list with
pictures, never knew who was free, offered no calendar, and asked a plumber's
customers the same shape of form as a salon's. Every business that books
online already has a flow its customers know — service, person, place, time,
details, confirm — and a chat card that does less than the site loses the
booking to the site, or to nobody. The card has to be as good as the site
they already have, inside the conversation, with images.

## Desired behavior

Stated in [DESIGN.md](DESIGN.md), which is the contract every module was
built against. In short:

- **Service**: image tiles, category chips, search past eight, a detail view
  with add-ons, variants/packages, performers, eligibility, preparation,
  policy; "Free", "$45", "From $45", "$45–$80", "$45/hr", "$12/person",
  "$40/room", "Quote", "Varies" pricing; deposit and mode badges.
- **Provider**: optional / required / hidden per tenant; "Anyone available";
  photo, role, bio, specialties, languages, credentials, individual price,
  next available; gender-preference filter only when the tenant turns it on.
- **Location**: branches, online, the customer's address; postal-code
  eligibility, radius, travel fee, hours and timezone per location.
- **Date & time**: month calendar of open days, "Earliest available", slots
  in the visitor's zone with the business zone noted, waitlist when full,
  weekly / biweekly / monthly repeats, all computed by a pure engine from
  hours, holidays, lead time, daily cutoff, same-day rule, advance window,
  buffers, provider hours and time off, and existing bookings.
- **Details**: first name, last name, email, phone and SMS consent always;
  address, company, birthday, preferred contact, new/returning, referral
  source and notes only when the tenant asks.
- **Questions**: the intake builder with short/long text, number, dropdown,
  multiple choice, checkboxes, yes/no, date, address, file, photo, signature,
  waiver, required/optional and "only ask when…" conditions.
- **Pricing**: computed server-side from the same pure module the card uses
  for its running total; the review's figures come from a quote endpoint.
- **Review**: the appointment at a glance, then every section with Edit, the
  breakdown, deposit and policy, then Confirm booking.
- **Booked**: every fact, add-to-calendar, the tenant's note; a waitlist
  variant.

## Decisions

**Structured tables, not more knowledge text.** Services, providers and
locations become rows (`Service`, `StaffMember`, `BookingLocation`) with the
long tail in one sanitized JSON column each, because prices, durations,
buffers and who-can-do-what are computed with, not merely quoted. The
knowledge catalog that the services card and the agent read stays as it was;
`show_services` prefers the rows when they exist.

**Existing tenants are upgraded on read.** A tenant with no `Service` rows is
handed services derived from their intake service picker (already upgraded
from the old text box), priced by `pricingFromText`, with an image matched
from their gallery. Their name/email/phone questions fold into the customer
step. Nothing is migrated as data and nothing they configured is touched.

**Two providers may share an instant.** The `(userId, startsAt)` unique index
is gone; the write path takes a per-tenant advisory lock, checks overlap
against the provider and room, then inserts. The old intake-only path keeps
"same instant = taken" through the same lock, so its proofs still hold.

**The card never trusts itself.** Duration, price, provider assignment,
eligibility and the slot are all recomputed server-side from the selection's
ids; the card's running total is convenience.

**Fail closed.** Booking off → no flow, no slots; an unknown id, a provider
who doesn't perform the service, a postal code outside the area, an instant
off the grid — all rejections with reasons.

**Images from the tenant's own material first.** Onboarding matches each
service and person to an image on the pages that describe them; the admin can
upload; the gallery is the fallback; a themed placeholder is the last resort,
so every tile has an image area.

## Non-goals

Charging a deposit (recorded, not taken), external calendar sync, reminder
notifications, visitor-side reschedule, and new dependencies.

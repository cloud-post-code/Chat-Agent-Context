# Feature — The booking form each business would have built itself

## Summary

Reported 2026-09-21 with a screen recording: MoonLight Nails & Spa's booking
card asked "Your name / Your email / What would you like to talk about?" and a
bare date box. No service menu, although forty services were on file and
`booking-menu-fields` had shipped that morning.

Three causes, all in how the form gets built:

1. **The gate.** `seedBookingForm` only writes into an *empty* catalog. Booking
   is on by default, and the first enable seeds the three generic defaults — so
   by the time onboarding knows the services, the catalog is "not empty" and
   nothing is written. Re-running onboarding hits the same gate.
2. **The read-time upgrade is too narrow.** It converts only the old generated
   "Which service are you booking?" text box. An untouched default form has no
   such question, so nothing is converted.
3. **Onboarding never reads the real booking page.** The crawler is pinned to
   the site's origin. MoonLight books through `booking.gocheckin.net`, like most
   small businesses book through an offsite widget. That page is where the full
   priced menu and the booking questions actually are.

## What the right form is

Cross-checked against MoonLight's live GoCheckIn flow (recorded in
`truth.moonlight.ts`): service menu by category with prices, pick several →
technician ("any available" or a name) → date and time → full name (required),
phone (required), email (optional), appointment notes.

The rule that generalizes: **ask what the business itself asks when it takes a
booking, and where the site is silent, ask what that kind of business
normally asks.** Evidence from the site always wins over a norm.

| Kind | Examples | Asks (besides name and time) |
|---|---|---|
| `personal_service` | salon, spa, barber, clinic, studio | phone (required), email (optional), services menu, who they'd like to see (when staff are named), notes |
| `table` | restaurant, bar, café | party size 1–20 (required), phone (required), email (optional), notes (allergies, occasion). Never a services menu — its "services" are dishes |
| `home_service` | trades, cleaning, repair, mobile | phone (required), email (optional), services menu, service address (required), what needs doing (required) |
| `class` | classes, tours, events | how many are coming 1–30 (required), email (required), phone (optional), notes |
| `consultation` | agencies, advisers, coaches | email (required), phone (optional), services menu, what they'd like to talk about |
| `other` | anything else, or unknown | today's form, unchanged: email (required), services menu or "What would you like to talk about?" |

Order stays who → what → the specifics → notes (the existing contract). The
form never exceeds 8 questions; extracted requirements are dropped first, and
one that repeats a planned question in other words, asks for the date, or asks
for a file upload (the wizard has no such question) is dropped outright.

## Desired Behavior

### Reading the booking page
- Onboarding's services stage finds the business's booking link on the
  homepage — any `<a>` whose text or URL says book / appointment / schedule /
  reserve, or whose host is a known booking platform — **including offsite**.
- One offsite page may be loaded, only over `https`, only to a public hostname
  (no IP literals, `localhost`, `.local`, `.internal`), only when the link came
  from the business's own page. Social, `mailto:` and `tel:` links never count.
- A trade's booking is a request, so "Get a Quote" and "Request Estimate"
  count as booking links; a booking platform's own advert never does.
- Booking and form widgets embedded as iframes in the homepage or the booking
  page (OpenTable, Vagaro, Jotform…) are read too, at most two per business,
  under the same host rule — most "Book now" pages are a shell around one.
- Its text joins the extraction corpus under `=== BOOKING PAGE <url>` with a
  larger budget (9 000 chars) and repeated boilerplate sentences removed.
- The extractor additionally reports `kind`, `staff` (names a customer can
  choose; copied, never invented), `phone` / `email` (`required` | `optional` |
  `unknown`) and `notes`. Up to 60 services (was 40).
- Staff names are kept only when they appear verbatim in the text read.

### Building the form
- `lib/bookingFormPlan.ts` (pure): `planBookingForm(facts)` returns the ordered
  questions per the table. The services menu is still built by
  `servicePickerField` — prices come from the catalog, never the planner.
- Every question onboarding writes is marked `generated` in its config.

### Whose form it is
- A form is **untouched** when it is exactly the three defaults, or the
  defaults plus the legacy picker, or every question is still `generated`.
- Onboarding (re)builds an untouched form; a form the tenant has edited is
  theirs and is never rewritten. Any admin save, delete or reorder clears
  `generated` from every question.
- **Existing tenants, no re-onboarding:** the first time an untouched default
  form is read with services on file, the services menu replaces "What would
  you like to talk about?" — written down once, idempotently, still
  `generated`. (Written rather than presented like the legacy picker: the
  menu's key is `service`, the row it replaces is `reason`, and an admin who
  deletes or saves the question they are shown must be acting on a stored row.)

## Scope
`lib/bookingFormPlan.ts` (new), `lib/onboarding/bookingPage.ts` (new),
`lib/onboarding/services.ts`, `lib/onboarding/crawl.ts` (`loadExternal`),
`lib/appointments.ts`, `lib/appointmentTypes.ts` (`generated`), README,
`agent.md` (extraction prompt changed).

## Non-Goals
- Clicking through a third-party booking wizard (staff lists and contact steps
  that only render after interaction are covered by the norms instead).
- Time slots from business hours — the date step is still a free date box.
  Real booking pages offer 15-minute slots inside opening hours; separate feature.
- Asking service first and contact last, as booking platforms do. Would change
  the order contract two other proofs assert; separate decision.
- Writing bookings into the business's own booking system.

## Constraints
No new dependency, no migration (`generated` lives in the existing config JSON).
Offsite loading is limited to the one booking link; the host check is by name
(public `https` hostnames, re-checked after redirects), not by resolved address.

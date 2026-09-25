# Design — The full booking flow as an A2UI card

This is the contract every part of the feature is built against. The shapes
are in [`lib/booking/types.ts`](../../../lib/booking/types.ts) (import-free) and
the intake question rules in [`lib/appointmentTypes.ts`](../../../lib/appointmentTypes.ts).
Read both before touching anything below. Nothing here is markup: the card is
handed data and renders from a closed vocabulary, the server never trusts the
card, and every uncertain state fails closed.

## The visitor's flow (a conversation of cards)

The booking is a SEQUENCE of cards down the chat, one per step, not one card
with a wizard inside it (see
[`docs/features/booking-in-chat/FEATURE.md`](../booking-in-chat/FEATURE.md)).
`show_booking` — or Book on the services card — starts a session; for each
step the host appends an assistant line with the step's intro (typed in) and
the step's card under it; the finished card answers back as one user line
and the next ask appends below:

```
Which service would you like?        [service tiles]
                                          Picked: Gel Manicure · $35
Any options or add-ons?              [variant / add-ons / quantity — only when the service has any]
                                          Options: Shoulder length
Who would you like to see?           [providers — only when the tenant shows providers]
                                          Provider: Katherine   (or: anyone available)
Where?                               [locations — only when there is a choice]
                                          Where: 12 Sea Road
When works for you?                  [calendar + slots]
                                          When: Fri, Sep 25, 10:00 AM
<the business's own screen title>    [that screen's fields]
                                          Details: Ada · ada@… · 555-1234   /  Answers: …
Here's your booking — check it over. [review + Confirm]
                                          Booked: …
You're booked — the details are below.  [confirmation]
```

The order is the business's own (`rules.flow`, `planSteps`); review is
always last; steps with nothing to ask are skipped; the intro is the
business's screen title when it has one, else the fixed line
(`lib/booking/session.ts` `intro`). Every earlier card stays on the page and
stays editable ("Update"): an edit rewrites that step's line in place (ids
`<sessionId>:<stepId>:ask` / `:reply`), and a step the edit makes necessary
(options after switching to a service with variants) is asked below the
review with Confirm disabled — "One more thing to answer — see the step
below." — until answered. A typed question mid-booking is answered in the
thread (the model is sent one `Booking so far: …` line for the session) and
the booking carries on. The review lists every part of the appointment; the
visitor's answers are never lost on an error; confirming locks the cards.
The owner's onboarding preview runs the same sequence over a local thread
and books nothing.

## Data

| Table | Row shape | Long tail |
|---|---|---|
| `Service` | `ServiceRow` | `config` JSON = `ServiceConfig` (`sanitizeServiceConfig`) ; `pricing` JSON = `Pricing` (`sanitizePricing`) |
| `StaffMember` | `StaffRow` | `config` JSON = `StaffConfig` (`sanitizeStaffConfig`) |
| `BookingLocation` | `LocationRow` | `config` JSON = `LocationConfig` (`sanitizeLocationConfig`) |
| `BookingSettings` | `BookingSettings` | one `config` JSON (`sanitizeBookingSettings`); no row = defaults |
| `AppointmentField` | intake questions (unchanged table; new types + `showIf`) | |
| `Appointment` | one booking; denormalized names, `customer`, `pricing` JSON, `status` | |

Image columns hold a stored upload **filename**; rows expose `imageUrl` /
`photoUrl` as `/api/uploads/<filename>` (the Photo precedent in lib/cards.ts).

## Modules and who owns them

### `lib/booking/time.ts` — timezone math, pure
```ts
export function zonedParts(d: Date, tz: string): { y; m; d; hh; mm; weekday: DayKey; date: "YYYY-MM-DD" }
export function zonedToUtc(date: "YYYY-MM-DD", time: "HH:MM", tz: string): Date   // handles DST
export function addMinutes(d: Date, n: number): Date
export function ymd(d: Date, tz: string): string
export function shiftDays(date: "YYYY-MM-DD", n: number): string
export function formatInZone(d: Date, tz: string, opts?: Intl.DateTimeFormatOptions): string
```

### `lib/booking/availability.ts` — the availability engine, pure
```ts
export type Booked = { startsAt: Date; endsAt: Date; staffId: string | null; locationId: string | null; status: string };
export type AvailabilityInput = {
  settings: BookingSettings;            // hours, holidays, interval, lead time, cutoff, same-day, advance window, buffers
  service: ServiceRow | null;           // its buffers; null = a plain appointment
  durationMinutes: number;              // base + add-ons, already resolved by the caller (pricing.ts durationFor)
  staff: StaffRow[];                    // the candidates: the chosen provider alone, or everyone who can perform the service; [] = no provider tracking
  location: LocationRow | null;         // its hours/timezone override the business's when set
  booked: Booked[];                     // confirmed appointments in the window (cancelled excluded by the caller)
  now: Date;
};
export function availableDays(input, month: "YYYY-MM"): DayAvailability[]     // one per calendar day, in the business zone
export function availableSlots(input, date: "YYYY-MM-DD"): Slot[]           // startsAt/endsAt ISO, staffIds free for it
export function earliestSlot(input): Slot | null                            // scans from now to maxAdvanceDays
export function checkSlot(input, startsAt: Date): { ok: true; staffId: string | null; endsAt: Date } | { ok: false; reason: string; full: boolean }
   // full=true when the slot is inside hours but every provider/the room is taken → waitlist eligible
```
Resources: a location's `capacity` (default 1) is how many bookings may
overlap there when `staff` is empty — chairs, bays, rooms. With providers the
provider is the resource. Location `priceOverrides[serviceId]` is a fixed price
for the service at that location; a provider's own override wins over it.

Rules: business hours (or the location's), holidays closed, provider hours when set
(else business hours) minus time off, lead time from `now`, `dailyCutoff` (after
that wall-clock time, the following day is closed), `sameDayBooking` false
closes today, `maxAdvanceDays`, slot interval, buffers (max of settings and
service, before and after), overlap against `booked` per provider (a booking with
`staffId: null` blocks every provider when `staff` is empty, and blocks nobody
specific but counts against the room when providers exist — treat a null-staff
booking as blocking ONE provider: the first free one). A slot needs
`start ≥ now + leadTime` and `end ≤ close`.

### `lib/booking/pricing.ts` — the pricing engine, pure
```ts
export type PriceInput = {
  service: ServiceRow | null; variant: ServiceVariant | null; addons: ServiceAddon[]; quantity: number;
  staff: StaffRow | null; location: LocationRow | null; mode: ServiceMode;
  settings: BookingSettings; promo: PromoCode | null; membership: Membership | null;
  tipPercent: number | null; tipAmount: number | null;
};
export function durationFor(i: Pick<PriceInput, "service"|"variant"|"addons"|"staff"|"settings">): number
export function priceBreakdown(i: PriceInput): PriceBreakdown
export function findPromo(settings: BookingSettings, code: string, serviceId: string | null, today: "YYYY-MM-DD"): PromoCode | null
```
Order of lines: service (staff override beats variant beats service pricing;
hourly × quantity hours, per_person/per_unit × quantity), add-ons, travel fee
(mobile mode, location serviceArea.travelFee), promo (negative), membership
(negative, percent of subtotal after promo), fee, tax (percent of the taxed
amount: subtotal after discounts + fee), tip. `estimate` when any line is a
floor; `quoteRequired` when the pricing kind is `quote` (then total = priced
add-ons only and `display` = "Quote"). Deposit from the service's `deposit`
(fixed, or percent of total). `display` = `pricingLabel` of the effective
pricing when nothing else applies, else the formatted total ("From $45" when
estimate).

### `lib/booking/hours.ts` — pure text → hours
```ts
export function parseHoursText(text: string): HoursRange[]          // "9 AM–7 PM", "9:00-17:00", "Closed", "9am - 1pm, 2pm - 6pm"
export function weeklyHoursFrom(hours: Record<string, string>): WeeklyHours | null   // onboarding's {monday: "9 AM–7 PM", ...}
export function timezoneFromAddress(address: string): string | null  // US state → IANA zone, null when unsure
```

### `lib/booking/store.ts` — Prisma reads and writes (server only)
```ts
export async function listServices(userId): Promise<ServiceRow[]>            // enabled and disabled, in order
export async function saveService(userId, input: Partial<ServiceRow> & { name: string; id?: string; imageFilename?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
export async function deleteService(userId, id): Promise<void>
export async function moveService(userId, id, dir: "up" | "down"): Promise<void>
export async function listStaff(userId): Promise<StaffRow[]>
export async function saveStaff(userId, input: Partial<StaffRow> & { name: string; id?: string; photoFilename?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
export async function deleteStaff(userId, id): Promise<void>
export async function moveStaff(userId, id, dir): Promise<void>
export async function listLocations(userId): Promise<LocationRow[]>
export async function saveLocation(userId, input: Partial<LocationRow> & { name: string; id?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
export async function deleteLocation(userId, id): Promise<void>
export async function moveLocation(userId, id, dir): Promise<void>
export async function getBookingSettings(userId): Promise<BookingSettings>
export async function saveBookingSettings(userId, patch: Partial<BookingSettings> | unknown): Promise<void>   // merged over the stored config, then sanitized

/** The block the card is handed. Null when booking is off. */
export async function getBookingFlow(userId, opts?: { preselectServiceId?: string | null }): Promise<{ flow: BookingFlow; intake: BookingField[] } | null>

export async function quoteBooking(userId, selection: BookingSelection): Promise<{ ok: true; breakdown: PriceBreakdown } | { ok: false; error: string }>
export async function availability(userId, q: { serviceId; variantId; addonIds; staffId; locationId; month?; date? }): Promise<{ timezone; days?: DayAvailability[]; slots?: Slot[]; earliest: Slot | null; full?: boolean }>
export async function createBooking(userId, selection: BookingSelection): Promise<{ ok: true; id: string; status: "confirmed" | "waitlisted"; startsAt: string; endsAt: string; breakdown: PriceBreakdown; staffName: string; locationName: string; serviceName: string; ids: string[] } | { ok: false; error: string; full?: boolean }>
export async function listBookings(userId): Promise<AppointmentDetail[]>      // richer than listAppointments: service/staff/location/customer/pricing/status
export async function setBookingStatus(userId, id, status: "confirmed" | "cancelled"): Promise<void>
```

**What replaced the legacy bridge:** this section originally described deriving
`ServiceRow`s from the intake catalog's old service picker for a tenant with no
`Service` rows. That picker (`lib/bookingMenu.ts` and the picker bridge) is
gone: every tenant's services now come from the `Service` table onboarding
seeds (`lib/onboarding/bookingSeed.ts`), and a tenant with none simply has
`services: []` and the card books a plain appointment.

The fields handed to the card are every stored `AppointmentField` row —
contact details among them, told apart by their `role`, grouped into steps by
their `screen` (`sanitizeFlow`, `lib/booking/flowSteps.ts` `planSteps`) —
there is no separate "customer" catalog to subtract keys from or fold
`required` onto.

`createBooking` must: check enabled; load the flow; resolve the service /
variant / add-ons / provider / location by id (reject unknown ids, disabled rows,
a provider who does not perform the service, a location that does not offer
it, a mode the service does not allow, a postal code outside a mobile
location's service area when it lists codes); recompute `durationFor` and
`priceBreakdown` server-side; fold `selection.customer` into the answers by
the fields' roles (`foldCustomerIntoAnswers`) and run `resolveAnswer` on every
field that `isFieldShown` (required only when shown), reading the customer
back out of the validated answers by role (`customerFromAnswers`) for the
calendar, the .ics file and the knowledge index; then inside one
`prisma.$transaction` take `SELECT pg_advisory_xact_lock(hashtext($userId))`,
load overlapping confirmed bookings, run `checkSlot` (assigning a provider when
`staffId` is null), and insert — every occurrence of a recurrence in the same
transaction (all or nothing), waitlisted status when `full` and
`selection.waitlist` and `settings.waitlist`. Rejections are reasons, never
throws. Index each confirmed booking with `indexAppointment` best-effort
(unchanged), and drop it on cancel.

`lib/appointments.ts` keeps `getBookingConfig`, `listAppointments`,
`cancelAppointment` and field CRUD working as they always have; the
intake-only booking path (`createAppointment`) that `createBooking` replaced
is gone — every booking, timed or not, goes through `createBooking` now (an
order's own booking included, `lib/orders.ts` `bookFromOrder`).
`cancelAppointment` still sets status cancelled (keep the delete semantics for
the knowledge origin).

### API (`app/api/booking/…`)
- `GET  /api/booking?slug=…[&service=<id>]` → `{ ok, enabled, fields, flow }` (`fields` = every stored question, contact details included; `flow` = `BookingFlow` or null)
- `POST /api/booking` body `{ slug, ...BookingSelection }` → the `createBooking` result
- `GET  /api/booking/availability?slug&serviceId&variantId&addonIds=a,b&staffId&locationId&month=YYYY-MM` → `{ ok, timezone, days, earliest }`; with `&date=YYYY-MM-DD` → `{ ok, timezone, slots, full, earliest }`
- `POST /api/booking/quote` body `{ slug, ...BookingSelection }` → `{ ok, breakdown }` — the review screen's figures
- `POST /api/booking/upload` multipart `{ slug, file }` → `{ ok, path: "/api/uploads/…" }`; images (jpeg/png/webp/gif) and PDF, ≤ 8 MB. `lib/uploads.ts` must learn `application/pdf` (`.pdf`) and `readUpload` must serve it.

All routes resolve the tenant from `slug` exactly like today's route. Every
error is `{ ok: false, error }` with a 4xx.

### The cards (`app/cards/booking/`) — superseded by the conversation of cards
This section described the original single-card wizard. `show_booking` now
starts a session that draws one card per step down the chat thread instead
(`BookingSessionCard` → `BookingThread` → `BookingStepCard`, see the "The
visitor's flow" section above and
[`docs/features/booking-in-chat/FEATURE.md`](../booking-in-chat/FEATURE.md));
what is left of the single-card module is `toFlowFields`, the reading of a
block's fields the planner needs. `Cards.tsx` keeps
`{ type: "booking"; fields: BookingField[]; flow?: BookingFlow }`. A block
without `flow` (an old stored sample) fetches `GET /api/booking?slug` on
mount and renders from that; if that fails it shows one line saying booking
is unavailable, so nothing ever goes blank.

Card width: the chat column is ~720px; the card may use `maxWidth: 560`. Every
step is a `data-fill="bg-soft"` card in the existing `card` style with the
existing theme variables (`--surface`, `--on-surface`, `--primary`,
`--on-primary`, `--border`, `--radius-*`, `--font-heading`); no new CSS files,
no new dependencies. Images: `<img>` with `objectFit: cover`, a fixed aspect
box, `loading="lazy"`, and a themed placeholder (initial letter on a
`--primary`-tinted gradient) when `imageUrl` is null so every service tile has
an image area. Mobile: single column under 480px.

The service step is a grid of image tiles (name, price label, duration, mode
badges, deposit badge) with category chips above and a search box past eight
services; tapping a tile opens its detail (full description, add-ons,
variants, who performs it, eligibility, preparation, cancellation policy) with
a "Choose" button. `preselect.serviceId` skips straight past the step.

The provider step: "Anyone available" first (with the earliest slot when
known), then each provider: photo, name, role, specialties, languages,
credentials, price for this service when overridden, "Next available" (from
`availability` earliest, fetched per provider lazily), bio behind "More". A
gender-preference chip row filters providers when `rules.genderPreference`.

The location step: branches as tiles (name, address, hours today), "Online"
when the service allows it, "My address" for mobile (address + postal code,
checked against the service area, travel fee shown).

Date & time: a month grid (business zone) marking open days from
`availability` days; a "Earliest available" button; slots grouped Morning /
Afternoon / Evening in the **visitor's** zone with the business zone noted when
they differ and a zone `<select>` of common zones; waitlist prompt when a day is
full and `rules.waitlist`; a "Repeat" control (weekly / every 2 weeks / monthly ×
count) when `rules.recurring`.

Details step: the enabled customer fields, core first; SMS consent as a
checkbox; `customerStatus` as two buttons; `preferredContact` as chips.

Intake: the existing `QuestionInput` plus the new types: `date` (an
`<input type="date">`), `address`, `file` / `photo` (upload through
`/api/booking/upload`, preview a photo), `signature` (a `<canvas>` the visitor
draws on, exported as PNG and uploaded), `waiver` (the text in a scroll box and
an "I agree" checkbox). Conditional questions use `isFieldShown`.

Review: the header block exactly as specified —
```
Your appointment
Haircut
Sarah
September 28 at 2:30 PM
45 minutes
123 Main Street
$45
```
then Service, Provider, Location, Date, Time, Duration, Add-ons, Your details,
Price breakdown (each line, promo code entry when `rules.hasPromoCodes`, tip
chips when `rules.tips.enabled`, membership select when memberships exist),
Deposit / due today, Cancellation policy (service's, else the tenant's), then a
full-width **Confirm booking** button in `--primary`. The breakdown comes from
`POST /api/booking/quote` (re-fetched when the promo / tip / membership
changes), falling back to the pure `priceBreakdown` if the request fails.

Booked: the confirmation with every fact, an "Add to calendar" link (a
client-generated `.ics` data URL), the tenant's `confirmationNote`, and the
waitlist wording when `status === "waitlisted"`.

### Admin (`app/admin/booking/`)
A "Booking" section with sub-panels: Services, Providers, Locations, Hours &
rules, Customer details, Questions (the existing field editor, extended),
Pricing & policies. Server-action forms in the existing panel idiom
(`panel`, `field`, `btn`, `PendingButton`, one form per row); image upload
through the existing upload path (`saveUpload`). The Calendar panel shows the
richer appointment (service, provider, location, customer, price, status) and
the Questions editor gains the new types and a "Only ask when…" condition.

### Onboarding (`lib/onboarding/`)
The services extractor seeds `Service` rows (when the tenant has none) with
`pricingFromText`, `durationMinutes` from the text, category, description, and
an image matched from the services pages (an `<img>` whose alt / nearest
heading shares words with the service name, downloaded through `saveBytes`);
the team extractor seeds `StaffMember` rows (name, role, bio, photo matched
the same way); the locations stage seeds `BookingLocation` rows with parsed
hours; settings get the timezone from the address and the hours from the first
location. Never touch a table that already has rows for the tenant.

### Brain and prompt
`show_booking` gains an optional `service` input (the service's name or id):
the hydrator resolves it to `preselect.serviceId`. `show_services` draws from
`getBookingFlow` services when present (image, price label, duration) and falls
back to the knowledge catalog as today. `lib/knowledge.ts`'s BOOKING section
describes the flow in one paragraph (services with prices, providers,
locations, live times) so the model draws the card instead of asking.

## How the business takes bookings

The services extractor also reports the site's booking `channels` (online,
phone, email, walk-in). `applyBookingChannels` records them on the settings
and, unless the owner has set the switch by hand (`confirmationOwner`), sets
`confirmation`: `instant` when the site books online, `request` otherwise —
then the card asks for a phone number, labels the button **Request booking**,
and the confirmation says the business will confirm. The business's phone
number rides in `flow.business.phone`, and the service step always shows
"Prefer to call?" with a tap-to-call link, so there is a way to book even
when the card's own booking is a request. The offsite booking page (a
GoCheckin, Vagaro or Square widget linked from the homepage) is read by
`discoverServicePages` as onboarding does, with a 16k-character corpus so a
sixty-row menu fits.

## Non-goals
Payments (a deposit is recorded, not charged), external calendar sync,
notifications, visitor-side reschedule, and any new dependency.

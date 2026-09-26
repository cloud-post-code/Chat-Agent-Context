# Proof — The booking form is the business's own

## Primary proof commands
```
npx tsx docs/features/custom-booking-form/proof.ts
npx tsx docs/features/custom-booking-form/reader-proof.ts
```
Both exit 0 and print `All … checks passed.` **Zero model calls, no network.**

`proof.ts` runs against the local dev Postgres (`.env` `DATABASE_URL`, loaded
by the script) under throwaway users deleted at the end. The model is doubled
at its two seams only — the services `llm` and the transcriber's `formLlm` of
`extractServicesAndBooking` — and the browser at `readForm`; the static
reader, the sanitizer, `writeFormSpec`, `getBookingFlow`, `planSteps`,
`createBooking` and `bookingBlock` are the real code.

`reader-proof.ts` drives the fake four-screen widget (`reader.html`) in
headless Chromium with the same snapshot/advance functions `readBookingForm`
uses, then the static fallback, the serializer, the sanitizer and
`transcribeForm` with a scripted model. Offline: no site, no model, no
database.

The fixture is MoonLight Nails' GoCheckIn flow in miniature
(`fixture.moonlight.ts`: the snapshot the reader takes and the `FormSpec` the
transcriber is expected to return); `truth.moonlight.ts` is the real page as
walked by hand, which the live cross-check scores against.

## Assertions — `proof.ts` (all must pass)

### A. The static reader (`lib/onboarding/formReader.ts snapshotStatic`)
1. One static screen from the loaded HTML; the labelled inputs in order with
   their required marks (`Full Name*`, `Phone Number*`, `Email`, `Appointment
   Notes`, `I agree to the cancellation policy*`); each input keeps its own
   type (tel, email, textarea, checkbox) and placeholder.
2. The priced service tiles and the staff list are option lists under their
   headings; the policy paragraph is in the screen text; a page with no
   inputs is empty (nothing to transcribe).

### B. The sanitizer (`lib/onboarding/formTranscribe.ts sanitizeFormSpec`)
1. `Name`, `Full Name` and `Date` all survive, in order — nothing merged,
   renamed or reordered.
2. Caps only: 70 fields → 60; an unknown type → `short_text`; role
   `customer` → `none`; screens 7/9/9 → 1/2/2.
3. The fixture is a fixed point of the sanitizer; `found:false` is the empty
   spec whatever else is sent.

### C. Writing the form (`lib/booking/formSpec.ts writeFormSpec`)
1. `MOONLIGHT_SPEC` on a fresh tenant writes five rows in the form's own
   order with the form's own words; keys from the labels; types and required
   marks as the form had them; roles name/phone/email/notes/policy; every
   field on screen 4; the phone's placeholder and the waiver's policy text in
   the config; every row `generated`.
2. The flow is stored in the form's own step order with titles and the
   questions screen (`service, provider, time, questions:4 "How do we say
   hello?", review`); "Any available staff" makes `staffSelection` optional;
   the people the provider screen listed are seeded as providers.
3. While the form is still onboarding's a second read rewrites it; one hand
   edit (`saveAppointmentField` without `generated`) claims the whole form
   (nothing `generated` any more), after which the write is a no-op
   (`{fields:0, steps:0, staff:0}`) and the log says why.
4. `found:false` writes nothing.

### D. The card walks that form (`getBookingFlow`, `planSteps`, `describeBookingSteps`)
1. `getBookingFlow().fields` carries every field, contact ones included,
   role-tagged and screen-grouped; with one service on file the card walks
   `service → provider → time → screen:4 → review`; the questions screen
   carries the form's heading and all five fields, Full Name required, Email
   optional.
2. The owner's step list describes the same walk.

### E. A booking through that form (`createBooking`)
1. Answers alone book (no separate customer object); the stored customer is
   read out of the role-tagged answers — `{firstName:"Ada",
   lastName:"Lovelace", phone:"512-555-0100"}`, email absent — and the
   answers carry the policy as `Agreed`.
2. Skipping the required policy, or the required phone, is rejected by the
   form's own label.
3. A card that still posts a `customer` object has it folded onto the
   role-tagged fields.

### F. Onboarding end to end (`extractServicesAndBooking`)
0. The services prompt reports only services, menu, `takesAppointments` and
   `channels`; the homepage's booking link is the form's url.
1. Home page with a booking link + the linked page's static HTML form,
   scripted `llm` (services) and `formLlm` (the spec), `readForm` returning
   null → `formHow: "static"`, `formFound: true`, one call per seam, the
   transcriber handed the static snapshot, five rows and one screen reported,
   the returned form is the fixture verbatim, the rows written in order and
   `generated`, the flow following the form.
2. A home page with no booking link or widget → `formFound: false`,
   `formHow: "none"`, zero rows, no transcriber call, and a log line saying
   so.

### G. The block the chat draws (`lib/cards.ts bookingBlock`)
1. Booking on with no fields and no services → null; fields alone make a
   block with role and screen on each field and the flow beside them.
2. The onboarded tenant's block asks its copied form.

### Z. No proof users left behind.

## Assertions — `reader-proof.ts`
A. the fake widget driven in Chromium: four screens, headings, priced tiles,
the staff list, a day and a slot clicked, the questions screen's labels in
order with required marks, types and placeholder, the policy in the text,
"Book appointment" seen but never clicked, distinct fingerprints. B. the
static fallback over the same HTML and an embedded booking-host iframe.
C. the serializer (screen blocks, required marks, options, placeholder, the
cut marker). D. the sanitizer's caps and its refusal to merge or rename.
E. `transcribeForm` with a scripted model: the spec equals the fixture, one
call with the prompt and the serialized snapshot, an empty snapshot makes no
call, a reply without JSON is the empty spec.
F2. the GoCheckIn shape (`reader-accordion.html`), start to questions:
collapsed rows clipped to nothing and parked (opacity 0) dialogs are not on
screen — the collapsed screen lists the category buttons and no OK / Close /
Reload; expanding the first category is the last resort; the rows are one
tile list named by the category right above them; a row is picked through
its inner control; the staff sheet that opens a beat later is a new screen
whose rows are named without their "Book" button, and none of those buttons
is listed as a button of its own; the pick is made by that button, from the
sheet in front, and the menu behind is left alone; the footer's Next goes
forward, never Back or Add more service; the questions screen's labels in
order with their marks, the widget's own agreement toggle read as a
checkbox; nothing that commits, no parked dialog's button, no Back and no
agreement toggle is ever clicked. (A. also holds screen 3 to its
`[calendar]` element under the screen's heading.)
K. `hasVisibleContent` — the signal `readBookingForm`'s first-screen grace
period waits on for a client-rendered booking app that finishes loading
before it finishes painting: a blank page reads as empty, the same page
after it paints reads as real, a bare heading or a tile list with no inputs
still counts, plain "Loading…" text does not.

## Secondary: live cross-check (not a gate)
```
npx tsx docs/features/custom-booking-form/crosscheck.ts [--keep]
```
Real crawl of moonlightnailsspabrighton.com and its GoCheckIn widget, the real
browser read, the real model, a throwaway tenant. Scores the copied form
against `truth.moonlight.ts`: the five questions in order with their marks,
types and roles, one screen, the policy text, nothing extra, the provider
rule, real provider names, the card's walk, sampled prices. Network and model
output vary; a miss is a prompt to read the output, not a gate. Run from a
machine with outbound HTTPS and `ANTHROPIC_API_KEY` set (2026-09-25: every
check matched — see the run record).

## Run record
- 2026-09-25 — `proof.ts`: `All 54 checks passed.` (A 6, B 7, C 15, D 4, E 7,
  F 10, G 3, Z 1). `reader-proof.ts`: `All checks passed.` (Chromium at
  `PLAYWRIGHT_BROWSERS_PATH`). `crosscheck.ts` not run (no route to the live
  site from this container).
- 2026-09-25 (the GoCheckIn read) — `reader-proof.ts`: `All checks passed.`,
  105 PASS lines (F2 rewritten for the real widget's shape: 16 checks; A gains
  the calendar element). Before the reader changes, the same F2 fixture
  stalled at `expand:Manicure` with the rows never read. `crosscheck.ts`
  (live, laptop, real model): `Every check matched.` — 6 screens read in the
  browser, the form copied with the widget's five questions (Full Name*,
  Phone Number*, Email, Appointment Notes, the cancellation-policy agreement
  as a waiver), steps service → provider → time → questions → review, the
  five real providers with "Any available staff" making the provider
  optional, 52 of 63 services seeded with 8/8 sampled prices matching. Also
  green: `npm run lint`, `npm test` (127), `npx knip` (nothing new).

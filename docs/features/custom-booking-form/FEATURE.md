# Feature — The booking form becomes the business's own

## Summary

Requested 2026-09-26. Onboarding used to fit every business's booking form
into a fixed set of kinds and norms (`docs/features/booking-form-planner`):
read what the site's own page happened to ask, then fill the rest from what
"that kind of business" (salon, restaurant, trade, class, consultancy)
normally asks. A norm is a guess, and a guess is sometimes wrong in a way the
business notices immediately — a wording that isn't theirs, a question they
never ask, an order that isn't how their own page walks a customer through
it.

The contract now is narrower and stronger: **a faithful copy**. Onboarding
reads the business's own booking page exactly as a customer would meet it —
the same steps, the same fields, the same words, the same required marks, the
same options, in the same order — and writes that, verbatim, into the
tenant's form. Nothing is planned, nothing is normed, nothing is invented.
The one fixed element is `review` (the app's own submit screen — it must
exist for a booking to be confirmed); everything else is exactly what the
site showed. The one engine rule this depends on: the business's own flow can
ask for a time before it asks which service, or in any order its own page
used, because the server re-checks every id and the slot's availability
against the database on submit — the order a visitor was asked in is never
trusted, so it never has to match a canonical order.

## Desired Behavior

### Reading the page
`lib/onboarding/formReader.ts` drives the booking page in the job's own
Playwright browser (`Crawler.drive`, a fresh `BrowserContext` so a widget's
session cookies never leak into the site crawl): it snapshots the visible
screen (every input, radio/checkbox group, select, tile list and button, with
its label resolved the way a customer reads it — `label[for]`, `aria-label`,
a wrapping `<label>`, adjacent text, or the nearest text above), then
advances the way a customer would — the first tile, the first option of each
required choice, the next enabled day and time slot, then the first
"Next"-like button — and snapshots again, stopping the moment nothing changes
or `MAX_SCREENS` (6) or the deadlines (`SCREEN_TIMEOUT_MS` 12s,
`TOTAL_TIMEOUT_MS` 60s) are hit. It **never** clicks a button that reads like
"Book", "Submit", "Pay", "Reserve" or "Confirm" — `PLAN_NEXT_BODY`'s `NEVER`
pattern rules those out even when they are the only enabled button, so the
reader can never place a real booking. When the browser can't drive the page
at all (a widget that refuses headless Chromium, or `Crawler.drive` returning
null), `snapshotStatic` reads the one screen cheerio already loaded — the
same label resolution over the parsed HTML, plus a booking-or-form-widget
`<iframe>` named as one more thing found there.

### Transcribing
One model call, over the reader's serialized snapshot (`serializeSnapshot`,
capped at 12k chars a screen / 40k total), with a system prompt whose whole
job is transcription, not judgment (`lib/onboarding/formTranscribe.ts`
`FORM_SYSTEM_PROMPT`): **never add, rename, merge, reorder or drop anything**,
one `steps` entry per screen (service / provider / location / time /
questions / review, from what that screen's content actually is), every
field on a `questions` screen in on-screen order with its label copied
exactly (asterisk removed), its required mark exactly as the form states it,
its options copied in order, and a `role` (name / first_name / last_name /
email / phone / notes / policy / none) read from what the field plainly asks
for. `sanitizeFormSpec` then caps for safety only — 60 fields, 60 options,
unknown types default to `short_text`, unknown roles to `none`, screens
renumbered 1..n in first-seen order — never a rewording.

### Writing
`lib/booking/formSpec.ts` `writeFormSpec` is gated on one thing:
`isUntouchedForm` (`lib/appointments.ts`) — every field on file still has
`config.generated`. A form the tenant (or a prior onboarding-booking-form-step
chat edit) has touched is theirs, and is never rewritten. Over an untouched
form, it replaces every `AppointmentField` row in one transaction — key
(`specKeys`, from the label, deduplicated), label, type, required, role,
screen, and the field's own config (options, placeholder, help, min/max, the
waiver text) — and saves the step order as `BookingSettings.flow`. The one
coercion in the whole path: a `select`/`multi_select` question the form
listed no options for becomes `short_text`, because a menu with nothing on it
cannot be answered. The provider screen also sets `staffSelection`
(`optional` when the form offers "anyone available", `required` when it has
a provider step at all, `hidden` otherwise) — but only while the tenant has
no staff of its own, so an owner's hand-built roster is never touched.

### No form found
When the site has no booking link or widget (`bookingFormUrl` returns null),
or the read finds nothing a customer could answer (`snapshotIsEmpty`), or the
site is a "call us" page with no `steps`/`fields` at all (`found: false`),
`writeFormSpec` writes nothing. The onboarding booking-form step then opens
empty and asks the owner directly what they need to know from a customer
(`app/admin/onboarding/BookingFormStep.tsx`).

### Roles and screens
Every field carries a `role` (`lib/appointmentTypes.ts` `FIELD_ROLES`) and a
`screen`. There is no more fixed "customer details" step — name, email and
phone are ordinary fields, told apart from anything else on the form only by
their role — and the calendar, the `.ics` file and the knowledge index read
the customer out of a booking's answers through `customerFromAnswers`, which
finds the first field of each role whatever the form calls it (a `name` role
splits on the first space into first/last when the form asked for one field).
Fields that share a `screen` are asked together, in the order the form asked
them; the step order itself is `BookingSettings.flow`, resolved against the
tenant's actual fields by `sanitizeFlow` — `review` is the only step that is
always present and always last.

### The migration
`prisma/migrations/20260926120000_custom_booking_form` adds `role` and
`screen` to `AppointmentField` and turns every existing tenant's locked
"Your details" step into ordinary rows on screen 1 (first name, last name,
email, phone, the SMS-consent checkbox, in that order, each `role`-tagged and
`generated`), so an existing tenant's card asks exactly what it asked before
the migration, in the same order — nothing moves until the owner or a
re-onboard changes it.

## Scope
- `lib/onboarding/formReader.ts` (new) — drives the page, `snapshotStatic`
  fallback, `serializeSnapshot`.
- `lib/onboarding/formTranscribe.ts` (new) — `FORM_SYSTEM_PROMPT`,
  `sanitizeFormSpec`, `transcribeForm`.
- `lib/booking/formSpec.ts` (new) — `writeFormSpec`, `specKeys`.
- `lib/onboarding/services.ts` — `SERVICES_SYSTEM_PROMPT` narrowed to
  services/menu/`takesAppointments`/`channels`; `ServicesReport` gains
  `formFound`/`formScreens`/`formHow`; `runFormRead` wires the reader,
  transcriber and writer into the services-and-booking stage.
- `lib/appointmentTypes.ts` — `FIELD_ROLES`, `role` and `screen` on
  `AppointmentFieldRow`, `customerFromAnswers`.
- `lib/booking/types.ts` — `FlowStep`/`sanitizeFlow`/`defaultFlow` resolve the
  business's own step order against role-tagged, screen-grouped fields.
- `prisma/migrations/20260926120000_custom_booking_form/`.
- Removed: `lib/bookingFormPlan.ts`, `lib/bookingMenu.ts`, the picker bridge,
  `createAppointment`, the single-card `LegacyWizard`, the locked
  customer-details step, the Customer admin panel.

## Non-Goals
- Live cross-checking the transcriber against a real business's booking page
  from inside this container: `crosscheck.ts` needs outbound HTTPS to a real
  site, which this sandbox doesn't have (see `LOCAL_CHECKS.md`).
- Clicking through anything behind a login wall, a CAPTCHA, or a payment
  step — the reader drives only what an anonymous visitor can reach, and
  stops rather than guessing past a wall it can't get through.
- Ever writing a real booking into the business's own booking system: the
  reader clicks tiles, days, slots and "Next" — never "Book", "Submit",
  "Pay", "Reserve" or "Confirm" — so nothing it does can place an order on
  the business's own site.

## Scenarios
1. **A MoonLight-shaped widget** (GoCheckIn-style, four screens: a priced
   service menu as tile lists, a staff picker, a bare date/time screen, then
   name/phone/email/notes/a policy checkbox and "Book appointment"): the
   reader walks all four screens without ever pressing "Book appointment";
   the transcriber returns `steps` for service, provider, time and questions
   (screen 4) plus `review` on that same screen, and five fields with
   `Full Name`→role `name`, `Phone Number`→role `phone` (required, its own
   placeholder kept), `Email`→role `email` (optional), `Appointment Notes`→
   role `notes`, and the checkbox→type `waiver`, role `policy`, with the
   cancellation-policy paragraph copied into `text`. Fixture:
   `fixture.moonlight.ts`.
2. **A Jotform (or similar) embed**: the homepage's booking link points
   off-site to a form-product host; `frameReadable`/`FORM_HOSTS` let the
   reader look inside that frame, and the static fallback separately lists
   the `<iframe src>` itself as a "booking or form widget" for
   `discoverServicePages` to load when the browser can't reach it.
3. **A "call us" page**: the booking link (or the homepage itself) has no
   input, choice or tile a customer could answer — `snapshotIsEmpty` is true,
   or the model reports `found: false` — so no model call for transcription
   is skipped-not-made in the empty-snapshot case, and nothing is written;
   the booking-form step opens empty and asks the owner what to ask a
   customer.
4. **A hand-edited form left alone**: a tenant (or a prior chat edit) has
   already saved, deleted, reordered or retitled a screen — `isUntouchedForm`
   is false — so a re-onboard's read still runs (services and knowledge are
   refreshed) but `writeFormSpec` returns immediately with nothing written;
   the owner's form is exactly as they left it.

## Constraints
- **Safety**: only `https://` hosts pass `isSafeExternalUrl` (no IP literals,
  no `.local`/`.internal`/`.lan`/`.corp`/`.intranet`, no credentials in the
  URL); the reader gets its own fresh `BrowserContext` per page
  (`Crawler.drive`) so a widget's cookies and storage never touch the site
  crawl's; every drive is capped (`SCREEN_TIMEOUT_MS`, `TOTAL_TIMEOUT_MS`,
  `MAX_SCREENS`) so a widget that never stabilizes can't hang a job.
- **Caps, never edits**: `sanitizeFormSpec`'s limits (60 fields, 60 options,
  200-char labels, 12 steps, a 4000-char waiver text) exist purely to bound
  what a bad or hostile page could make the model return — they never
  reword, reorder or drop anything the form actually shows within those
  limits.
- **One model call**: the whole form — every screen the reader captured — is
  transcribed in a single `llmExtract` call over the serialized snapshot; an
  empty snapshot makes no call at all.

# Feature — Booking setup in the onboarding chat, one clean flow

## Summary

Booking is set up the way everything else is: in the onboarding
conversation, one step at a time. Once the site has been read, the assistant
shows the services it found (name, price, length, on/off — every known-answer
field a dropdown) and then the providers (name, role, on/off, and whether a
visitor picks who they see). The visitor's booking card asks each thing once:
the service, the person, the time and the contact details are steps of the
flow, and the intake questions are only what the flow has no step for. The
Booking tab's editors use dropdowns and row editors instead of free text and
"Name | price | minutes" textareas. Restarting onboarding wipes the booking
setup, the menu and the appointments along with everything else. The legacy
intake-only wizard, its POST shape, the read-time "legacy bridge" and the
picker prefill are gone.

## Why

A live click-through (2026-09-24) showed the booking card asking for the
visitor's name, email and phone after the details step, and "Which services
would you like?" after the service was already picked: `show_booking` handed
the card the whole question catalog rather than the flow's trimmed intake.
"Who would you like to see?" was planned as an intake dropdown from the
booking page's names, while the provider step drew only from team-page bios —
so a visitor was asked twice, or the names the site lets customers ask for
were never providers at all. Image matching accepted one shared word, so a
page's hero photo ("Our Massage Services") landed on every massage service,
and the card drew a lettered placeholder block for every service without a
picture. Restart onboarding left every booking table in place, so a re-run
stacked on stale services. And the Booking tab asked salon owners to type
pipe-separated lines.

## Desired behavior

- **The card asks each thing once.** `bookingBlock` (lib/cards.ts) hands the
  card `getBookingFlow(...).intake` — the catalog minus name/email/phone, the
  service picker when there is a service step, and a `staff` question when
  there is a provider step. `createBooking` demands answers to exactly that
  same set. The planner (lib/bookingFormPlan.ts) never writes a service or
  staff question; a site requirement that repeats one of those steps is
  dropped only when the read found the services or people the step draws.
- **Providers come from both reads.** The names the booking page says a
  customer can ask for become `StaffMember` rows after the extraction pool
  (lib/onboarding/jobs.ts), merged by name with the team pages' fuller rows.
  `seedServices` / `seedStaff` merge by name: a row on file is never
  duplicated or overwritten; new names are added.
- **A picture is of one thing.** `bestImageFor` needs every word of a one- or
  two-word name and most of a longer one, ignores the page's h1, and never
  hands a photo out twice. The service step is a list with a thumbnail only
  where a photo exists; no placeholder blocks.
- **Restart wipes everything.** `wipeAccountContent` (lib/accountReset.ts)
  clears services, providers, locations, rules, intake questions,
  appointments, menu items and orders with the rest, puts booking back on,
  clears `onboardedAt`, and re-provisions the defaults.
- **Booking tab: dropdowns and rows.** `RowsEditor` / `SelectField`
  (app/admin/booking/RowsEditor.tsx) — category (with "New category…"),
  length, gaps, deposit, who/where, shown; variants, add-ons, holidays, time
  off, promo codes, memberships and a question's choices as rows with
  dropdown cells. Every editor still posts the line format the server actions
  already parse, so the actions are unchanged.
- **Booking in the chat.** Two steps after extraction (`review-services`,
  `review-providers` in OnboardingFlow), backed by
  `GET/POST /api/admin/onboarding/booking` (lib/onboarding/bookingReview.ts),
  writing partial patches through the same store. Manual setup and "Skip
  this" reach the same steps with empty lists.

## Scope
`lib/cards.ts`, `lib/brain.ts`, `lib/bookingFormPlan.ts`, `lib/appointments.ts`,
`lib/bookingMenu.ts`, `lib/booking/store.ts`, `lib/booking/matchImages.ts`,
`lib/onboarding/bookingSeed.ts`, `lib/onboarding/jobs.ts`,
`lib/onboarding/bookingReview.ts` (new), `lib/accountReset.ts` (new),
`app/api/booking/route.ts`, `app/api/admin/onboarding/booking/route.ts` (new),
`app/cards/booking/*`, `app/admin/booking/*` (`RowsEditor.tsx`, `StaffForm.tsx`
new), `app/admin/BookingFieldForm.tsx`, `app/admin/onboarding/*`
(`BookingSetupCard.tsx` new), `app/admin/actions.ts`, `agent.md`.

## Non-Goals
- Reading a third-party booking wizard's staff list when it only renders after
  a click (the norm keeps a "preferred technician" text question for those).
- Editing photos, add-ons, hours or policies in the chat — the review shows
  what a first look needs; the Booking tab has the rest.

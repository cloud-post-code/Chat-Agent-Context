# Feature — Onboarding extracts services and booking requirements

## Summary

The onboarding crawl learns two more things from the business's website: the
services it offers, and how it takes bookings. Services become retrievable
knowledge like every other extracted page. Booking requirements — whether the
business takes appointments and what it asks a customer for — become
pre-seeded appointment questions, so that when the tenant later flips the
Appointments toggle (docs/features/appointment-booking) the wizard already
asks the right things. Booking itself stays off; extraction configures, the
tenant enables.

## Desired Behavior

- The knowledge stage of onboarding gains a "services" extractor alongside
  blog / testimonials / team / sweep, selectable the same way and reported in
  the same job log and report.
- It reads the pages likely to describe services and booking (services,
  pricing, treatments, menu, booking/appointment pages, plus the homepage) and
  extracts, from the text only:
  - the services offered — name and what the site says about each;
  - whether the business takes appointments/bookings, and the concrete
    pieces of information it asks a customer for when booking.
- Extracted services are saved as knowledge for that tenant: retrievable
  chunks with a source row, visible on the Knowledge tab like other onboarding
  extractions.
- Extracted booking requirements seed the tenant's appointment-question
  catalog: the default name and email questions first, then each extracted
  requirement as a typed question — but only when the tenant has no
  appointment questions yet. An existing catalog is never touched.
- `Profile.bookingEnabled` is never changed by extraction. After onboarding a
  booking-taking site, enabling appointments is one click and the wizard asks
  the seeded questions.
- A site with no services or booking information seeds nothing, saves
  nothing, and the stage completes normally with an honest log line.
- Running the extractor again (a re-onboard) refreshes the services knowledge
  in place (same source, replaced chunks) and does not duplicate or clobber
  appointment questions.

## Scope
- A services-and-booking extractor in `lib/onboarding/` following the
  existing shape: page discovery, one system prompt, `llmExtract`, a
  sanitizer, persistence.
- Wiring into the knowledge stage of `lib/onboarding/jobs.ts` (extractor
  list, phase, log lines, report entry) and the onboarding UI's extractor
  selection where it lists categories.
- Field seeding through `lib/appointments.ts` write paths.

## Non-Goals
- Enabling booking automatically, or any change to `bookingEnabled`.
- Editing or merging into an existing appointment-question catalog.
- Extracting prices into structured data, service durations, staff-to-service
  mapping, or a bookable service picker in the wizard.
- Re-crawling outside the onboarding job's existing crawler and page budget.

## Scenarios
- Happy path: onboarding a salon site whose pages describe services and say
  "book online — we'll need your name, phone number, and the treatment you
  want" yields service knowledge chunks, and the question catalog seeds as
  name, email, phone number, treatment; booking is still off; enabling it
  makes the wizard ask exactly those.
- No booking info: a portfolio site yields service knowledge only (or
  nothing), zero appointment questions, and a log line saying so.
- Existing catalog: a tenant who already customized questions re-onboards;
  their questions are untouched, services knowledge still refreshes.
- Extraction failure: the model call fails after retries; the stage reports
  the error like the sibling extractors and nothing half-seeds — field
  seeding happens only after a successful, sanitized extraction.

## Constraints
- Website text is third-party data: it flows only through the existing
  prompt-and-parse extractor idiom with a sanitizer that enforces types,
  lengths, and caps before anything is persisted. Requirement types are
  restricted to the appointment field types (short_text, long_text, email,
  phone); anything else degrades to short_text.
- Never invent: absent stays absent, matching the sibling prompts' shared
  rule.
- The model call must be reachable through an injectable seam (the
  lib/customIngest precedent) so the extractor is provable offline.
- Best-effort at the stage level, atomic at the seeding level: seed fields
  only from a successful extraction, and only ever into an empty catalog.
- No new dependencies; smallest change that fits the existing pipeline.

## Implementation Routing
- Required skills: coding-proof-author

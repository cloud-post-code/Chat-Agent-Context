# Feature — Restart onboarding wipes the whole account

## What

"Restart onboarding" (bottom of the Profile tab, `restartOnboarding` in
`app/admin/actions.ts`) is documented as a full content reset, but it was
written before the booking domain and the menu existed and never removed the
files it had uploaded. A seller who re-ran onboarding came back to an empty
profile and knowledge base with their old services, staff, locations,
appointment form, appointments, booking settings, menu items and orders still
attached, and every photo, logo and generated image still on the Railway
volume.

The wipe now lives in `lib/accountWipe.ts` (`wipeAccountContent`) and clears,
for the logged-in user only:

- everything it already cleared: sources, chunks, entities and their graph,
  merge dismissals, photos, projects, chat sessions and messages, canned
  answers, directives, UI cards, item classifications, ingestion sources,
  A2A tasks, persona, theme; profile blanked;
- the booking domain: `Service`, `StaffMember`, `BookingLocation`,
  `BookingSettings`, `AppointmentField`, `Appointment`;
- `MenuItem` and `Order`;
- `Profile.bookingEnabled` back to its default (on);
- the uploaded files those rows referenced, removed from `UPLOAD_DIR`.

It still keeps the `User` row (email, name, slug, password), and still sets
`onboardedAt` to null so the next admin visit enters the flow.

## Upload cleanup

Only the rows know which files are the account's. Filenames are collected
before the transaction: the three bare-filename columns (`Photo.filename`,
`Service.imageFilename`, `StaffMember.photoFilename`) plus a scan of every
other per-user row's serialized form for `/api/uploads/<name>` — that covers
the logo on `PersonaConfig`, project images, card sample blocks, menu item
data, canned-answer card input, chat messages carrying generated images and
booking configs, and any future column that stores an upload the same way.
Files are unlinked only after the transaction commits; a missing file is a
no-op. Filenames are per-upload UUIDs, so nothing is shared across accounts.

## Out of scope

- Files nothing references (an image generated for a card that was never
  saved) — no row records them, so the wipe cannot find them.
- Deleting the account itself (`lib/accountAdmin.ts`).

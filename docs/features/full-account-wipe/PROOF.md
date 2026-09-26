# Proof Plan

## Definition Of Done
- `wipeAccountContent(userId)` leaves zero rows in every per-user table except
  `User` and `Profile` (blanked, `bookingEnabled` true).
- That includes the booking domain (`Service`, `StaffMember`,
  `BookingLocation`, `BookingSettings`, `AppointmentField`, `Appointment`),
  `MenuItem` and `Order`.
- Every upload the account's rows referenced — bare filename columns and
  `/api/uploads/…` URLs inside logo, project, card, menu, chat and config
  blobs — is removed from `UPLOAD_DIR`; a file belonging to another account
  is untouched.
- The `User` row survives with `onboardedAt` null; a second account's rows are
  untouched.

## Primary Proof
Type: integration (Postgres + a temp upload dir; no model or network calls)

Command:
```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/full-account-wipe/proof.ts
```

The script creates two throwaway users, seeds one row in every per-user
table for both (with upload files on disk referenced every way the app
stores them), wipes the first, and asserts the counts, the surviving user
row, the blanked profile, the removed files and the second user's intact
data. It cleans up both users and the temp dir. Prints `PROOF PASS` or
exits 1.

Expected evidence:
- Red before the change: booking, menu and order counts non-zero after the
  wipe and every seeded file still on disk.
- Green after: all counts zero, all of user A's files gone, user B's file and
  rows intact.

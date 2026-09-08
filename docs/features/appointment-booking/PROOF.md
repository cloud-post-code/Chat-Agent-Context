# Proof Plan — Appointment booking

## Definition Of Done
- `lib/appointments.ts` exists as a data-only store over Prisma: booking config
  (enable flag + per-tenant field catalog, seeded with defaults on first
  enable), `createAppointment` with server-side validation, `cancelAppointment`,
  `listAppointments` — every function scoped by userId.
- With booking enabled, the visitor brain offers a `show_booking` tool and a
  scripted call to it yields a `booking` card event carrying the tenant's
  configured fields in order. With booking disabled, the tool is not offered
  and a stale scripted call hydrates to nothing (no card event).
- `createAppointment` rejects: booking disabled, a missing required answer, a
  past start time, and an exact-duplicate start time (race guard) — each with a
  reason, never by throwing. A valid submit persists a real `Appointment` row.
- Cancelling removes the appointment from `listAppointments` and frees the
  exact slot for rebooking.
- A booked appointment is indexed under a new `appointment` origin kind
  (`ORIGIN_KINDS` gains it): real `Chunk` rows exist for the appointment,
  their text carries the date and frames visitor answers as quoted visitor
  data, and cancelling drops them.
- `adminPanelKeys` includes a `calendar` key when booking is enabled and not
  when disabled; the Calendar panel and Appointments settings exist in
  `app/admin/panels.tsx` from one implementation used by both admin surfaces.
- A `POST /api/booking` route submits the wizard's answers behind the same
  validation; `GET` on the flow config route serves the live field list.

## Primary Proof
Type: integration (repo-native proof script over the real DB, model doubled
only at the Anthropic client boundary per `lib/brain.ts`'s `ModelClient` seam)

Command:
```bash
npx tsx docs/features/appointment-booking/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: throwaway user, appointment field
  rows, `Appointment` rows, and `appointment`-origin `Chunk` rows.
- Red run recorded before implementation: the script fails to import
  `lib/appointments.ts`.

Secondary guards:
- `npx tsc --noEmit` clean.
- `prisma migrate` migration checked in (no `db push`).

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: the visitor model client is a scripted double implementing
  `ModelClient`; embedding falls back to the local hashed model when no
  provider key is set, which is sufficient for chunk-existence assertions.
- All rows are created under a throwaway user
  (`proof-appointment-booking@example.invalid`) and deleted in a `finally`.

## Anti-Gaming Constraints
- Only the outermost Anthropic client boundary may be doubled; tool gating,
  hydration, validation, persistence, and indexing must be the real code.
- No assertion may rely on model-authored text; assertions read brain events
  and DB rows.
- The disabled-state checks may not be satisfied by the proof toggling
  anything client-side: the tool list offered to the model is captured at the
  `ModelClient` boundary from the params the brain actually sends.
- Do not weaken `FEATURE.md` (e.g. dropping the race guard or the knowledge
  drop-on-cancel) to make the proof pass.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Browser click-through of the wizard itself (one question per step, back/skip
  behavior, error state preserving answers, confirmation render) — client
  component state, verified via browser preview; the submit path it ends in is
  proven above.
- Visual check of the Calendar panel's month layout in dashboard and admin
  chat.

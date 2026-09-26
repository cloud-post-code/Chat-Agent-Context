# Proof — Admin nav groups + Home tab

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/admin-nav-groups/proof.ts
```

Offline: pure nav config + resolver + Home item computation, server-rendered
`HomePanel`, `AppointmentsPanel`, `OrdersPanel` markup, and source-level
wiring reads. No DB, no model calls.

## Assertions (all must pass)

1. **Nav config**: `NAV_GROUPS` keys are exactly
   `home, inbox, knowledge, agent, cards, settings`; every sub key is unique;
   `fixedPanelEntries(false)` excludes `home` and `users`;
   `fixedPanelEntries(true)` includes `users`; `labelsFromNav()` maps
   `graph` → "Health", `a2ui` → "Cards", `booking` → "Booking".
2. **Deep links**: `resolveAdminTab` yields `activity`→inbox,
   `calendar`→inbox/appointments, `orders`→inbox, `booking`→settings,
   `graph`→knowledge, `a2ui`→cards, `answers`→agent,
   `goals`→agent, `profile`→settings, `theme`→settings, `me`→settings/profile,
   `users`→settings, `new-source`→knowledge, a live source key→knowledge,
   `content`→knowledge on the first live key (sub undefined with none),
   unknown keys pass through, `undefined` → nothing.
3. **Home items**: `attentionItems` reports flagged count, unreviewed
   drafts, only upcoming appointments, only `status === "new"` orders, and the
   top questions; `checklistItems` marks profile incomplete, suggested
   tagline, no cards, booking off, and empty sources as not done and links
   each to its tab. A fully set-up fixture yields all done.
4. **HomePanel markup** contains `href="/admin/dashboard?tab=answers"`,
   `?tab=appointments`, `?tab=booking`, and the flagged count.
5. **Calendar split**: `AppointmentsPanel` with `bookingEnabled: false`
   renders no month grid and a link to `?tab=booking`; with `true` it renders
   the grid. `OrdersPanel` renders "No orders yet" when empty and an order's
   contact name when given. `BookingSettings` renders the toggle.
6. **Wiring**: `dashboard/page.tsx` imports `NAV_GROUPS` and has no literal
   `key: "calendar"`; `CalendarPanel.tsx` no longer imports `BookingSettings`;
   `lib/adminBrain.ts` has no literal `FIXED_PANELS` array and uses
   `TAB_ALIASES`; `panels.tsx` sets `flat.home`, `flat.appointments`,
   `flat.orders`, `flat.booking`; `AdminChat.tsx` starters no longer say
   "ingestion sources".

## Red expectation

Before implementation `contentTabs.ts` exports no `NAV_GROUPS`, `HomePanel`
and `homeItems` do not exist — the imports fail and the proof exits non-zero.

## Secondary checks (not proof)

- Updated sibling proofs: `admin-content-tabs`, `ingestion-driven-dashboard`,
  `new-source-subtab` (offline); `booking-on-by-default`,
  `appointment-booking`, `admin-chat-a2ui` (need Postgres).
- `npx tsc --noEmit`, `npm run lint`, gate PASS.
- Browser: open `/admin/dashboard`, click each Home link and see the section
  switch; ask the copilot to show appointments.

# Admin nav groups: six sections and a Home tab

## What

The owner's control room (`/admin/dashboard`) collapses its seven top-level
tabs (Me, Content, Knowledge, Activity, Agent Behavior, Calendar, Users) into
six purposeful groups and gains a Home tab that tells the owner what needs
attention and what setup is still missing, each item deep-linking to the
panel that resolves it.

## Behavior

- Nav groups, in order, from one config (`NAV_GROUPS` in
  `app/admin/contentTabs.ts`):
  - **Home** — `home`: needs-attention queue + setup checklist. No strip.
  - **Inbox** — Chats `activity`, Appointments `appointments`, Orders `orders`.
  - **Knowledge** — live ingestion-source tabs, then "+ New source"
    `new-source`, then Health `graph` (the graph diagnostics).
  - **Agent** — Presets `answers`, Goals `goals`, Rules `rules`.
  - **Cards** — `a2ui`. No strip.
  - **Settings** — Profile `profile`, Theme `theme`, Booking `booking`,
    Contacts `contacts`, Users `users` (operators only).
- The old Calendar panel splits: `AppointmentsPanel` (month grid + cancel),
  `OrdersPanel`, and `BookingSettings` rendered on its own under Settings.
  Settings › Booking is always present so booking can be turned back on;
  Appointments shows a pointer to it while booking is off.
- Home attention items (each `{ label, count, tab }`): flagged 👎 answers,
  presets awaiting review, upcoming appointments, new orders, most-asked
  questions. Checklist items (`{ label, done, tab }`): profile fields
  missing, tagline still suggested, no cards, booking off, and each enabled
  source with no items. Every row links to `/admin/dashboard?tab=<key>`.
- Deep links keep working: `calendar` → Inbox/appointments, `content` →
  Knowledge on the first source, `booking` → Settings/booking, `me` →
  Settings/profile, and every existing sub key resolves to its new group.
  Unknown keys still pass through as a nav key.
- `Tabs`/`SubTabs` are keyed on the resolved tab so a same-route `?tab=`
  link from Home switches sections.
- The copilot's revealable panels derive from the same config
  (`fixedPanelEntries`), `show_panel` accepts legacy aliases, and the chat
  starter chips reflect the new groups. `home` is never revealable.

## Out of scope

- Reducing what `buildAdminPanels` loads per visit.
- Changing any panel's internals beyond the Calendar split.

## Implementation Routing

Required skills: `coding-frontend`.

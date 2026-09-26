# Copilot element reveal: panels split into addressable elements, revealed by filter

## Summary
The admin copilot at `/admin/chat` can today only reveal a whole panel. Asked "what's on
Friday?" it opens the entire Appointments panel (month grid plus every booking card) and
tells the admin to filter by hand. Each dashboard panel is now split into addressable
**elements** (one appointment, one order, one goal, one rule, one preset, one service, one
provider, one location) that carry filterable **facets**, and the copilot can reveal just
the elements that match a question — "what's on Friday?" shows only Friday's appointment
card, still fully interactive.

## Desired Behavior
- "What's on Friday?" (asked on Thursday Sep 24, 2026 with one booking on Fri Sep 25 and one
  on Sat Sep 26) renders only the Friday appointment card inline — the same card the
  Appointments panel shows, with its working Cancel/Confirm forms — under a bubble label
  naming the panel and what was matched. The month grid and the Saturday card are not
  shown.
- The same works for any element panel and any facet: "show Christopher's appointment",
  "which services cost under $50", "show the disabled providers", "show my rule about phone
  numbers", "which presets have never been served", "orders for pickup".
- The copilot may also pick elements outright (by id from the index it is given) when the
  request is positional or by name — "the second Friday card", "the gel manicure service".
- A question that matches nothing reveals nothing; the copilot says so in one sentence and
  offers the full panel. A question about a panel as a whole ("show my appointments") still
  reveals the full panel via `show_panel`.
- Every element carries: a stable `id` (the row's id), its `panel`, a short human `label`,
  and flat `facets` (strings/numbers). Date-bearing elements carry `date` (YYYY-MM-DD in the
  business's timezone), `weekday` (lowercase English name), and `time` (HH:MM) so day-of-week
  questions resolve without the model doing calendar math.
- The copilot knows today's date and weekday (business timezone) so "Friday", "tomorrow",
  and "this week" resolve to concrete dates.
- Filters are evaluated deterministically in code from the copilot's structured tool input,
  never by the model choosing which markup to emit: ops are `is`, `contains`, `before`,
  `after`, `gte`, `lte`; several filters AND together.
- Revealed elements are the same server-rendered React nodes the full panel uses, keyed by
  id, so a write from a revealed element (Cancel, Save, Delete) works exactly as on the
  dashboard and a `router.refresh()` re-renders it with fresh data.
- Element panels this pass: `appointments`, `orders`, `goals`, `rules`, `answers`,
  `booking-services`, `booking-providers`, `booking-locations`. Panels without elements
  behave as before.

## Scope
- `lib/adminElements.ts` (pure, import-free of server code): the `ElementMeta`, `ElementFilter`
  and `ElementSelection` types; `selectElements(index, selection)`; per-panel facet builders
  (`appointmentElement`, `orderElement`, `directiveElement`, `cannedElement`,
  `serviceElement`, `staffElement`, `locationElement`); `elementIndexLines()` for the prompt;
  `todayFacets(now, timeZone)`.
- `lib/adminElementsLoad.ts` (server): `loadElementIndex(userId)` reading the same stores the
  dashboard reads and building the index with the pure builders.
- `app/admin/panels.tsx`: `buildAdminPanels` also returns `elements` — every element panel's
  rows rendered one node per id through the panel's own row component — using the same
  builders for ids.
- Row components extracted (not rewritten) so one row can render alone: `AppointmentCard`
  in `CalendarPanel.tsx`, `OrderRow` in `OrdersPanel.tsx`, `DirectiveForm` exported,
  `AnswerForm` exported, `ServiceRowPanel`, `StaffRowPanel`, `LocationRowPanel` in
  `app/admin/booking/*`.
- `lib/adminBrain.ts`: a `show_elements {panel, ids?, where?, limit?}` tool; an
  `elements` event `{ panel, ids, title }`; TODAY and an ELEMENTS index section in the
  system prompt; rules telling the model when to prefer `show_elements` over `show_panel`.
- `app/admin/chat/AdminChat.tsx` + `page.tsx`: `elements` prop; an `elements` chat item that
  renders the matching nodes inside a `PanelBubble`.
- `agent.md`: the new tool, event and rules.

## Non-Goals
- No element support this pass for Chats (`activity`), Contacts, Users,
  Knowledge source items, or the Home/Health/Theme/Profile/Hours/Customer/Questions/Pricing
  panels; the registry is designed so each can add a builder and a row component later.
- No model-generated markup or layout; the copilot only selects among pre-rendered nodes.
- No new write paths: every action on a revealed element is the row's existing server action.
- No change to `show_panel`, `save_goal`, `propose_ingestion`, or `propose_theme_color`.
- No new dependencies.

## Scenarios
- Happy path: two bookings (Fri 13:00 Christopher, Sat 09:30 Blake); "what's on Friday?" →
  `show_elements {panel:"appointments", where:[{facet:"weekday", op:"is", value:"friday"}]}`
  → one `elements` event with exactly the Friday id → one card inline.
- By name: "show Christopher's appointment" → `where:[{facet:"customer", op:"contains",
  value:"christopher"}]` → the same card.
- Numeric: services priced 35, 55, 80; "services under $50" →
  `where:[{facet:"price", op:"lte", value:"50"}]` → one service row.
- Positional/by id: the model passes `ids:[…]` copied from the index → exactly those, in
  index order, unknown ids dropped.
- Nothing matches: "what's on Sunday?" → no `elements` event; the tool result says no
  match; the model answers in text and offers the panel.
- Unknown panel or a panel with no elements → no event, loop terminates.
- Operator gating unchanged: the index never includes panels the user cannot reveal.
- Dashboard unaffected: `/admin/dashboard` renders the same panels as before.

## Constraints
- Element ids are the underlying row ids; the index (brain side) and the rendered nodes
  (panel side) must be built from the same rows via the same pure builders so they agree.
- Facet values are lowercase strings or numbers; `contains`/`is` compare case-insensitively.
- Dates use the business timezone from `BookingSettings.timezone`, falling back to the
  server zone; the prompt states the zone used.
- The prompt's element index is capped per panel (40 rows) with a note to use `where`
  beyond the cap; labels are truncated to keep the prompt bounded.
- Follows `lib/brain.ts` conventions: injectable model client, bounded loop, NDJSON events.
- Reuse existing panel row markup; no forked panel components.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

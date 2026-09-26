# Proof Plan — Copilot element reveal

> **2026-09-26 — booking removed.** Booking, Service, the menu and the cart no longer exist in the product (commit `b4d06cf` on main is the last state with them). The checks below that seeded or asserted bookings, services, menu items or orders were removed from `proof.ts`; the rest stand as written.

## Definition Of Done
- `lib/adminElements.ts` exports `selectElements`, the per-panel element builders, and
  `elementIndexLines`; `selectElements` is pure and honours `is`, `contains`, `before`,
  `after`, `gte`, `lte`, ANDs several filters, returns index order, drops unknown ids, and
  respects `limit`.
- With two real bookings (Fri Sep 25 2026 13:00 and Sat Sep 26 2026 09:30, business zone
  America/New_York), a scripted model turn calling
  `show_elements {panel:"appointments", where:[{facet:"weekday", op:"is", value:"friday"}]}`
  yields exactly one `elements` event whose `ids` is exactly the Friday booking's id, and
  no `panel` event.
- `where:[{facet:"customer", op:"contains", value:"christopher"}]` selects the same id;
  `{facet:"weekday", op:"is", value:"sunday"}` yields no event and the loop terminates; an
  unknown panel or an element-less panel (`theme`) yields no event.
- Services priced 35 / 55 / 80: `{facet:"price", op:"lte", value:"50"}` selects only the
  cheapest; providers one enabled one disabled: `{facet:"enabled", op:"is", value:"no"}`
  selects only the disabled one; a rule containing "phone" is found with
  `{facet:"text", op:"contains", value:"phone"}`; a never-served preset with
  `{facet:"served", op:"is", value:"0"}`.
- `ids:[…]` copied from the index selects exactly those, in index order.
- The system prompt the code built contains a TODAY line with the date and weekday in the
  business timezone, and an ELEMENTS section listing every element id with its label and
  facets for the element panels.
- `buildElementNodes(...)` (app/admin/elements.tsx) returns, for every element in the index
  it builds, a React node under `nodes[panel][id]`; the Friday appointment node renders the
  customer's name and a Cancel control and does not render the Saturday customer; the
  index it builds equals the one `loadElementIndex` builds for the same user (same ids,
  same facets).
- `show_panel` still reveals full panels; `/admin/chat` passes `elements` to `AdminChat`,
  which renders an `elements` chat item; `agent.md` documents `show_elements`.

## Primary Proof
Type: integration (repo-native proof script over the real DB; the model doubled only at
the Anthropic client boundary; element nodes rendered with react-dom/server)

Command:
```bash
npx tsx docs/features/copilot-element-reveal/proof.ts
```

Expected evidence:
- All `PASS` lines, `failures: 0`, exit code 0.
- Persisted rows observed then cleaned up: throwaway user, its `BookingSettings`, two
  `Appointment` rows, three `Service` rows, two `StaffMember` rows, one location, one
  goal, one rule, two `CannedAnswer` rows.

Secondary guards:
- `npx tsx docs/features/copilot-focused-edits/proof.ts` and
  `npx tsx --tsconfig tsconfig.proofs.json docs/features/admin-nav-groups/proof.ts`
  still green.
- Live cross-check with the real model (not a proof): `npx tsx docs/features/copilot-element-reveal/live.ts`.
- `npx tsc --noEmit` and `npm run lint` clean.
- Red run recorded before implementation: `lib/adminElements.ts` does not exist and no
  `elements` event is emitted.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: the model client is a scripted double implementing `ModelClient` that records
  the `system` string it is called with.
- All rows live under a throwaway user (`proof-copilot-element-reveal@example.invalid`),
  deleted in a `finally` block (cascade).
- Appointments are inserted directly through Prisma with fixed UTC instants so the
  weekday facet is deterministic regardless of the machine's zone.

## Anti-Gaming Constraints
- Only the Anthropic client boundary may be doubled; the tool loop, index loading, filter
  evaluation and node building are the real code.
- No assertion relies on model-authored text; assertions read events, the system prompt the
  code built, the index, rendered markup and DB rows.
- The Friday assertion is on the exact id list (equality), not "contains".
- Row markup must come from the panels' own row components: the proof renders the element
  node and the full panel and checks the element's card markup appears inside the full
  panel's markup.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The real model's choice of `show_elements` for "what's on Friday?" and the inline render
  in `/admin/chat` (login required) are checked in the browser preview, not by the script.

# Proof Plan — Build A2UI cards from the imported site, on demand

> **2026-09-26 — booking removed.** Booking, Service, the menu and the cart no longer exist in the product (commit `b4d06cf` on main is the last state with them). The checks below that seeded or asserted bookings, services, menu items or orders were removed from `proof.ts`; the rest stand as written.

## Definition Of Done
- `lib/siteCards.ts` exports `SITE_CARDS_SYSTEM_PROMPT`,
  `sanitizeSiteCardPlan` and `buildCardsFromSite(userId, onEvent, deps?)`
  with the two injectable model seams `deps.llm` (planner) and `deps.draft`
  (card builder), defaulting to the real `llmExtract` and `draftUiCard`.
- The planner's text is the tenant's imported link sources (URLs + text), an
  EXISTING CARDS block, BUSINESS, SIGNALS and STARTER QUESTIONS.
- A tenant with no imported link source costs no model call (`noSite`).
- Into a non-empty catalog, the run adds rows after the last existing order,
  in plan order, through the real `writeUiCard` path; existing rows are
  byte-identical afterwards.
- Cards whose tool (live kinds) or label already exists, `booking` cards, and
  cards with no `need` never reach the catalog.
- The builder brief for a designed card carries the plan's brief, the need
  and the evidence URL.
- Events: one `need` per planned need, one `card` per written row.
- Failures are per-card and never throw; a failed plan writes nothing.
- The route refuses an unauthenticated request with 401.
- The A2UI panel has the button and calls the route.

## Primary Proof
Type: integration (repo-native script over the real dev Postgres; the model
doubled only at the two seams).

Command:
```bash
npx tsx docs/features/site-driven-a2ui-cards/proof.ts
```

Expected evidence: all `PASS`, exit 0; throwaway users
(`proof-site-cards-*@example.invalid`) deleted in a `finally`. Red run
recorded before implementation: the script fails to import `lib/siteCards`.

Secondary guards (not proof): `npx tsc --noEmit`, `npx next lint`, the gate,
and the sibling proof `onboarding-a2ui-cards` still green.

## Assertions
1. **Sanitizer** — junk shapes → empty plan; booking dropped; a `contact`
   card dropped when `show_contact_form` exists; an existing label dropped
   case-insensitively; a card with no need dropped; unknown evidence blanked,
   known evidence kept; 6 valid cards in → 4 out.
2. **No site** — no link sources: `noSite`, zero planner calls, zero rows.
3. **Corpus** — planner text has each source URL and its text, `EXISTING
   CARDS` with the owner's card label, the business name, the numbered
   starter questions; a `text`-type source's text is absent.
4. **Additive round-trip** — tenant with one owner contact card (order 0) and
   gallery photos; plan = designed + gallery + contact (tool exists) + booking
   + a duplicate label + a need-less card → exactly the designed and gallery
   rows are written after the owner's, in plan order, with the right tools; the designed
   row's block equals the draft and resolves through `customCardBlock`;
   the owner's row is byte-identical.
5. **Brief** — the draft seam received the brief, the need and the evidence.
6. **Events** — `need` events match the plan's needs; `card` events match the
   written rows' keys.
7. **Attachments** — a named unattached question now carries the card; one
   the owner attached is untouched.
8. **Second run** — the same plan again writes nothing new (labels/tools now
   exist) and reports `written: 0`.
9. **Best-effort** — throwing planner: `failed`, no rows, no throw. Throwing
   builder: the live cards are still written and every failed draft is
   counted in `designedFailed`.
10. **Route + button** — the route module's `POST` returns 401 with no
    session; `A2uiPanel.tsx` source names `/api/admin/site-cards` and the
    button text.
11. **Isolation and cleanup** — tenant B sees none of A's cards; every user
    and row the proof created is gone.

## Anti-Gaming Constraints
- Only `deps.llm` and `deps.draft` may be doubled; sanitizing, the corpus,
  `writeUiCard`, ordering and attachment writes are the real paths.
- Assertions read DB rows, the report, the events and the params the doubles
  received.

## Manual Gaps
- Live-model plan quality on a real imported site; the button's live log is
  walked once in the browser preview.

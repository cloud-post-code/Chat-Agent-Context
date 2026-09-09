# Proof Plan — Onboarding designs the A2UI card set; no default cards exist

## Definition Of Done
- `provisionUserDefaults` creates **zero** `UiCard` rows for a new account;
  profile, persona, theme and ingestion sources are still provisioned.
- `seedStarterUiCards` and `STARTER_CARDS` no longer exist in
  `lib/uiCards.ts`, and no source file under `lib/`, `app/`, `prisma/` or
  `scripts/` references them.
- `cardCatalog` returns the tenant's rows, and `[]` — never a fallback set —
  when the table is empty. An empty catalog reaches the chatbot as no card
  tools and no USING RICH CARDS section.
- `lib/onboarding/cards.ts` exists in the sibling-extractor shape: a system
  prompt (`CARDS_SYSTEM_PROMPT`), a sanitizer (`sanitizeCardPlan`), and
  `generateOnboardingCards(pages, userId, run, onEvent, deps?)` where
  `deps.llm` (the planner) and `deps.draft` (the card builder) are the two
  injectable model seams, defaulting to the real `llmExtract` and
  `draftUiCard`.
- A successful run writes one `UiCard` row per planned catalog card through
  the real `saveUiCard`/`writeUiCard` path, in plan order, with the plan's
  label/description/reason and a sample built from the tenant's own data
  (gallery photos) or the builder's validated draft (designed cards).
- Booking cards write no catalog row; projects/gallery/booking cards are
  dropped when the tenant lacks the data for them.
- The starter questions the plan named carry `cardTool`/`cardInput`
  afterwards; unmapped rows stay `null`; a row the owner had already
  attached a card to is untouched.
- Seeding happens **only** when the tenant has zero UI cards; a non-empty
  catalog costs no model call and is left byte-identical.
- Every failure is best-effort: a throwing planner, a throwing builder, or
  a draft `saveUiCard` rejects each leave the rest intact and never throw
  out of the stage.
- The plan is grounded: the planner's user text carries the page URLs, the
  business name, the goals, the numbered starter questions and the SIGNALS.
- With no pages (the manual path) the stage still runs from the business
  context.
- Designed cards reach the chatbot: `cardCatalog` lists them,
  `buildSystemPrompt` renders `show_card with key "<key>"` guidance, and
  `lib/brain.ts` offers `show_card` with that key in its enum.

## Primary Proof
Type: integration (repo-native proof script over the real dev Postgres;
fixture `Page`s built with cheerio; the model doubled only at the two
injectable seams; provisioning, sanitizing, `saveUiCard`, `cardCatalog`,
`customCardBlock`, `buildSystemPrompt` and `answer()`'s prompt/tool
assembly all real)

Command:
```bash
npx tsx docs/features/onboarding-a2ui-cards/proof.ts
```

Expected evidence: all `PASS` lines, exit code 0; throwaway users
(`proof-onboarding-cards-*@example.invalid`) and every row under them are
deleted in a `finally`. Red run recorded before implementation: the script
fails to import `lib/onboarding/cards.ts`.

Secondary guards (not proof):
- `npx tsc --noEmit` clean; `npx next lint` clean on touched files.
- `$HOME/.claude/scripts/gate` PASS.
- Sibling proofs `starter-questions-a2ui-cards`, `onboarding-goal-extraction`
  and `agentic-card-builder-search` still green.

## Assertions (all must pass)
1. **Sanitizer — shape** — `null`, a string, `{cards: 7}`,
   `{cards: [null, 3, {}]}` each yield an empty plan without throwing.
2. **Sanitizer — whitelist and gates** — an unknown `kind` is dropped;
   `gallery` is dropped when photos = 0, `projects` when projects = 0,
   `booking` when booking is off; `designed` without a brief is dropped; an
   invalid layout becomes `carousel`.
3. **Sanitizer — caps and dedup** — 9 cards in → 5 out; 5 designed in → 3
   out; a repeated label keeps the first; question numbers outside
   1..N are dropped and a number claimed twice belongs to the first card.
4. **Provisioning** — a freshly provisioned user has 0 UI cards and still has
   profile, persona, theme and ingestion sources.
5. **No starter set in code** — the `lib/uiCards` module namespace has no
   `seedStarterUiCards`/`STARTER_CARDS`, and a grep over `lib app prisma
   scripts` finds neither.
6. **Empty catalog, empty guidance** — `cardCatalog` returns `[]`;
   `buildSystemPrompt` has no USING RICH CARDS; `answer()` hands the doubled
   client no `show_*` tool.
7. **Round-trip** — on a tenant with 2 gallery photos, booking on, a goal and
   5 blank starter questions, a plan of gallery + designed + contact +
   booking + projects writes exactly 3 rows (gallery, designed, contact) in
   that order with the right tools; the gallery sample holds the tenant's
   real photo srcs; the designed row's block equals the builder's draft and
   its key resolves through `customCardBlock`; the report lists them.
8. **Builder brief** — the `draft` seam received the planner's brief, the
   company name, and the text of the question the card accompanies.
9. **Attachments** — Q1 → `show_card {"key"}`, Q2 → `show_gallery
   {"layout"}`, Q3 → `show_booking`; Q5 (unmapped) stays null; Q4, which the
   owner had attached `show_projects` to, is untouched; `attached` = 3.
10. **Chatbot integration** — `cardCatalog` lists the three; the prompt has
    each reason and `show_card with key "…"`; `answer()`'s tools include
    `show_gallery`, `show_contact_form`, `show_card` (enum holds the key) and
    `show_booking`, and exclude `show_projects`/`show_project`.
11. **Corpus** — the planner text carries the page URLs, the business name,
    the goal, "STARTER QUESTIONS" with each numbered question, the photo
    count and the booking signal.
12. **Gate** — a tenant with one owner card: no model call, `keptExisting`,
    the row byte-identical, nothing attached.
13. **Best-effort** — throwing planner: `failed`, 0 rows, no throw. Throwing
    builder: live cards still written, `designedFailed` = 1, the designed
    question stays unattached, no throw. A draft `saveUiCard` rejects:
    skipped and counted, live cards intact.
14. **Manual path** — no pages still calls the planner; the corpus names the
    business; the contact card lands.
15. **Tenant isolation and cleanup** — tenant B sees none of A's cards; every
    row and user the proof created is gone at exit.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`); the script loads `.env`
  itself. Embedding keys are blanked so nothing goes online.
- No network: fixture pages from inline HTML; both seams are scripted
  doubles.

## Anti-Gaming Constraints
- Only `deps.llm` and `deps.draft` (and the brain's client, for the
  integration checks) may be doubled. Sanitizing, `writeUiCard`, the
  zero-cards gate, attachment writes, `cardCatalog`, `customCardBlock`,
  `buildSystemPrompt` and `answer()`'s tool assembly must be the real paths.
- Assertions read DB rows, the returned report and the params the doubles
  received — never model-authored prose.
- The "no starter set" check must inspect the real module namespace and grep
  real source, not assert in prose.
- Do not weaken FEATURE.md (seeding into a non-empty catalog, a fallback
  catalog, overwriting an owner's attachment) to make the proof pass.

## Manual Gaps
- Live-model plan and card quality on a real site, and the wall-clock cost
  of up to three concurrent builder drafts at the end of a run.
- The "All done" sentence naming the cards is a visual spot-check.

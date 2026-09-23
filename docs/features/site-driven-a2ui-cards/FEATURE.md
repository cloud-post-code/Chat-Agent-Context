# Feature — Build A2UI cards from the imported site, on demand

## Summary

Onboarding designs a card set once, and only into an empty catalog
(`onboarding-a2ui-cards`; "Regenerating cards later from the dashboard" was
left out of scope). After that the only way to get a card is to describe one
by hand in the builder. The system already holds the business's whole site —
every page onboarding imported is a `Source` row — and nothing reads it again
to ask "what else would this business's visitors need to see?".

This adds a **Build cards from my site** button to the A2UI tab. It runs an
agent that reads the imported site, works out which visitor needs the current
catalog does not serve, and builds a card for each.

## Desired Behavior

### The agent (`lib/siteCards.ts`)
- **Reads the imported site from the database** — the tenant's `Source` rows
  of `type: "link"` that have text (what onboarding and later URL ingests
  saved), newest-updated first, each under `=== <url>` with its title,
  2 500 chars per page and 40 000 in total. No crawling, no browser.
- **No site, no run.** A tenant with no such rows gets `noSite: true`, no
  model call, and a message pointing at Sources.
- **Knows what already exists.** The corpus carries an `=== EXISTING CARDS`
  block (label, tool, reason per row) beside the same BUSINESS, SIGNALS and
  STARTER QUESTIONS blocks the onboarding planner reads.
- **Determines needs, then cards.** One planning call returns up to 4 needs.
  Each names the visitor `need` in a sentence, the `evidence` (the page URL
  it was read from), and the card that serves it — the same card kinds and
  fields as the onboarding plan, minus `booking` (it writes no row).
- **Sanitizer** — `sanitizeSiteCardPlan` runs the onboarding sanitizer
  (whitelist, signal gates, caps, dedup, question numbers) and then drops:
  `booking`; any live-data card whose tool the catalog already has; any card
  whose label matches an existing row (case-insensitive); any card with no
  `need`. `evidence` is kept only when it is one of the URLs in the corpus.
  At most 4 cards. Never throws.
- **Builds additively.** Live-data cards are written with the tenant's own
  data as the sample; designed cards go through the real `draftUiCard`
  builder, whose brief also states the need and the evidence page. New rows
  take orders after the catalog's current last row, in plan order. Existing
  rows are never modified or deleted.
- **Attaches** each new card to the starter questions the plan named, only
  where no card is attached (the onboarding rule, same code).
- **Best-effort per card**: a failed draft costs that card only. A failed
  planning call reports `failed` and writes nothing. Nothing throws out.
- Emits typed events as it goes: `status` lines, one `need` event per
  planned need, one `card` event per row written.

### Transport (`app/api/admin/site-cards/route.ts`)
- `POST`, admin-only (401 before any model call), NDJSON stream, the
  build-card route's line protocol: `status` / `need` / `card` lines, then
  exactly one `done` line carrying the report, or one `error` line.

### The button (`app/admin/A2uiPanel.tsx`)
- "Build cards from my site" sits in the toolbar beside "+ Build a card".
- While running it is disabled and reads "Reading your site…"; a live log
  under the toolbar shows each need (with its evidence page) and each card
  as it lands.
- On `done` the panel refreshes its rows (`router.refresh()`), keeps the log,
  and shows the outcome in words: the cards built, "nothing new to add — your
  cards already cover what the site offers", or "no imported site yet".

## Boundaries
- `lib/onboarding/cards.ts` exports the pieces the new agent reuses
  (`businessBlock`, `readSignals`, `placeCard`, `attachToQuestions`, the
  signals/corpus text) and `placeCard` accepts optional extra builder
  instructions. Onboarding's own behavior — including its empty-catalog
  gate — is unchanged.
- No schema change, no new dependency, no new crawling.
- `agent.md` gains a section describing the agent.

## Non-Goals
- Re-crawling the live site (re-import under Sources does that).
- Editing, replacing or deleting existing cards; a review/confirm step.
- Running on a schedule or at ingest time — a button for now.

## Implementation Routing
Backend TypeScript in the onboarding-extractor shape, one streaming route,
one client control in an existing panel.

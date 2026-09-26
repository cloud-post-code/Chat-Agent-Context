# Onboarding designs the A2UI card set; no default cards exist

## Why

Every account is provisioned at signup with the same five A2UI cards
(`STARTER_CARDS` in `lib/uiCards.ts`: all projects, single project, two
gallery layouts, contact form), and `cardCatalog` falls back to that same
list whenever a tenant's table is empty. Those cards were written for a
personal portfolio site. A nail salon, a kiln-retrofit contractor or a
consultancy gets "All projects" and "Single project" cards it can never use,
and nothing for the things its visitors actually ask about — services and
prices, hours and locations, the team, what a first visit is like. The
chatbot's tool list and its USING RICH CARDS instructions are built from the
catalog, so a generic catalog makes a generic agent.

Onboarding already reads the whole site, derives the agent's goals, and
writes business-specific starter questions. It is the moment the system knows
the most about the business, and the natural place to decide which cards
this agent should be able to draw.

## Behavior

### No defaults
- Signup provisions **zero** UI cards. `seedStarterUiCards` and
  `STARTER_CARDS` are deleted; `provisionUserDefaults` no longer has a
  "ui cards" step (every other starter catalog is untouched).
- `cardCatalog` returns the tenant's rows or an empty list. There is no
  fallback set: an account with no rows offers the model no card tools and
  no USING RICH CARDS section, which `lib/brain.ts` and `lib/knowledge.ts`
  already handle. Booking keeps its own toggle and is unaffected.
- The A2UI tab's copy no longer promises that deleting every card restores a
  starter set; its empty state says onboarding designs the set and the
  builder adds more.

### Generation (`lib/onboarding/cards.ts`)
Follows the sibling-extractor shape (`goals.ts` is the closest precedent): a
planning system prompt, a sanitizer, and one entry point with injectable
model seams.

- **Corpus** — the pages the knowledge stage already loaded (the services
  pages when that extractor ran, otherwise home + extras; no new crawling),
  then a BUSINESS block (name, tagline, brand values, goals, knowledge on
  file), a SIGNALS block stating what the site actually has (gallery photo
  count, whether booking is on, projects on file, which contact channels are
  listed, which knowledge categories produced content), and the STARTER
  QUESTIONS the run just wrote, numbered in page order.
- **The plan** — one model call proposes at most 5 cards. Each is one of:
  - `gallery` (tool `show_gallery`, a layout) — only when SIGNALS lists
    photos;
  - `projects` (tool `show_projects`) — only when projects exist;
  - `booking` — writes no catalog row (booking is not catalog-driven) and
    exists only so a "how do I book?" question can carry `show_booking`;
    only when SIGNALS says booking is on;
  - `designed` — a business-specific card the AI card builder will draft
    from a brief the planner writes ("a services-and-prices card listing the
    treatments on the site with what each includes"). At most 3 per run.
  Each card carries its label, one-line description, the `reason` the
  chatbot will receive ("When …"), and the numbers of the starter questions
  it should accompany. A question maps to at most one card.
- **Prompt rules** — cards must serve what a prospective customer of THIS
  business needs, in its own vocabulary; never a card for content the site
  does not have; never invent facts in a brief; the brief tells the builder
  what to search the knowledge base for rather than supplying numbers.
- **Sanitizer** — `sanitizeCardPlan` enforces the kind whitelist, the
  signal gates (no gallery without photos, no projects without projects, no
  booking when booking is off), the caps, label/reason/brief trimming and
  length limits, de-duplication by label, and valid, unique question
  numbers. Never throws on a junk shape (returns an empty plan).
- **Writing** — live-data cards are written through the real `saveUiCard`
  path with the tenant's own data as the preview sample (the gallery card
  previews the photos onboarding imported; projects and social links use
  their hydrated blocks). Designed cards go through the existing `draftUiCard`
  builder — the same research-enabled loop the admin's "Build a card" page
  uses, so the card is drafted from the knowledge base the run just indexed
  — and the validated draft is saved through `saveUiCard`. Designed drafts
  run concurrently; each is best-effort, so one failed draft costs that card
  only. Rows take the plan's order.
- **Attaching to the core questions** — for each starter question the plan
  named, the `CannedAnswer` row gets `cardTool` (+ `cardInput`: the gallery
  layout, or the designed card's key) so the visitor who taps that chip sees
  the card with the answer. Only rows with no card attached are touched;
  an owner's own attachment is never overwritten.
- **Seeding is additive and never overwrites the owner's catalog.** The
  stage seeds only when the tenant has **zero** UI cards (the goals and
  booking-form rule). Re-onboarding wipes the catalog first, so a re-run
  designs afresh; an owner who has built or kept any card keeps exactly
  what they have, and the run reports that it left them alone.

### Job wiring
- `lib/onboarding/jobs.ts`: runs at the very end of the knowledge stage,
  after the starter questions are written (it reads them). Best-effort like
  the graph and goals passes: a failure logs honestly and leaves
  `phase: "done"`. Reports into `job.cards` (`CardsReport`) and logs a real
  line per outcome — each card as it lands, the attachments made, or that
  an existing catalog was kept.
- `app/api/admin/onboarding/complete/route.ts` (manual / skip path): the
  same stage runs after starter-question generation with no pages — the
  plan is grounded in the profile and whatever knowledge exists, which for
  a sparse manual setup usually means few cards and nothing invented.
- The onboarding flow's "All done" message names the cards that were
  designed.

## Boundaries
- `lib/onboarding/cards.ts` owns the prompt, sanitizer, corpus, writing and
  attaching. `jobs.ts` and the complete route gain a thin call and log
  lines. `lib/uiCards.ts` loses the starter set and gains a key-returning
  write (`writeUiCard`) that `saveUiCard` wraps. No change to the card
  builder's brief, validation or theme gate, to `lib/brain.ts`, to
  `lib/knowledge.ts`, or to how canned rows are matched or served.
- No new dependency; no new crawling; no schema change (a doc comment on
  `UiCard` is corrected).

## Out of scope
- A review/confirm step in the onboarding UI for the drafted cards; they
  land live and are editable on the A2UI tab and in the builder.
- Regenerating cards later from the dashboard (the builder covers adding
  more; a "Regenerate cards" control can follow the Presets precedent).
- Backfilling existing accounts that still hold the old starter rows; those
  rows are the owner's now, and Restart onboarding designs a fresh set.
- Voice/A2A channel behavior; unchanged.

## Implementation Routing
Required skills: coding-proof-author (backend TypeScript library code in the
established onboarding-extractor shape; one copy change in the admin panel
and one sentence in the onboarding flow).

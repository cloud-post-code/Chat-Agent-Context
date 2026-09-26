# Agent behavior

How the visitor-facing agent (`lib/brain.ts`) decides what to say. Update this
file whenever prompts, tools or routing change.

## Turn flow

1. **Canned answer?** A matching `CannedAnswer` with a card attached (or on a
   channel that can't draw cards) is served as-is, zero model calls. Without a
   card it becomes the model's script (`APPROVED ANSWER`).
2. **Prompt** (`lib/knowledge.ts`): persona core + `KNOWLEDGE FOR THIS
   QUESTION`, one retrieval keyed on the visitor's message
   (`lib/retrieval/search.ts`): stemmed BM25 + same-model cosine, source titles
   scored, one-hop graph expansion. Small multi-chunk sources (a price list)
   are served whole.
3. **Tools**: catalog cards (`show_projects`, `show_project`, `show_gallery`,
   `show_contact_form`, `show_card`), each narrowable with
   `ids`/`tags`/`query`/`limit`/`title` where it applies (`show_gallery` also
   takes the required `layout`) — see "Composable elements" below.
   `show_social` is gated on the tenant actually having social links on file
   rather than on the card catalog (`platforms`, `title`), and
   `search_knowledge` is offered on every unscripted turn. There is no booking,
   services, menu or cart tool any more: that whole strand was removed on
   2026-09-26 (the last state with it is commit `b4d06cf` on main).
4. **Loop**: up to 4 model turns; tool results are fed back so the model can
   close.

## Composable elements

Several small, focused cards beat one big one (the `COMPOSING CARDS` prompt
paragraph, `lib/knowledge.ts`). `show_gallery`/`show_projects` share one filter
idiom, built on pure, import-free modules so a proof can exercise them
without a database: `lib/terms.ts` (`meaningfulWords`, `idfWeights`,
`overlapScore`), `lib/photoIndex.ts` (`filterPhotos`, `tagVocabulary`,
`photoIndexLines`), and `lib/projectIndex.ts` (`filterProjects`).

**Filter semantics** (both follow the same rule): an EMPTY filter (no
`ids`, no `tags`, no `query`) returns EVERY item with NO limit —
canned rows (a starter question or a catalog row with no arguments) depend on
this to render the full gallery/list. A non-empty filter defaults to 6 items
and caps at 12. `ids` come back in caller order with unknown ids dropped.
`tags` are ANDed, and a tag matches an item whose own `tags` carry it OR whose
caption/description contains it as a word (`meaningfulWords`) — an untagged
photo captioned "red gel nails" still matches `tags:["red"]`. `query` is free
text, scored by IDF-weighted term overlap and sorted best-first.

**PHOTO INDEX** (`lib/knowledge.ts`): the prompt gets a
`PHOTO INDEX (id | caption | tags)` section only when `show_gallery` is
actually offered — naming photos the model can't draw is how you get an
apology instead of a card. The `PROJECT INDEX` lists project ids for
`show_project`. The `COMPOSING CARDS` paragraph is appended whenever the
catalog has a guidance line or the social tool exists.

**Card memory**: each rendered card's summary is folded into the assistant
history the model sees on its NEXT turn, so "book that" or "the red ones" can
resolve against a card the visitor actually saw. `app/cards/shown.ts`
(`shownFromCards`, pure and client-safe) derives a capped `ShownCard[]` from a
message's rendered cards — gallery/projects → item ids (gallery also
carries the tag union); social → ids = platform names — capped at 4 cards per
message and 12 ids/tags per card.
`app/Chat.tsx` attaches this to each assistant message it sends back; the
server (`app/api/chat/route.ts`) re-sanitizes it (types ≤20 chars, ids ≤64
chars, same caps) before `lib/brain.ts`'s `runModel` renders history content
as `content + "\n\n[shown: gallery ids=p1,p2 tags=red,gel · projects
ids=x1]"` (only when non-empty). The `COMPOSING CARDS` paragraph tells the
model what that marker means and to reuse its ids/tags for "those"/"that
one"/"the red ones" instead of asking the visitor to repeat themselves — it
is bookkeeping, never displayed to the visitor, logged, or spoken back.

`hydrate()` (`lib/brain.ts`) turns a tool call into its `UiBlock` plus the
tool-result string the model actually reads — "Rendered N photos: id
(caption), …", "No photos match. Tags on file: a, b, c", "Rendered N
projects.", "No social links for: tiktok" — never a blind "Card rendered to
the user.", so a
filter that matched nothing can be retried with different words instead of
the model hearing a content-free acknowledgement.

**Photo tags**: `Photo.tags` (JSON string array) is set by the vision
curator and the upload flow for new photos, parsed everywhere through
`parsePhotoTags` (never throws). `scripts/tagPhotos.ts` backfills tags for
photos uploaded before tagging existed — not run automatically; an operator
runs it once per tenant that needs it.

Proof: `docs/features/composable-a2ui-elements/proof.ts`.

## search_knowledge

The model's second look at the knowledge base, in its own words. The
`LOOKING THINGS UP` prompt section lists the knowledge sections and requires a
search before telling a visitor something is unavailable. Results go to the
model only. Not offered on scripted turns.

## Answer rules

Facts only from the prompt or a search. Lead with what is known; when the exact
thing isn't listed, give the closest related facts and name the gap; asked for
everything, give the full list. Then, and only then, hand off to the owner.

## Site-cards agent: A2UI cards from the imported site

The A2UI tab's "Build cards from my site" button runs `buildCardsFromSite`
(`lib/siteCards.ts`, `SITE_CARDS_SYSTEM_PROMPT`) over
`POST /api/admin/site-cards` (NDJSON: `status` / `need` / `card`, then one
`done` or `error`). It reads the site the business imported — the tenant's
link `Source` rows, no crawling — beside an `EXISTING CARDS` block and the
onboarding planner's BUSINESS / SIGNALS / STARTER QUESTIONS blocks. One
planning call names up to 4 visitor **needs**, each with the page URL it was
read from and the card that serves it (`gallery`, `contact`, `projects`,
`social`, `designed`). `sanitizeSiteCardPlan` drops a need
the catalog already covers (same tool for a live-data card, same label for any
card) before the onboarding sanitizer's gates and caps. Cards are placed
through onboarding's `placeCard`: designed ones go to the research-enabled card
builder (`draftUiCard`) with the need and its evidence page added to the brief.
Strictly additive — rows append after the catalog's last, existing rows are
never touched, new cards attach only to starter questions with no card. No
imported site means no model call. Designed cards need a builder model that
supports adaptive thinking (`CARD_BUILDER_MODEL`). Proof:
`docs/features/site-driven-a2ui-cards/proof.ts`; live check: `crosscheck.ts`
beside it.

## Admin copilot: focused edits

The admin copilot (`lib/adminBrain.ts`, `/admin/chat`) has `show_panel`,
`save_goal`, `propose_ingestion`, and `propose_theme_color {role, value}`. Its
system prompt carries the account's current theme colors by role (stored value
or fallback) and says the page name renders in the `text` role, so "make the
accent the color of the name" resolves to a hex. Asked for a color change it can
work out, it calls `propose_theme_color` instead of opening the Theme panel: the
chat shows only that color's editor, pre-filled (`edit` event → `ThemeEditCard`),
and nothing is written until the admin clicks Save (`applyThemeColorAction` →
`applyThemeColor`, which merges one role and leaves the rest of the theme alone).
A color it cannot derive gets one question or the full panel — never a guess.
The `edit` event names its `panel` so other panels can add slices later. Proof:
`docs/features/copilot-focused-edits/proof.ts`.

## Admin copilot: element reveal

The list panels of the dashboard are also split into addressable elements —
one goal, rule or preset — that carry flat facets (`lib/adminElements.ts`:
`ELEMENT_PANELS`, the per-row builders, `selectElements`). The copilot's
`show_elements {panel, ids?, where?, limit?}` reveals only the matching rows:
ids picked from the ELEMENTS index in its prompt, or where-filters (`is`,
`contains`, `before`, `after`, `gte`, `lte`, ANDed) evaluated in code — never
by the model choosing markup — so "the presets nobody has used" becomes
`served is 0`. The `elements` event `{panel, ids, title}` is rendered by
`AdminChat` from `elements[panel][id]`, one pre-rendered node per row built by
`app/admin/elements.tsx` through the panels' own row components
(`DirectiveForm`, `AnswerForm`), so a revealed row keeps its real server
actions. Brain and panel build their index from the same rows via the same
builders (`loadElementData` / `buildElementIndex`), which is what keeps the
ids in agreement. Panels without elements (chats, cards, contacts, users,
source items, settings) still reveal whole via `show_panel`. Proof:
`docs/features/copilot-element-reveal/proof.ts`.

## Admin copilot: panels follow the dashboard nav

The dashboard's six groups (Home, Inbox, Knowledge, Agent, Cards, Settings)
are declared once in `app/admin/contentTabs.ts` (`NAV_GROUPS`).
`adminPanelKeys` builds the copilot's `show_panel` enum from the same config
(`fixedPanelEntries`), so the chat can reveal exactly the panels the dashboard
shows — never `home`, and `users`/`bulk` for operators only. `show_panel` maps
retired keys through `TAB_ALIASES` before looking a panel up, so saved chats
and canned answers naming `calendar`, `appointments` or `orders` (the retired
booking panels) still land on Chats. Chat starter chips point at Chats,
Presets, Goals and Cards. Proof: `docs/features/admin-nav-groups/proof.ts`.

## Testing

`docs/features/dynamic-knowledge-answers/` — the question set (`questions.ts`),
offline proof, and `--live` answer eval.

## LLM-readable files (llms.txt)

Not a transport over the brain but the brain's knowledge published for
ChatGPT, Claude and their crawlers to read directly: `lib/llms.ts` gathers one
tenant's public facts (profile, persona, projects, enabled approved answers
with text, scanned non-ingest source summaries) and renders `/a/<slug>/llms.txt` (index) and
`/a/<slug>/llms-full.txt` (everything, fixed section order, empty sections
omitted); `/llms.txt` and `/llms-full.txt` cover the directory. Directives,
corrections, activity and contacts never appear. `app/robots.ts`
allows the named AI user agents, `app/sitemap.ts` lists the files, the agent
page's `<head>` links its Markdown twin, and `middleware.ts` rewrites
`Accept: text/markdown` or a `.md` suffix to the full document. Proof:
`docs/features/llm-readable-site/proof.ts`.

## Bulk site builder

An operator-only Settings panel (`POST/GET /api/admin/bulk-build`) that turns a
pasted list of business links into fully onboarded tenants with no human
review of any stage. `lib/onboarding/jobs.ts`'s `runUnattendedJob` runs the
guided flow's stages (core → locations → social → images → theme → knowledge)
back to back for one job, awaiting a per-stage hook instead of the chat's poll
loop. `lib/bulkBuild.ts`'s `startBulkBuild` fans that out over the pasted list
(`parseLinks`: normalize, dedupe, drop malformed entries), `BULK_BUILD_CONCURRENCY`
(default 2, max 4) sites at a time via `mapPool`, each behind its own
`createBulkAccount` (`lib/bulkAccounts.ts`) — a username-only account with no
real email, stored under the reserved `bulk.invalid` domain so the unique-email
schema is untouched. Every stage's result is auto-approved: saved verbatim
through `saveOnboardingReview` (`lib/onboarding/save.ts`, the same write path
the chat review cards use, extracted out of the onboarding save route so both
callers share it), mapped to match exactly what the guided flow's client sends
(theme font fixed to `space-grotesk`, colors filtered to the seven known roles,
gallery images passed through by `src`/`caption`). If the core stage fails the
whole site fails and its half-made account is deleted; a later stage failing is
logged as a warning and the run continues, so one bad site never aborts the
batch. `authenticate` (`lib/bulkAccounts.ts`) is the one credential check used
by both the login action and the proof: an identifier without `@` is looked up
as a username. Proof: `docs/features/bulk-site-builder/proof.ts`; live check:
`crosscheck.ts` beside it.

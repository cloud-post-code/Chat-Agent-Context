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
   `show_services`, `show_menu`, `show_cart`, `show_contact_form`,
   `show_card`), `show_booking` when booking is on (with an optional
   `service` to open the flow on the service the visitor named),
   `add_to_cart` whenever the menu is in the catalog, and `search_knowledge`
   on every unscripted turn.
4. **Loop**: up to 4 model turns; tool results are fed back so the model can
   close.

## Booking

`show_booking` draws the whole flow (`lib/booking/store.ts` → `getBookingFlow`):
services (a list, with a photo where there is one) with prices, providers,
locations, live availability, customer details, intake questions, review,
confirm. The tool is offered whenever booking is on. The card is handed the
flow's **trimmed** intake (`trimIntake`): the catalog minus name/email/phone,
the service picker when there is a service step and a `staff` question when
there is a provider step — each thing is asked once, as a step. The `BOOKING`
prompt section tells the model to draw it rather than collect details in
conversation, and never to promise a time the card has not shown. The server
recomputes duration, price, provider and slot from ids on submit, and demands
answers to the same trimmed intake; the card's figures are convenience.

## The menu and the cart

When a `show_menu` (or `show_cart`) row is in the catalog the prompt gains a
`MENU INDEX` — one line per item: key, name, section, price and tags
(`menuPromptSection`, `lib/menu.ts`) — with the rule: `show_menu` with no
filter for the whole menu, `keys` for a curated list that fits the question,
`tags` for a dietary or popularity filter, `category` for a section; never a
price or tag not in the index. The chat request carries the visitor's cart
(names and counts) and the prompt gets a `VISITOR'S CART` section from it.
`add_to_cart {key, quantity}` is checked against the menu on file and emits a
`cart` event the page applies; an unknown or unavailable key emits nothing and
the model is told so. `show_cart` draws the cart card. The menu itself is
written by the services extractor (`SERVICES_SYSTEM_PROMPT` now reports a
`menu` object per service — every field optional, never invented — beside an
`=== IMAGES` list of the pages' image URLs) into `MenuItem` rows; the
onboarding and site-cards planners gained kind `menu`, gated on items on file,
which wins over `services` when both are planned. Proof:
`docs/features/menu-cart/proof.ts`.

## search_knowledge

The model's second look at the knowledge base, in its own words. The
`LOOKING THINGS UP` prompt section lists the knowledge sections and requires a
search before telling a visitor something is unavailable. Results go to the
model only. Not offered on scripted turns.

## Answer rules

Facts only from the prompt or a search. Lead with what is known; when the exact
thing isn't listed, give the closest related facts and name the gap; asked for
everything, give the full list. Then, and only then, hand off to the owner.

## Onboarding: booking

The services extractor (`lib/onboarding/services.ts`, `SERVICES_SYSTEM_PROMPT`)
also reads the business's own booking page, offsite widgets included
(`=== BOOKING PAGE <url>`), and reports the booking `kind`, `staff` a customer
can ask for (kept only when the name is in the text read), whether `phone` /
`email` are asked, and `notes`. It is told not to report the service choice or
the date and time as requirements. What it finds becomes rows: services →
`Service` (`seedServices`), the booking page's staff names → `StaffMember`
after the extraction pool (`lib/onboarding/jobs.ts`, merged by name with the
team pages' bios so nobody is listed twice), and `lib/bookingFormPlan.ts`
turns the rest into the intake questions — no model call; site evidence beats
the per-kind norm; never a service or staff question, those are steps. A
photo attaches to a service or person only when a caption names it
(`lib/booking/matchImages.ts`: all of a short name's words, most of a long
one's), and never to two things. `rebuildUntouchedForm` writes the questions
only over a form nobody has edited.

Once extraction is done the onboarding chat runs two more steps — the
services (price kind, amount, length, on/off) and the providers (name, role,
on/off, whether visitors pick who they see) — through
`GET/POST /api/admin/onboarding/booking` (`lib/onboarding/bookingReview.ts`),
partial patches over the same store the Booking tab writes. "Restart
onboarding" (`lib/accountReset.ts`) wipes the booking setup, the menu and the
appointments with everything else. Proofs:
`docs/features/booking-setup-in-chat/proof.ts`,
`docs/features/booking-form-planner/proof.ts`.

## Site-cards agent: A2UI cards from the imported site

The A2UI tab's "Build cards from my site" button runs `buildCardsFromSite`
(`lib/siteCards.ts`, `SITE_CARDS_SYSTEM_PROMPT`) over
`POST /api/admin/site-cards` (NDJSON: `status` / `need` / `card`, then one
`done` or `error`). It reads the site the business imported — the tenant's
link `Source` rows, no crawling — beside an `EXISTING CARDS` block and the
onboarding planner's BUSINESS / SIGNALS / STARTER QUESTIONS blocks. One
planning call names up to 4 visitor **needs**, each with the page URL it was
read from and the card that serves it (`gallery`, `services`, `contact`,
`projects`, `designed`; never `booking`). `sanitizeSiteCardPlan` drops a need
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

## Admin copilot: panels follow the dashboard nav

The dashboard's seven groups (Home, Inbox, Knowledge, Agent, Cards, Booking,
Settings) are declared once in `app/admin/contentTabs.ts` (`NAV_GROUPS`).
`adminPanelKeys` builds the copilot's `show_panel` enum from the same config
(`fixedPanelEntries`), so the chat can reveal exactly the panels the dashboard
shows — never `home`, and `users`/`bulk` for operators only. The old combined
Calendar became `appointments` (Inbox) + `booking` (Settings, the on/off
switch); the Booking group holds the setup panels (Services, Providers,
Locations, Hours, Customer, Questions, Pricing —
`BOOKING_TAB_KEYS`/`app/admin/booking/*`). `show_panel` maps retired keys
through `TAB_ALIASES` before looking a panel up, so saved chats and canned
answers naming `calendar` still open Appointments. Chat starter chips point at
Chats, Presets, Appointments and Cards. Proof:
`docs/features/admin-nav-groups/proof.ts` (nav/resolver) and
`docs/features/booking-flow/proof.ts` (the Booking section's own panels).

## Testing

`docs/features/dynamic-knowledge-answers/` — the question set (`questions.ts`),
offline proof, and `--live` answer eval.

## LLM-readable files (llms.txt)

Not a transport over the brain but the brain's knowledge published for
ChatGPT, Claude and their crawlers to read directly: `lib/llms.ts` gathers one
tenant's public facts (profile, persona, services, menu, projects, enabled
approved answers with text, scanned non-ingest source summaries, booking
questions) and renders `/a/<slug>/llms.txt` (index) and
`/a/<slug>/llms-full.txt` (everything, fixed section order, empty sections
omitted); `/llms.txt` and `/llms-full.txt` cover the directory. Directives,
corrections, activity, orders and contacts never appear. `app/robots.ts`
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

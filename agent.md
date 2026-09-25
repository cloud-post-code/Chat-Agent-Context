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
services with photos and prices, providers, locations, live availability,
customer details, intake questions, review, confirm. The `BOOKING` prompt
section tells the model to draw it rather than collect details in
conversation, and never to promise a time the card has not shown. The server
recomputes duration, price, provider and slot from ids on submit; the card's
figures are convenience.

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

## Onboarding: the booking form

The services extractor (`lib/onboarding/services.ts`, `SERVICES_SYSTEM_PROMPT`)
also reads the business's own booking page, offsite widgets included
(`=== BOOKING PAGE <url>`), and reports the booking `kind`, `staff` a customer
can ask for (kept only when the name is in the text read), whether `phone` /
`email` are asked, and `notes`. It is told not to report the service choice or
the date and time as requirements. `lib/bookingFormPlan.ts` turns those facts
into the questions — no model call; site evidence beats the per-kind norm —
and `rebuildUntouchedForm` writes them only over a form nobody has edited.
Checked live against a real booking page by
`docs/features/booking-form-planner/crosscheck.ts`.

## Onboarding: the booking-form step

Second to last in the onboarding chat (before the knowledge pick; last on the
manual path). The services read runs as its own `booking` stage
(`lib/onboarding/jobs.ts` `runBooking`, fail-soft) so the form it built can be
shown before extraction: `BookingFormStep` lists the steps a customer meets
(`lib/booking/steps.ts`, pure, from the same `BookingFlow` the card draws),
opens the real `BookingFlowCard` in `preview` (real availability and quote,
nothing booked), and takes plain-words requests. Each request is one round of
`lib/onboarding/bookingFormChat.ts` (`POST /api/admin/onboarding/booking-form`):
the model is told the form as it stands — services with ids, providers,
customer fields' state, questions with keys, the step order — and changes it
with `add_question` / `edit_question` / `remove_question` /
`reorder_questions`, `set_customer_field`, `set_staff_selection`,
`set_confirmation`, `add_service` / `edit_service` / `remove_service`, then
answers in a sentence; the form is re-read and shown again with new, changed
and removed steps marked. Name, email and phone are customer details, never
questions; prices only as stated. Every write goes through the store the
Booking panels use, so a chat edit claims the form (no longer `generated`).
The knowledge stage skips `services` once the booking stage ran. Proof:
`docs/features/onboarding-booking-form-step/proof.ts`.

## Booking in the chat: a conversation of cards

A visitor's booking is a sequence of cards down the thread, never a wizard
inside one bubble. A `booking` block from `show_booking` (or Book on the
services card) starts a session: the chat gives it a `sessionId`, appends
`<sessionId>:start`, then asks each planned step (`lib/booking/flowSteps.ts`
`planSteps`, the business's own order, review last) as an assistant message
whose text is the step's intro — the business's own screen title, else the
fixed line from `lib/booking/session.ts` `intro()` — with the step card
mounted once the typing ends. A finished card answers as one user line
(`Picked: Gel Manicure · $35`, `Options: …`, `Provider: Katherine`,
`Where: …`, `When: …`, `Details: name · email · phone`, `Answers: …`) and the
next ask appends. Ids are stable — `<sessionId>:<stepId>:ask` / `:reply`,
`<sessionId>:confirmed:ask`; StepId `service | options | provider | location
| time | screen:<n> | review` — so an edit on a card that is still on the
page rewrites its line in place (`app/ChatThread.tsx` `appendMessages`
replaces by id); a step the edit makes necessary is asked below the review
with Confirm disabled until answered. Confirm → `POST /api/booking` →
`Booked: …` and "You're booked — the details are below." with a
`booking_confirmed` card; the cards lock. The model never sees the cards'
lines one by one: `foldBookingLines` sends it ONE user line `Booking so far:
…` per session at the position of the session's last reply and drops empty
turns; while a session is live the model answers questions and draws no
second booking card — a second `booking` block renders "Your booking is in
progress above — keep going there, or say 'start over'." The session lives
beside the chat in localStorage (`booking:<slug>:<sessionId>` next to
`chat:<slug>:<id>`); without it the session's messages are pruned by id and
the first step asked again. Proof: `docs/features/booking-in-chat/proof.ts`.

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

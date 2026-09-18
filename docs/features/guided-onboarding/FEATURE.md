# Guided admin onboarding with website extraction

## Summary
When a user logs into the admin panel for the first time, they land on a guided
onboarding page that populates their business profile (`Profile`), theme
(`ThemeConfig` + `PersonaConfig.company_logo`), and knowledge base
(`Source`/`Chunk`) — either automatically by extracting from their existing
website URL with Playwright, or manually via the same forms left empty.

## Desired Behavior
- On first login to the admin panel, a not-yet-onboarded user is routed to a
  single onboarding page instead of the dashboard. An already-onboarded user
  never sees it again (completion is persisted per user; skipping/finishing
  the manual path also counts as onboarded).
- The first screen offers two entry options:
  1. **"Enter a link to an existing site"** — the extraction path.
  2. **"Set up manually"** — the same step-1 and step-2 forms, empty, with no
     extraction; step 3 is skipped.
  - Assumption (from the original request's "with a past site" phrasing): a
    past/existing site is the same as option 1, not a third option. If a third
    option was intended, only the entry screen changes.
- Revision (2026-08-29, user-requested): the page is a CHAT conversation, not
  a form page. The assistant asks for the website link; extraction runs in
  STAGES so the first editable card appears seconds after the URL is entered
  (slow origins made the all-at-once crawl feel frozen): contact info first,
  then theme on request, then only the knowledge extractions the user selects
  (blog / testimonials / team / sitemap sweep) — which keep running in the
  background while the user continues to the dashboard. Contact and theme
  reviews are the same shared FormCard component with different field specs,
  pre-filled by the agents before being shown. Bare domains that answer only
  on plain http fall back from the https normalization automatically.

### Step 1 — Core information (Playwright extraction)
- Crawl the entered site, including its full sitemap, and extract:
  company name, owner name, company address, company phone number, company
  email, and company hours per day of the week.
- Any field the site does not show is left empty — never fabricated.
- The extracted values appear in a fully editable form; on save they land in
  the user's `Profile` row (hours serialize into the free-text
  `company_hours` field in a consistent per-day format).

### Step 1c — Gallery photos (added 2026-09-03; curation revised 2026-09-05)
- After the locations review, extract up to 25 content images from the site
  (gallery/portfolio/about pages plus the pages already crawled).
- Revision (2026-09-09, user-requested): the conversation is a TRANSCRIPT.
  Each step used to replace the one before it, so by the theme stage only
  the greeting, the URL and the current bubble were left. Now every
  assistant message and every user answer stays on the page and the next
  step appends below it. A saved review form collapses into a one-line
  user message (the contact details, the locations, the profiles, the
  photos kept, the theme and tagline, the categories picked); each running
  stage's bubble shows only the activity lines that arrived during that
  stage; and when the knowledge run finishes, its feed stays with the
  "All done" summary added beneath it. A retry after a failed extraction
  starts the transcript over.
- Revision (2026-09-05, user-requested): candidates are CURATED by the model
  looking at the downloaded pixels. Keep only photos a potential customer
  would find useful or interesting (premises, work, products, spaces, team
  at work) and keep the set diverse; exclude avatar/letter-placeholder
  tiles, headshots, logos, icons, screenshots, and decorative filler. Every
  kept photo's caption is model-WRITTEN from what the image shows — never a
  person's name, never the site's alt text (which is routinely just a name).
  The site's stated captions remain context for the model only.
- Every kept image is downloaded and stored via `lib/uploads.ts`,
  so the review previews `/api/uploads/...` URLs. Gallery photos render at
  their natural aspect ratio everywhere (review card, filmstrip thumbnails,
  carousel, lightbox) — never cover-cropped.
- The review's A2UI element shows THREE photos at a time with a
  "page / pages" counter and prev/next arrows; captions are editable in
  place and any photo can be removed. Saving creates `Photo` rows
  (kind "gallery", replace semantics) that the public gallery card renders.
- Zero photos found skips the review and moves straight to the theme stage.

### Step 2 — Theme (Playwright extraction)
- Render a visual preview resembling the user's actual public `/a/[slug]`
  page with the extracted theme applied; every value is editable in place.
- Extract the **closest match among the options this system already
  supports** for: `themeBodyFont` (curated font keys in `lib/fonts.ts`),
  `themeColors` (the JSON hex override keys), `themeRadius`
  (sharp | rounded | pill), `themeFontSize`, `themeHeadingWeight`
  (500–800). Never invent unsupported values.
- Extract the site logo exactly, convert it to the format the app stores
  (saved via `lib/uploads.ts` → `/api/uploads/<file>`, referenced from
  `PersonaConfig.company_logo`).

### Step 3 — Knowledge extraction (no user review)
- Extraction is model-driven (updated 2026-09-05): each of the four
  categories — blog, testimonials, team, and the general catch-all — runs
  its OWN system prompt (`lib/onboarding/knowledgeLlm.ts`) over the crawled
  pages, so almost everything on the site lands in one of the four. The
  catch-all distills every remaining page into discrete facts, one chunk
  per fact. Prompts never invent; absent stays absent. The deterministic
  parsers remain the fallback when no ANTHROPIC_API_KEY is configured or a
  call fails.
- Shows a progress bar during extraction, then the count of knowledge chunks
  saved. Reuses the existing chunk/embedding pipeline and storage
  (`chunkText`, `embedTexts`, `Source`/`Chunk` rows) — no new embedding
  provider.
- Four extractions run against the entered site:
  - **(a) Blog**: discover via nav/footer links (Blog, News, Articles,
    Insights, Resources), common paths (/blog, /news, /articles, /posts), and
    RSS/Atom feeds (/feed, /rss.xml, /atom.xml). If a feed exists, use it to
    enumerate posts, then fetch each post page. Walk ALL pagination and
    archive pages. One record per post: title, URL, publish date, author,
    full body with nav/comments/widgets stripped. Category and tag pages are
    discovery-only; a post is never saved twice. If no blog exists, that fact
    is recorded and extraction moves on.
  - **(b) Testimonials**: check the homepage, nav/footer links (Testimonials,
    Reviews, Customers, Case Studies, Wall of Love), and common paths
    (/testimonials, /reviews, /customers). One record per testimonial — two
    are never merged: quote text, author name, author title/company, source
    URL, and the URL of any associated image (URL recorded only; image files
    are not downloaded). Only genuine customer testimonials — not press
    mentions, partner logos, or the site's own marketing copy.
  - **(c) Team/about**: check nav/footer links (Team, About, About Us, Our
    People, Leadership) and common paths (/team, /about, /about-us, /people,
    /leadership). One record and one embedding per distinct bio/text block —
    blocks are never concatenated. The person's name stays with their bio;
    navigation and boilerplate are stripped; empty or duplicate blocks are
    skipped. If no team page exists, that fact is recorded and extraction
    moves on.
  - **(d) Sitemap sweep**: substantive pages not covered by (a)–(c) each have
    their main points extracted as separate knowledge chunks.
- Constraints across all of step 3: crawling stays on the entered domain;
  missing fields stay empty rather than fabricated; content appearing on
  multiple pages is deduplicated.

- Revision (2026-08-29b, user-requested): a company can have MULTIPLE
  locations, each its own sub-form (address, phone, per-day hours) populated
  by extraction — one location first, then more (labeled "Location N" blocks
  and bare footer addresses both count; the copy that knows its hours wins a
  duplicate-address merge). A "no in-person location" option covers
  online-only businesses. On save, locations serialize AS TEXT into the
  existing Profile fields (one line per location). The theme review is the
  dashboard's own ThemePicker panel, pre-filled by extraction. The Profile
  tab ends with a "Restart onboarding" button that clears the profile and
  re-enters the flow.

## Scope
- New onboarding page in the admin panel, first-login routing, and a
  persisted per-user onboarded flag.
- Playwright-based crawling/extraction services for steps 1–3.
- Saving into existing tables: `Profile`, `ThemeConfig`,
  `PersonaConfig.company_logo`, `Source`, `Chunk`.
- Manual path reaching the same forms empty.

## Non-Goals
- No new embedding provider or vector store.
- No changes to the public `/a/[slug]` page beyond reflecting saved values.
- No re-run/re-onboarding UI for existing users (they use the normal admin
  tabs).
- No off-domain crawling, image downloading for testimonials, or social
  profile scraping.

## Scenarios
- Happy path: new user signs up, logs into admin, sees onboarding, enters
  their site URL; step 1's form fills with real extracted values, step 2's
  preview shows their logo/colors/fonts, step 3's progress bar completes with
  a chunk count; after saving, every value is in the correct table and the
  next login goes straight to the dashboard.
- Manual path: user picks "Set up manually", fills the same empty forms,
  saves; no extraction runs; user is marked onboarded.
- Site missing data: a site with no phone/hours leaves those fields empty; a
  site with no blog or team page records that and continues without error.
- Field correction: user edits an extracted value (e.g. wrong owner name)
  before saving; the edited value wins.
- Unreachable/invalid URL: a clear error on the entry screen; the user can
  retry or fall back to manual; nothing partial is saved.
- Re-entry: closing the tab mid-onboarding and logging in again shows the
  onboarding flow again (not the dashboard) until it is completed.
- Isolation: everything saved is scoped to the logged-in user's `userId`;
  another tenant's data is untouched.

## Constraints
- Extraction uses Playwright; the dependency must also work in the Railway
  Nixpacks build (headless Chromium install at build time — deploy image size
  and build config are part of the change).
- Steps run server-side with progress surfaced to the client; a long crawl
  must not hit request timeouts (chunked/polled progress, not one blocking
  request).
- Theme values are constrained to the presets/keys the app already supports;
  logo files go through the existing uploads storage.
- Knowledge lands as `Source` rows (type "link", per-user unique URL) with
  chunks built by the existing `lib/retrieval` pipeline (`embedTexts` — Voyage
  when `VOYAGE_API_KEY` is set, local hash fallback otherwise).
- Never fabricate: extraction prompts/parsers must return empty for absent
  data.
- Multi-tenant discipline: all reads/writes threaded with the session user's
  id, matching the existing admin actions.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

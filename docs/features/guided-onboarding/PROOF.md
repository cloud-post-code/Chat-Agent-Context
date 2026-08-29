# Proof Plan

## Definition Of Done
- A fresh user's first admin login lands on the onboarding page; the entry
  screen offers the site-link path and the manual path.
- Entering a site URL fills the step-1 form and step-2 preview with editable
  extracted values; step 3 completes with a visible chunk count.
- A value edited in review wins over the extracted value on save.
- Saving lands every value in the correct tables: `Profile`, `ThemeConfig`,
  `PersonaConfig.company_logo`, and `Source`/`Chunk` rows embedded by the
  existing pipeline.
- Fields the site does not show stay empty (no fabrication); crawling stays
  on the entered domain; duplicated content is deduplicated (one record per
  blog post / testimonial / bio block).
- The manual path reaches the same forms empty and also marks the user
  onboarded; an onboarded user never sees the flow again.
- All of it is tenant-scoped to the logged-in user.

## Primary Proof
Type: e2e

Command:
```bash
PROOF_BASE_URL=http://localhost:3100 npx tsx docs/features/guided-onboarding/proof.ts
```

The script serves the deterministic fixture site in
`docs/features/guided-onboarding/proof/fixtures/site/` on a local port
(company info in the footer, weekday-only hours, no owner name anywhere,
brand color `#0f4c81`, a logo.png, a 3-post blog with pagination + RSS feed +
a discovery-only category page, 3 genuine testimonials + 1 press mention, a
team page with 3 bios one of which is duplicated, a sitemap including a
services page) and drives the running app's onboarding HTTP surface end to
end with a fresh signup. It prints `PROOF PASS` or exits 1.

Expected evidence:
- First-login gating: new user is steered to onboarding; both entry options
  render.
- Step 1: company name, address, phone, email, weekday hours match the
  fixture exactly; Saturday/Sunday and owner name are EMPTY because the site
  never states them (anti-fabrication).
- Step 2: `themeBodyFont` is a curated `lib/fonts` key, `themeRadius` ∈
  sharp|rounded|pill, `themeHeadingWeight` ∈ 500–800, colors are hex and
  include the fixture's brand `#0f4c81`, logo lands under `/api/uploads/`.
- Step 3 report: blog existed, 3 posts saved = 3 unique URLs = 3 feed items
  (feed reconciliation), pagination page2 walked, category page saved
  nothing extra; exactly 3 distinct testimonials (press mention excluded,
  quotes never merged, Marta's image recorded as a URL); team existed with 3
  blocks (duplicate bio skipped) and a reported embedding dimension > 0;
  sitemap sweep captured the services page.
- Persistence: `Profile` holds the extracted values with the review-edited
  `owner_name` winning; `ThemeConfig` and `PersonaConfig.company_logo` hold
  the theme; `Chunk` count in the DB equals the reported count and every
  chunk has an embedding; zero `Source` rows off the entered domain.
- Re-entry: the onboarded user reaches the dashboard and the flow is gone.
- Manual path: second user sees the same forms empty, completes manually,
  and lands on the dashboard.

Secondary guards:
- `npx tsc --noEmit` and `npm run lint` clean; `npm run build` succeeds
  (Playwright dependency must not break the Nixpacks/Railway build).
- Existing feature proofs still green (at minimum
  `scripts/proof-multi-tenant.ts`).

## Environment And Data
- Running dev server at `PROOF_BASE_URL` (default `http://localhost:3100`)
  with `DATABASE_URL` pointing at the dev database; the script talks to the
  same DB via Prisma for persistence assertions.
- Playwright browsers installed (`npx playwright install chromium`).
- No external credentials required: the fixture site is served locally by
  the proof script on `PROOF_FIXTURE_PORT` (default 4173), and embeddings
  fall back to the local hash embedder when `VOYAGE_API_KEY` is unset.
- The extraction may use the app's LLM for parsing; when `ANTHROPIC_API_KEY`
  is unavailable the proof run may use the repo's mock-anthropic pattern from
  the multi-tenant proof, PROVIDED the mock does not special-case fixture
  values (see anti-gaming).

## Anti-Gaming Constraints
- No mocking of the crawl: the extraction must fetch the fixture site over
  real HTTP with the real Playwright/crawler path. Hardcoding fixture values
  ("Acme Rivet Co.", `#0f4c81`, post URLs) anywhere in `app/` or `lib/` is
  gaming — the empty-field assertions (owner name, weekend hours) exist
  precisely to catch a parser that pattern-matches the proof.
- The chunk/embedding path must be the existing `lib/retrieval` pipeline;
  asserting `embedModel` consistency and DB-side chunk counts, not the
  job's self-reported numbers alone.
- Do not weaken FEATURE.md scope (e.g. dropping pagination walking or feed
  reconciliation) to make the proof pass.
- The onboarded flag must be persisted server-side (survives a new cookie
  jar), not stored client-side.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- One run against a REAL external site (per the feature's verification ask):
  automated proof uses the deterministic fixture site because real sites
  change and rate-limit; the implementation summary must additionally report
  a manual end-to-end run against one real site with per-extraction pages
  checked, counts, pagination walked, and feed reconciliation.
- Visual check that the step-2 preview "resembles the user's actual public
  page" is a human judgment; the proof only asserts the extracted values and
  their persistence.

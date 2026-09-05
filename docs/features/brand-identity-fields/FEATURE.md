# Brand identity fields: tagline, brand values, tone of voice

## Summary
Extend onboarding extraction with three brand-identity fields — tagline (with
an extracted-vs-suggested flag), brand values, and tone of voice — and surface
them in both places brand look-and-feel is reviewed: the onboarding theme step
and the dashboard Theme tab. This delivers the brand-identity slice of the
pending `business-dna-onboarding` feature early, inside the CURRENT staged
onboarding flow, without the single-run job rework.

## Desired Behavior
- The onboarding theme stage additionally extracts, from the already-crawled
  pages, grounded only in the site's own text (never invented; absent stays
  empty):
  - **Tagline** — when the site literally states a tagline, it is copied
    verbatim and flagged `taglineSource: "extracted"`. Otherwise ONE tagline
    is generated from the site's own copy and flagged
    `taglineSource: "suggested"` — the UI must visibly label suggested
    taglines and never present a generated tagline as extracted.
  - **Brand values** — 3–5 short phrases drawn from about/mission/story copy;
    fewer when the text supports fewer, empty when it supports none.
  - **Tone of voice** — a 1–3 sentence description of the site's writing
    style, written so it can be pasted into a chatbot system prompt as a
    style instruction.
- The onboarding theme review card shows all three fields (tagline input with
  a "suggested" chip when flagged, values, tone) above the existing
  ThemePicker; the user can edit each before saving. Saving the theme step
  persists them.
- The dashboard Theme tab gains a "Brand voice" section with the same three
  editable fields, saved by the existing Save theme button. A suggested
  tagline shows its "suggested" label there too until edited.
- The chatbot system prompt includes brand values and tone of voice when set
  (tagline is already included), so the extracted voice steers answers.
- A brand-extraction failure does not fail the theme stage: the theme review
  still appears, with the brand fields empty.

## Scope
- New `lib/onboarding/brand.ts`: `BRAND_SYSTEM_PROMPT` +
  `extractBrandIdentity(pages, log)` via the existing `llmExtract` path, with
  an injectable extract function (repo pattern) so proofs stay offline.
- New `lib/brand.ts`: `savePersonaBrand(userId, brand)` shared by the
  onboarding save route and the dashboard `saveTheme` action.
- `lib/onboarding/jobs.ts`: theme stage also runs brand extraction into
  `job.stepBrand` (fail-soft), with real log lines.
- `app/admin/onboarding/OnboardingFlow.tsx`: brand fields on the theme review
  card; included in the theme save POST.
- `app/api/admin/onboarding/save/route.ts`: accepts a `brand` key.
- `app/admin/dashboard/page.tsx` + `saveTheme` in `app/admin/actions.ts`:
  Brand voice section on the Theme tab.
- `prisma/schema.prisma`: `PersonaConfig` gains `taglineSource` (`""` |
  `"extracted"` | `"suggested"`), `brandValues` (JSON string array),
  `toneOfVoice` (text). Tagline keeps using the existing
  `PersonaConfig.tagline`. Ships as a Prisma migration.
- `lib/knowledge.ts`: brand values + tone injected into the system prompt.

## Non-Goals
- No single-run job rework, progress-screen redesign, or DNA review screen
  (that stays in `business-dna-onboarding`).
- No business-summary field (same).
- No change to crawling, theme matching, or knowledge pipelines.
- No public-page rendering changes beyond what saved values already drive.

## Constraints
- Model-only extraction (no parser fallback), same as
  `llm-only-onboarding-extraction`.
- Never fabricate; a model response with a tagline but an invalid source flag
  is coerced to `"suggested"` (never to `"extracted"`); an empty tagline
  forces the source flag empty.
- The Persona tab's existing tagline input stays; both surfaces write the
  same `PersonaConfig.tagline`.
- Schema change ships as a Prisma migration compatible with the Railway
  deploy (`scripts/migrate.mjs`).

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

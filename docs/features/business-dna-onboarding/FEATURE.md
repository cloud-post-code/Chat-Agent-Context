# Business DNA onboarding (Pomelli-style single-run extraction)

## Summary
Convert the staged, chat-gated onboarding into a Pomelli-style flow: the user
enters one website URL, a single autonomous server-side job extracts a complete
"Business DNA" brand profile (business summary, tagline, brand values, tone of
voice, colors, fonts, imagery — plus the contact/locations/knowledge extraction
the system already performs), an animated progress screen runs while it works,
and the user reviews and edits everything on ONE result screen before saving.

Reference behavior observed on Google Labs Pomelli (labs.google.com/pomelli):
one URL input, async "Generating your Business DNA" screen with rotating stage
messages ("Gathering colors", "Learning your tone of voice", "Studying your
brand values", "Summarizing your business", "Pulling images from your website",
"Writing your tagline", "Picking brand fonts"), resumable job ("feel free to
come back later"), editable DNA result grounding all later generation.

## Desired Behavior
- The onboarding entry screen asks only for a website URL (manual path remains
  as a secondary link). Submitting starts ONE job that runs every extraction
  stage back-to-back with no user gating between stages.
- While the job runs, the user sees a "Generating your Business DNA" progress
  screen: rotating stage messages driven by the job's real activity log, and
  copy telling them they can leave. Navigating away and returning to
  /admin/onboarding reattaches to the same running job (per-user), never
  starting a duplicate.
- The pipeline keeps today's stages (core contact info, locations, gallery
  images, theme colors/fonts/radius/logo, four knowledge extractions) and adds
  four model-extracted brand-identity fields, grounded only in crawled page
  text (never invented; absent stays absent):
  - **Business summary** — 2–4 sentences: what the business does, for whom.
  - **Tagline** — one line; prefer a tagline the site itself states, otherwise
    generate one grounded in the site's own copy and mark it as suggested.
  - **Brand values** — 3–5 short value phrases from about/mission/key copy.
  - **Tone of voice** — a short description of the site's writing voice
    (tone, formality, vocabulary) usable as a style instruction.
- When the job completes, one "Business DNA" review screen shows every result
  grouped by component (identity, contact/locations, look, imagery, knowledge
  counts). Every field is editable in place; the imagery section keeps the
  existing 3-up pager with caption edit/remove. One Save button persists
  everything and marks the user onboarded.
- Failure of the whole crawl (site unreachable) shows a clear error with a
  "Try again" that returns to the URL screen; nothing is saved. Failure of an
  individual stage does not kill the job — the review screen shows that
  section empty/with a notice, and everything else is still reviewable.

## Scope
- Rework `app/admin/onboarding/` UI: URL entry, progress screen, single DNA
  review screen (replacing the stage-by-stage chat advance).
- Rework `lib/onboarding/jobs.ts`: one `startJob` runs all stages
  automatically; per-user job lookup for reattach; per-stage error isolation.
- New brand-identity extraction module producing summary/tagline/values/tone
  from already-crawled pages.
- Persistence: tagline → existing `PersonaConfig.tagline`; summary, values,
  and tone stored on the user's profile/persona storage (new columns or JSON —
  owning implementation decides) and injected into the chatbot system prompt
  the same way persona/profile text already is.
- Existing saves unchanged in destination: `Profile`, locations text fields,
  `Photo` rows, `ThemeConfig`, `PersonaConfig.company_logo`, `Source`/`Chunk`.

## Non-Goals
- No campaign/content generation on top of the DNA (Pomelli's second half).
- No change to the crawler, theme matching, image storage, or knowledge
  chunk/embedding pipelines beyond how they are orchestrated.
- No cross-process job persistence (jobs stay in-memory; a server restart
  mid-run means re-running, same as today).
- No realtime push channel; the existing polling wire stays.
- No change to the public `/a/[slug]` page beyond reflecting saved values.

## Scenarios
- Happy path: user enters URL → progress screen cycles through real stage
  messages → DNA review shows summary, tagline, values, tone, contact info,
  locations, theme, photos, knowledge counts → user edits the tagline and
  removes one photo → Save persists everything, marks onboarded, next login
  goes to the dashboard.
- Come back later: user closes the tab mid-run; logging in again shows the
  progress screen attached to the same job; when it finishes, the review
  appears with full results.
- Sparse site: a one-page site with no about page yields empty values/tone
  notice sections and empty contact fields — nothing fabricated; Save still
  works.
- Stage failure: image extraction throws; the job continues; review shows the
  imagery section with a "couldn't pull photos" notice and everything else
  intact.
- Unreachable URL: error + Try again on the entry screen; no partial saves;
  manual path still available.
- Duplicate start: submitting the URL twice (double-click, second tab) never
  yields two concurrent jobs for the same user.
- Isolation: all reads/writes scoped to the session user's id.

## Constraints
- Model extraction requires `ANTHROPIC_API_KEY` (same as today's LLM-only
  extraction); the new identity fields are model-only with no parser fallback,
  matching the llm-only-onboarding-extraction decision.
- Never fabricate: prompts must return empty for absent data; a generated
  tagline must be flagged as suggested rather than presented as extracted.
- The full run must stay within the existing polled-progress architecture (no
  single blocking request); progress messages come from the job's real log.
- Theme values remain constrained to supported keys (`lib/fonts.ts`, radius
  presets); logos/photos keep going through `lib/uploads.ts`.
- Any schema change ships as a Prisma migration compatible with the Railway
  deploy.
- The reworked job module must be importable outside the Next runtime (lazy
  load or isolate the `next/font`-dependent theme matching, as
  `lib/onboarding/themeCorpus.ts` already does) so the proof can drive it
  directly.
- Multi-tenant discipline unchanged.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

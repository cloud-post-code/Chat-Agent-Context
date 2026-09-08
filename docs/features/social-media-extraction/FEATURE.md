# Feature — Social Media As Its Own Onboarding Extraction Step

Give social media profiles their own extraction stage in guided onboarding,
exactly like locations and images have: their own job phase, their own
discovery + LLM prompt, their own review card in the chat flow, and their own
persistence into the profile.

## Behavior

- **New job stage** (`lib/onboarding/jobs.ts`): phases `social` /
  `social-done`, result `stepSocial: { links: SocialLink[] }`. The stage runs
  between the locations review and the images stage:
  `core → locations → social → images → theme → knowledge`. Advance gating
  stays permissive like the sibling stages (social accepted from
  `locations-done` or `core-done`; images/theme/knowledge also accept
  `social-done`).
- **Extractor** (`lib/onboarding/social.ts`): LLM-only, following the
  sibling-extractor shape (system prompt, injectable `extract` seam defaulting
  to `llmExtract`, sanitizer). Social profile links live in anchor `href`s
  (often icon-only anchors), so the model's input is a candidate list built
  from the already-crawled pages' offsite anchors — one line per link:
  `url | text | aria-label` (attribute reads are data access, like
  `images.ts`; interpretation stays with the model). The sanitizer only
  accepts URLs copied exactly from the candidate list (the logo-pick rule —
  no hallucinated URLs), lowercases platform names, dedupes, and caps.
  No offsite links at all → empty result without a model call.
- **Persistence**: new `Profile.social_links` column (JSON
  `[{platform, url}]`, default `"[]"`) with helpers in `lib/socialLinks.ts`
  (`parseSocialLinks`, `sanitizeSocialLinks`, `saveSocialLinks`). The
  onboarding save route accepts a `social` body section; the user's reviewed
  rows win, as with every other stage.
- **Chat flow** (`OnboardingFlow.tsx`): new steps `social-running` /
  `review-social`. The review card lists each found profile as an editable
  platform + link row with add/remove, then advances to images. The manual
  path gets the same card between locations and theme.
- **Agent integration**: social links appear in the chatbot system prompt's
  "HOW TO CONNECT" block (`lib/knowledge.ts`) and in the indexed profile
  prose (`lib/retrieval/origins.ts indexProfile`).
- **Admin**: the Profile tab gains a "Social media" textarea (one
  `platform: url` per line) so the saved links stay editable after
  onboarding; the account wipe resets the column.

## Constraints

- LLM-only extraction (see `llm-only-onboarding-extraction`): no regex/
  heuristic extraction of which links are social profiles; candidate
  collection and sanitizers are discovery/validation, not extraction.
- Never invent: a URL not literally present in the crawled pages is dropped.
- No new dependencies. Existing stage shapes (CoreInfo, Location, job
  payload fields) unchanged.

## Implementation Routing

Backend TypeScript library + Next route + the onboarding React flow; no new
stack skills beyond repo conventions.

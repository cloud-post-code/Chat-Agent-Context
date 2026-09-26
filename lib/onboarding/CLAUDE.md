# lib/onboarding — reading a business's site into its account

`jobs.ts` runs the stages for one account (`core`, `locations`, `social`, `images`,
`theme`, then `knowledge`, whose extractors run in parallel); each stage extracts with
the model and writes through `save.ts`. The bulk builder
(`lib/bulkBuild.ts`) drives the same runner unattended for many sites.

## Modules
| Stage / concern | Module |
|---|---|
| crawl (Playwright, one origin, shared page limiter) | `crawl.ts` (logs why a page rendered blank, for the activity log); `netGuard.ts` keeps fetches on the public internet |
| core contact details, theme extraction | `extract.ts` (+ `themeCorpus.ts` for the theme prompt's input, `hours.ts`) |
| locations / social / owners / goals / brand voice / gallery | `locations.ts`, `social.ts`, `owners.ts`, `goals.ts`, `brand.ts`, `images.ts` |
| blog, testimonials, team, sitemap sweep | `knowledge.ts` |
| the LLM extraction helper every stage uses (`llmExtract`, `llmExtractVision`) | `knowledgeLlm.ts` |
| first-run A2UI card set | `cards.ts` (`lib/siteCards.ts` is the later gap-fill over the same placement path) |
| graph indexing of what was read | `graphIndex.ts` |
| concurrency | `pool.ts` (`onboardingConcurrency`); the model gate with 429/529 backoff is `lib/claude/retry.ts` (`modelCall`) |
| the only writer | `save.ts` |

## Invariants
- A stage never invents: every fact written is quoted from the pages read; empty
  means "not found", never a default.
- `ONBOARDING_CONCURRENCY` bounds agents, page renders and model calls together.
- Model calls take an injectable client so the proofs double them.
- Adding a stage: an extractor module, a `run<Stage>` in `jobs.ts`, its save in
  `save.ts`, the activity-stream line, and a proof under `docs/features/`.

## Testing
Proofs: `guided-onboarding` (needs a running server), `parallel-onboarding-extraction`,
and the `owner-` / `llm-only-` extraction proofs (model). Pure parts (theme normalization) are in `npm test`.

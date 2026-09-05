# Feature — LLM-Only Onboarding Extraction

Remove all fallback parsing and hard-coded extraction from the onboarding
extraction pipeline. Content is fetched with Playwright and all extraction is
performed by the Claude LLM — no regex, CSS-selector, or heuristic extraction
paths anywhere.

## Behavior

- **Fetching**: `Crawler.load()` renders pages with Playwright only. The plain
  `fetch` fallback for HTML pages is removed; when Playwright cannot launch the
  crawler throws a clear error instead of silently degrading. `loadText` /
  `loadBytes` remain fetch-based — they retrieve non-HTML resources (sitemap
  XML, robots.txt, feeds, image bytes) that a browser render cannot improve.
- **Core info** (`extract.ts`): company name / phone / email come from a
  dedicated Claude extraction prompt over the crawled pages. The og:site_name /
  title-split / regex path is deleted.
- **Theme** (`extract.ts`): colors, font, radius, sizes, and the logo pick come
  from a dedicated Claude prompt over the site's inline CSS and image
  candidates. The CSS-regex path is deleted. Results still normalize through
  `normalizeExtractedTheme` and the curated font keys (output validation, not
  extraction).
- **Owners** (`owners.ts`): LLM prompt only. `parsePageOwners` and its
  NAME/TITLE regexes are deleted.
- **Locations** (`locations.ts`): LLM prompt only. The `parseHours` /
  `parsePageLocations` / ADDRESS_RE / PHONE_RE deterministic parser in
  `extract.ts` is deleted.
- **Knowledge** (`knowledge.ts`): blog post cleaning, testimonials, team bios,
  and the sitemap sweep use their LLM prompts only. Selector-based content
  fallbacks (article h1 / blockquote / cite / .team-member / raw chunkText) are
  deleted. Pages the model reports as empty are skipped, not raw-chunked.
- **Failure policy**: a Claude call retries up to 2 extra times, then throws.
  A missing `ANTHROPIC_API_KEY` fails the job immediately at start with a clear
  message. Never fall back to parsing; never silently return empty.

## Explicitly kept (not extraction)

- Page **discovery** heuristics (nav-link matching, common paths, sitemap/feed
  URL discovery, blog-post URL shapes) — crawl targeting is unchanged.
- **Sanitizers** for model JSON output (`sanitize*`), dedup/merge helpers
  (`mergeLocation`, `mergeOwners`), `serializeHours`, and theme normalization —
  these validate/normalize model output, they don't extract from pages.
- `images.ts` attribute reads (figcaption/alt/title captions) — direct data
  access for photo import, not text parsing; unchanged.
- Testimonial widget detection (`embeddedWidget`) — presence signal for honest
  reporting, not content extraction.

## Constraints

- Crawl targets, Prisma schema, and the shape of extracted data consumed
  downstream (CoreInfo, Location, ThemeExtract, KnowledgeReport, job payload)
  are unchanged.
- No new dependencies.

## Implementation Routing

Required skills: none beyond repo conventions (backend TypeScript library code;
no UI change).

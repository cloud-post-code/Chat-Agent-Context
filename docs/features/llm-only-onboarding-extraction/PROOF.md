# Proof — LLM-Only Onboarding Extraction

## Primary proof
```
npx tsx docs/features/llm-only-onboarding-extraction/proof.ts
```
No server, DB, network, or model key required — the proof runs with
`ANTHROPIC_API_KEY` unset and asserts the LLM-only contract directly against
the modules and their source.

## What it proves
- **Deterministic parsers are gone**: `lib/onboarding/extract.ts` no longer
  exports `parseHours` or `parsePageLocations` and contains no ADDRESS_RE /
  PHONE_RE regex extraction; `lib/onboarding/owners.ts` no longer exports
  `parsePageOwners`.
- **No selector-based content fallbacks**: `lib/onboarding/knowledge.ts` source
  contains no blockquote/cite/testimonial-card/team-member selector extraction
  and no raw `chunkText(body)` sweep fallback.
- **Playwright-only page loads**: the `Crawler.load()` body in
  `lib/onboarding/crawl.ts` contains no `fetch(` fallback for HTML pages.
- **Failure policy — throw, never null/empty**:
  - `llmExtract` with `ANTHROPIC_API_KEY` unset rejects with an error naming
    the key; it never resolves to null.
  - `extractOwners` and `extractLocations` with the key unset reject instead of
    resolving to a parsed/empty result.
- **Retry bound**: `llmExtract` source declares 2 retries before throwing.

## Secondary guards (not proof)
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- Repo safety gate: `$HOME/.claude/scripts/gate`

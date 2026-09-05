# Owner Extraction — LLM prompt across About/Team pages, multi-owner

## Problem
Onboarding rarely finds the owner's name. Today it is a single regex in
`lib/onboarding/extract.ts` that only matches a literal `Owner:`/`Proprietor:` label, and
it only reads the homepage plus up to 4 about/contact/team nav links. Real sites put the
owner in prose or bio headings on About, Team, Our Story, Staff, or "Meet the Owner"
pages — and a business can have several owners.

## Desired behavior
- A dedicated owner-extraction module `lib/onboarding/owners.ts`, following the
  locations-stage pattern (`lib/onboarding/locations.ts`):
  - **Discovery**: its own page discovery — nav links whose text matches
    about/team/our story/staff/meet/founder/story/contact, plus common paths
    (`/about`, `/about-us`, `/team`, `/our-team`, `/our-story`, `/staff`,
    `/meet-the-team`, `/founders`, `/contact`), bounded, deduped, on-domain only.
  - **LLM extraction**: when `ANTHROPIC_API_KEY` is set, one call with the
    owner-extraction system prompt (agreed wording, stored as
    `OWNERS_SYSTEM_PROMPT`) over a `=== <url>`-prefixed multi-page corpus.
    Output contract: `{"owners":[{"name":"","role":""}]}` — only names literally in
    the text, never guessed; empty list when none.
  - **Multiple owners**: every distinct person identified as owner/co-owner/founder/
    co-founder/proprietor/principal is kept; the same person on several pages is one
    entry (case-insensitive name dedupe).
  - **Deterministic fallback**: without a key (or on model error) a pattern parser runs
    instead, extending the existing label regex with explicit prose forms
    ("owned (and operated) by X", "founded by X", "X, Owner" bio headings). Never
    invents; absent stays empty.
- `runCore` (`lib/onboarding/jobs.ts`) uses the module after `extractCoreInfo`: when it
  finds owners, `step1.owner_name` becomes the distinct names joined with ", "
  (multi-owner supported in the single profile field); when it finds none, whatever the
  existing core regex found stands. Log lines report the outcome.

## Not in scope
- No schema change: `CoreInfo.owner_name` stays a single string.
- No change to the locations/images/theme/knowledge stages.
- No UI change.

## Implementation Routing
- Backend TypeScript only (Next.js lib code); no domain skill starter needed —
  follow the existing `lib/onboarding/` module conventions.

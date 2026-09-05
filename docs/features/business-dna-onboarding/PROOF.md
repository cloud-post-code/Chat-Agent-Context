# Proof Plan — Business DNA onboarding

## Definition Of Done
- One `startJob(userId, url)` call runs the entire pipeline (core → locations
  → images → theme → knowledge → brand identity) to phase `done` with no
  `advanceJob` gating.
- The job payload carries a `dna` object: `summary` (2+ sentences naming the
  business), `tagline` + `taglineSource` (`"extracted"` or `"suggested"`),
  `values` (3–5 strings grounded in site copy), `tone` (style description).
- Per-user reattach works (`getActiveJobForUser(userId)` returns the running
  or finished job) and a second start never creates a parallel job.
- Nothing is fabricated: fields absent from the site stay empty; a site with
  no photos completes with an empty imagery section rather than failing.
- The review screen saves into the existing tables and marks the user
  onboarded (manual gap below until browser E2E exists).

## Primary Proof
Type: integration (real Playwright crawl + real model calls against a local
fixture site; black-box through the job module's public API)

Command:
```bash
npx tsx docs/features/business-dna-onboarding/proof.ts
```

Expected evidence:
- `phase` reaches `done` from `startJob` alone within 5 minutes.
- `dna.summary` mentions "Harbor" and has ≥2 sentences; `dna.values` has 3–5
  entries with at least one echoing the fixture's about-page values;
  `dna.tagline` is flagged extracted or suggested; `dna.tone` is non-trivial.
- `company_phone_number` empty (fixture has none); `company_email` extracted
  verbatim; `themeColors.primary` found from fixture CSS; imagery empty.
- Reattach returns the same job id; duplicate start suppressed.

Secondary guards:
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- `npx tsx docs/features/llm-only-onboarding-extraction/proof.ts` (model-only
  contract must survive the rework)
- `npx tsx docs/features/guided-onboarding/proof.ts` if still applicable, or
  its retirement noted when the staged flow is removed.

## Environment And Data
- `ANTHROPIC_API_KEY` set (model-only extraction; proof exits BLOCKED without it).
- `DATABASE_URL` reachable (knowledge stage persists `Source`/`Chunk`); the
  proof uses a throwaway `proof-dna-<uuid>` userId and deletes its rows after.
- Playwright Chromium installed (already a repo dependency).
- Fixture site: `docs/features/business-dna-onboarding/proof/fixtures/site/`
  (served by the proof itself on 127.0.0.1; no external network needed beyond
  the Anthropic API).
- Contract: `lib/onboarding/jobs.ts` must be importable under plain `tsx`
  (today it pulls `next/font` via `extract.ts` → `lib/fonts`, which only loads
  inside Next — the rework must lazy-load or isolate that dependency, as
  `themeCorpus.ts` already does). Until then the proof errors at import,
  which is the expected red state alongside the missing `dna` field and the
  advance-gated pipeline.

## Anti-Gaming Constraints
- No mocking of the crawler, the model client, or the job orchestrator; the
  proof drives `lib/onboarding/jobs.ts` public exports only.
- Do not special-case the fixture domain in product code.
- Do not weaken FEATURE.md (e.g. dropping the taglineSource flag or the
  duplicate-start rule) to make checks pass.
- The rotating progress messages must come from the job's real `log`; do not
  satisfy the progress requirement with a purely cosmetic client-side loop.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Review-screen UX (single DNA screen, in-place edits, one Save writing
  `Profile`/`ThemeConfig`/`PersonaConfig`/`Photo` and setting `onboardedAt`)
  needs an authenticated browser session; verify by logging into
  `/admin/onboarding` after implementation. Automate later if a repo browser
  E2E harness lands.
- Come-back-later reattach across a real page reload is exercised at the
  module level here; the browser-level reattach is part of the same manual
  click-through.

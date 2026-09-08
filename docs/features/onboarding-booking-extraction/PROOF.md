# Proof Plan — Onboarding extracts services and booking requirements

## Definition Of Done
- `lib/onboarding/services.ts` exists following the sibling-extractor shape:
  a system prompt, a sanitizer, page discovery for the knowledge stage, and
  `extractServicesAndBooking(pages, userId, onEvent, deps?)` where `deps.llm`
  is the injectable model seam (defaulting to the real `llmExtract`).
- A successful extraction persists services as real knowledge (a Source row
  with replaced Chunk rows, the sibling `saveRecord` idiom) and seeds the
  appointment-question catalog — default name and email questions first, then
  each extracted requirement as a typed `AppointmentField` row — only when
  the tenant has zero appointment questions.
- `Profile.bookingEnabled` is never written by extraction; enabling later
  keeps the seeded catalog (no default re-seed over it).
- An existing catalog is never modified; re-running refreshes the services
  knowledge in place without duplicating chunks or fields.
- An extraction reporting nothing persists nothing.
- The sanitizer enforces caps and the appointment field-type whitelist
  (unknown types degrade to short_text) and never throws on junk shapes.
- The extractor is selectable in the onboarding knowledge stage (jobs.ts
  extractor list, phase, log lines, report entry) and the onboarding UI's
  category list.

## Primary Proof
Type: integration (repo-native proof script over the real DB; fixture Pages
built with cheerio; the model doubled only at the injectable `llm` seam)

Command:
```bash
npx tsx docs/features/onboarding-booking-extraction/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: throwaway users, a services
  Source row with its Chunk rows, and seeded `AppointmentField` rows.
- Red run recorded before implementation: the script fails to import
  `lib/onboarding/services.ts`.

Secondary guards:
- `npx tsc --noEmit` clean.
- jobs.ts wiring and UI listing are exercised by type-checking and reviewed,
  not asserted by the script (they are thin dispatch).

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: fixture `Page` objects are built from inline HTML with cheerio;
  the `llm` dependency is a scripted double returning canned extraction JSON.
- All rows live under throwaway users (`proof-onboarding-booking*@example.invalid`)
  deleted in a `finally`.

## Anti-Gaming Constraints
- Only the `llm` seam may be doubled; sanitizing, persistence, knowledge
  writes, and field seeding must be the real code paths.
- Assertions read DB rows and returned reports, never model-authored text.
- The existing-catalog and re-run checks may not be satisfied by the proof
  pre-deleting rows; they assert row identity/count across runs.
- Do not weaken FEATURE.md (e.g. allowing seeding into a non-empty catalog)
  to make the proof pass.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Live-model extraction quality and real page discovery (`discoverServicePages`
  needs a crawling browser); the discovery heuristic is review-checked and the
  stage is exercised end-to-end only when onboarding a real site with
  `ANTHROPIC_API_KEY` set.
- The onboarding UI showing the new category — visual check.

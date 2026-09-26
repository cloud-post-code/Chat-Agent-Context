# Proof Plan — Onboarding derives the agent's goals

> **2026-09-26 — booking removed.** Booking, Service, the menu and the cart no longer exist in the product (commit `b4d06cf` on main is the last state with them). The checks below that seeded or asserted bookings, services, menu items or orders were removed from `proof.ts`; the rest stand as written.

## Definition Of Done
- `lib/onboarding/goals.ts` exists in the sibling-extractor shape: a system
  prompt (`GOALS_SYSTEM_PROMPT`), a sanitizer (`sanitizeGoals`), and
  `deriveGoals(pages, userId, signals, onEvent, deps?)` where `deps.llm` is
  the single injectable model seam, defaulting to the real `llmExtract`.
- A successful derivation writes each goal as an `AgentDirective` row with
  `kind: "goal"`, `enabled: true`, and ascending `order`, through the existing
  `saveDirective` path.
- Seeding happens **only** when the tenant has zero goals. A tenant with any
  existing goal row keeps it untouched, and nothing new is written.
- The sanitizer caps at 5 goals and 200 characters each, trims, drops blanks,
  de-duplicates case-insensitively, and returns an empty list (never throws)
  on junk shapes.
- Derived goals reach the system prompt with no further action:
  `buildSystemPrompt()` renders them under the existing `GOALS` heading.
- `jobs.ts` runs the stage at the end of the knowledge stage, best-effort:
  a throwing goals call leaves `phase: "done"` and the saved chunk count
  intact, and reports into `job.goals`.

## Primary Proof
Type: integration (repo-native proof script over the real DB; fixture Pages
built with cheerio; the model doubled only at the injectable `llm` seam)

Command:
```bash
npx tsx docs/features/onboarding-goal-extraction/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: throwaway users and their
  `AgentDirective` goal rows.
- Red run recorded before implementation: the script fails to import
  `lib/onboarding/goals.ts`.

Secondary guards (not proof):
- `npx tsc --noEmit` clean.
- `npx next lint` clean on touched files.
- `$HOME/.claude/scripts/gate` PASS.

## Assertions (all must pass)
1. **Sanitizer — shape** — junk inputs (`null`, a string, `{goals: 7}`,
   `{goals: [null, 3, {}]}`) each return `[]` without throwing.
2. **Sanitizer — caps** — 9 goals in, 5 out; a 400-char goal is cut to 200;
   blank and whitespace-only entries are dropped; entries are trimmed.
3. **Sanitizer — dedup** — `"Book a call"` and `"  BOOK A CALL "` collapse to
   one entry, keeping the first.
4. **Round-trip into storage** — `deriveGoals` on an empty tenant writes one
   `AgentDirective` row per sanitized goal, each `kind:"goal"`,
   `enabled:true`, text verbatim, `order` ascending in the model's order.
5. **Empty extraction persists nothing** — a double returning
   `{"goals":[]}` writes zero rows and reports `written: 0`.
6. **Existing goals are never touched** — with one owner-authored goal row
   present, `deriveGoals` writes nothing, the owner's row is byte-identical
   afterwards (same id, text, enabled), and the report says the catalog was
   kept.
7. **Re-run is idempotent** — running `deriveGoals` twice on a tenant leaves
   exactly the first run's rows (the second run sees a non-empty catalog).
8. **Tenant isolation** — goals written for user A appear in no query for
   user B; a second throwaway tenant derived in the same script keeps its own
   rows only.
9. **Signals reach the prompt corpus** — the user text handed to the `llm`
   seam contains the page URLs and states the booking/knowledge signals it was
   given, so the model's grounding is real and not implied.
10. **Prompt integration** — after derivation, `buildSystemPrompt(userId)`
    contains a `GOALS` heading and each derived goal verbatim as a bullet.
11. **Best-effort in the job** — an `llm` seam that throws leaves
    `deriveGoals` reporting a failure without throwing out of the stage
    (asserted at the function boundary: no exception escapes, zero rows
    written).
12. **Cleanup** — every `AgentDirective` row and throwaway user the proof
    created is gone at exit.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs;
  the script loads `.env` itself.
- No network: fixture `Page` objects are built from inline HTML with cheerio;
  the `llm` dependency is a scripted double returning canned JSON.
- All rows live under throwaway users
  (`proof-onboarding-goals*@example.invalid`) deleted in a `finally`.

## Anti-Gaming Constraints
- Only the `llm` seam may be doubled. Sanitizing, `saveDirective`, the
  zero-goals gate, and `buildSystemPrompt` must be the real code paths.
- Assertions read DB rows and returned reports, never model-authored text.
- The "existing goals untouched" and re-run checks may not be satisfied by
  pre-deleting rows; they assert row identity and count across runs.
- Do not weaken FEATURE.md (e.g. allowing seeding into a non-empty catalog,
  or raising the cap) to make the proof pass.
- The prompt-integration assertion must call the real `buildSystemPrompt`,
  not re-implement `goalsPromptSection`.

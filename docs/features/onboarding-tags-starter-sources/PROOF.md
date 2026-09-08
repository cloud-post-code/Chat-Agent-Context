# Proof — Onboarding tags its rows with starter source keys

## Primary proof command

```
npx tsx docs/features/onboarding-tags-starter-sources/proof.ts
```

Runs against the local dev Postgres via `.env` (loaded by the script, never
overriding already-set values). One throwaway user, deleted in a `finally`.
No live model calls and no network: the services extractor is LLM-injectable
so it runs for real with a stubbed `llm`; the other four writes go through the
real `saveKnowledgeRecord` and are read back through `listIngestedItems` — the
same function the Content panels call.

## Assertions (all must pass)

1. **Every extractor in `ONBOARDING_SOURCE_KEYS` maps to a key that actually
   exists** in `STARTER_INGESTION_SOURCES`, and all five extractors are
   covered.
2. **`onboardingIngestKind` produces the `ingest:<key>` mark the panels
   query** — including the two non-identity mappings, `team → about-team` and
   `sweep → services`.
3. **Every write site uses the mapping**, not a bare literal: all four sites in
   `knowledge.ts` and the one in `services.ts` call `onboardingIngestKind`, and
   no untagged `kind: "<literal>"` remains anywhere in `knowledge.ts`.
4. **The real services extractor's rows appear in the Services tab** — run
   end-to-end with a stubbed model, read back through `listIngestedItems`.
5. **Each extractor's output shows in its own tab**: blog → `blog`,
   testimonials → `testimonials`, team → `about-team`, sweep → `services`.
6. **The Services tab holds both** the services catalog and the swept facts.
7. **Onboarding rows no longer land in the built-in Links tab** — zero stray
   rows there, confirming the move is complete rather than duplicated.
8. **A re-onboard re-tags in place**: a row pre-existing with `kind:
   "article"`, upserted again at the same url, moves into the Blog tab and
   leaves exactly one row at that url — no duplicate, no stale mark.

## Red / green

- **Red** (mapping and tagging reverted, `git stash`): the proof throws at
  assertion 1 — `ONBOARDING_SOURCE_KEYS` does not exist. Exits non-zero.
- **Green** (as implemented): 17/17 checks PASS, `PROOF PASS`, exit 0.

## Secondary checks (not proof)

- `npx tsc --noEmit`
- `$HOME/.claude/scripts/gate`

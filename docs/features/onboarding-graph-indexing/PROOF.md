# Proof — Onboarding indexes into the knowledge graph

## Primary proof command
```
npx tsx docs/features/onboarding-graph-indexing/proof.ts
```
Runs against the local dev Postgres (`.env` `DATABASE_URL`; the script loads
`.env` itself). Seeds a throwaway user and Sources written the way onboarding
writes them — via the real `saveKnowledgeRecord`, with deliberately curated
chunk boundaries — then runs the graph pass, asserts, and deletes everything it
made. Entity extraction is stubbed so the proof does not depend on live Claude
output or spend tokens.

## Assertions (all must pass)
1. **Baseline is the bug** — Sources written by `saveKnowledgeRecord` alone
   produce chunks but zero entities and zero relations. This is the reported
   `0 ENTITIES / 0 RELATIONS` state, reproduced.
2. **Graph populated** — after `indexOnboardingGraph()`, entity rows and edge
   rows exist for the seeded user.
3. **Curated chunking preserved** — the chunk count, their exact texts, and
   their ids are UNCHANGED by the graph pass. This is the regression that a
   naive `indexSource()` call would cause: re-chunking `rawText` would collapse
   one-testimonial-per-chunk back into blind splits.
4. **Embeddings preserved** — no chunk loses its embedding or has it rewritten.
5. **Mentions attach to real chunks** — every `EntityMention` points at a chunk
   belonging to the seeded user, and at least one entity is mentioned in the
   specific chunk whose text names it.
6. **Cross-source convergence** — an entity named in two different onboarding
   Sources resolves to ONE entity row whose mentions span both.
7. **Best-effort per source** — a source whose extraction throws does not lose
   its chunks, does not abort the run, and the other sources still index. The
   returned report counts the failure.
8. **Idempotent** — running the pass twice does not duplicate entities,
   mentions, or edges.
9. **Tenant isolation** — a second seeded user's chunks gain no entities from
   the first user's run, and no edge links across the two.
10. **Retrieval improves** — `retrieve()` for a query naming an entity returns
    a chunk from a source that does NOT contain the query term lexically,
    reachable only through a graph relation. Proves the expansion is live.
11. **Cleanup** — entity/edge/mention/chunk/source/user rows return to the
    pre-run baseline.

## Red expectation
Before implementation the script fails at import time:
`lib/onboarding/graphIndex.ts` does not exist.

## Secondary checks (not proof)
- `npx tsc --noEmit` clean.
- `$HOME/.claude/scripts/gate` PASS.
- Knowledge tab shows non-zero ENTITIES / RELATIONS after a real onboarding run.

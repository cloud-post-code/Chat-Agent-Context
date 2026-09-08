# Onboarding indexes into the knowledge graph

## Problem
Guided onboarding writes Source rows and Chunk rows directly through
`saveKnowledgeRecord` (lib/onboarding/knowledge.ts), bypassing
`lib/retrieval/indexer.ts` entirely. Entity and relation extraction lives only
inside `indexOrigin`, so a freshly onboarded user lands on the Knowledge tab
showing chunks but `0 ENTITIES / 0 RELATIONS`.

Retrieval still works, but in degraded mode: `retrieve()` seeds with BM25 +
vector and then expands through graph relations (`graphLimit`). With no edges
that expansion is a no-op, so the chatbot loses exactly the cross-document hops
the Knowledge tab advertises.

## Desired behaviour
Onboarding completes with a populated graph — no dashboard reindex required.

1. After the knowledge stage finishes, every Source that onboarding created or
   updated in that run gets entity + relation extraction.
2. Curated chunking is PRESERVED. Onboarding deliberately controls its own
   chunk boundaries (one chunk per testimonial, one per bio, one per swept
   fact). A plain `indexSource()` call would re-chunk `rawText` with
   `chunkText()` and destroy that. The graph pass must attach to the chunks
   already written.
3. Cluster overviews are rebuilt once at the end, so the Overviews tab is
   populated too.
4. Extraction is best-effort per source, matching the rest of the codebase: a
   failed model call must never lose the chunks already saved, and must not
   fail onboarding. A partial graph is reported honestly.
5. Progress is visible in the onboarding activity log, and the completion
   summary reports what was actually indexed.

## Out of scope
- Changing chunking, embedding, or any extraction prompt.
- The `local-hash-256-v1` embedding fallback (separate concern).
- Backfilling users who already onboarded (`scripts/reindex.ts` covers them).

## Constraints
- No new dependency. Reuse `extractEntities` and the existing persist path.
- One model call per source, paced like `scripts/reindex.ts` (`EMBED_PACE_MS`).
- Scoped per user; one tenant's graph must never link into another's.

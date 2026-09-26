# Retrieval engine v1

## Goal
Replace the "dump every source summary into the system prompt" pattern with a
retrieval engine: knowledge is chunked, embedded, and entity-tagged at ingest
time, and each chat turn builds its system prompt from a compact persona core
plus only the context retrieved for the visitor's question. This cuts prompt
tokens and improves answer quality on detailed questions (the model sees full
chunk text, not just 2–5 sentence summaries).

## Scope (Phase 1)
1. **Storage** — new Prisma models on the existing Postgres datasource
   (provider must stay `postgresql`; Railway constraint):
   - `Chunk`: a passage of a Source's raw text with an optional embedding
     (Float32 bytes + model tag). Cascade-deleted with its Source.
   - `Entity`: a named thing (person/org/project/skill/place/topic/event)
     with a normalized unique key.
   - `EntityMention`: which chunks mention which entities.
   - `EntityEdge`: a directed, labeled relation between two entities.
2. **Ingestion (inline)** — when a Source is scanned (add link / upload
   doc / paste text / rescan / manual summary edit), the same request also:
   chunks the raw text (falling back to the summary), embeds each chunk, runs
   one Claude call to extract entities + relations, and upserts
   chunks/entities/mentions/edges. Indexing failure must not fail the scan
   (source stays `scanned`; indexing is best-effort and logged).
3. **Embeddings without a dedicated key** — the repo only has
   `ANTHROPIC_API_KEY` (no embeddings endpoint). Provider chain:
   `VOYAGE_API_KEY` → Voyage REST; else `OPENAI_API_KEY` → OpenAI REST; else a
   deterministic local hashed character-n-gram embedding (no network). Each
   chunk records which model embedded it; cosine comparison only happens
   between vectors from the same model. Hybrid scoring means retrieval still
   works well on the local fallback.
4. **Hybrid retrieval with one-hop graph expansion** — `retrieve(query)`:
   - lexical score (BM25-style) over chunk text,
   - cosine score over embeddings (same-model only),
   - blended ranking picks seed chunks,
   - entities mentioned in seeds + entities named in the query expand one hop
     over `EntityEdge`; chunks mentioning neighbor entities get pulled in,
   - returns top chunks under a character budget plus entity relation lines.
5. **Prompt swap** — `buildSystemPrompt(query?)` becomes persona-core
   (identity, persona/tone, bio, experience, contact, project list, photos
   note, card instructions, corrections) + a RETRIEVED CONTEXT block for the
   query. The 60-source summary dump is kept ONLY as a fallback when the chunk
   table is empty (pre-backfill) or no query is given. The chat route passes
   the visitor's latest user message as the query.
6. **Backfill** — `scripts/reindex.ts` (run with `npx tsx`) indexes all
   scanned sources that have no chunks yet; `--all` reindexes everything.

## Out of scope (later phases)
- Indexing projects/photos/profile as chunks (they stay in persona core).
- pgvector / ANN indexes (corpus is small; in-process cosine is fine).
- Async/queued ingestion, re-ranking models, admin UI for the graph.

## Constraints
- `prisma/schema.prisma` datasource stays `provider = "postgresql"`.
- `scripts/use-postgres.mjs` must keep round-tripping: new long-text columns
  are added to its `longFields` list.
- Retrieval modules use relative imports (like the rest of `lib/`) so proof
  scripts can run under `tsx` without alias resolution.
- No new runtime dependencies.

## Implementation Routing
- Backend/TS server code only; no UI changes beyond none. No domain-skill
  frontend work needed (chat route + lib only).

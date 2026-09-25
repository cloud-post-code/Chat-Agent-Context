# lib/retrieval — index and search

Ingested text becomes chunks with embeddings and an entity graph; a question
retrieves chunks (BM25 + cosine + one-hop graph expansion) that `lib/knowledge.ts`
folds into the prompt.

| Concern | Module |
|---|---|
| write path: `indexOrigin`, `indexSource`, `dropOrigin`, `embedMissingChunks` | `indexer.ts` (the origins it knows: `origins.ts`) |
| read path: `retrieve`, `formatContext` | `search.ts` |
| chunking | `chunking.ts` |
| embeddings (Voyage → OpenAI → local hashed fallback) | `embed.ts` |
| entities and relations extracted with the model; the ontology | `entities.ts`, `entityTypes.ts` (must stay import-free) |
| graph admin: stats, rename, delete, merges, cluster overviews | `graph.ts`, `clusters.ts` |

## Invariants
- Every index and search call is scoped by `userId`; a chunk never crosses tenants
  (the multi-tenant proof asserts it end to end).
- Indexing is best-effort at save time: a provider outage must never cost an owner
  a saved edit (`reindex()` in `app/admin/actions/_shared.ts` swallows and logs).
- `scripts/reindex.ts --all` rebuilds every origin, paced by `EMBED_PACE_MS`.

## Testing
Proofs: `retrieval-engine-v1`, `universal-knowledge-index`, `knowledge-graph-admin`,
`graph-*` (currently `stale`: they predate multi-tenancy — fix or retire when this
area is next touched).

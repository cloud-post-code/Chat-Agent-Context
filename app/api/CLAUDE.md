# app/api — HTTP and streaming endpoints

| Route | Auth | What |
|---|---|---|
| `chat` | none; tenant by `slug` (`tenantBySlug`) | the visitor chat: NDJSON stream of `{t, v}` events (`text`, `card`) from `lib/brain.answer` |
| `contact` | tenant by `slug` | the contact form |
| `uploads/[name]` | none | serves files from `UPLOAD_DIR` |
| `a2a`, `a2a/rest/[[...path]]` | bearer token (`lib/a2a/guard.authorize`) + per-IP rate limit | the A2A protocol (JSON-RPC / SSE / REST) over `lib/brain` |
| `admin/chat`, `admin/build-card`, `admin/build-source`, `admin/site-cards`, `admin/import-github`, `admin/onboarding/*`, `admin/gmail/*` | session (`currentUser()` / `isAuthed()`) | streaming or long-running admin work that a server action can't stream; `admin/bulk-build` is operator-only |

Discovery documents live in `app/.well-known/*` over `lib/a2a/wellKnown.founderDocument`
(founder-only today); `llms.txt` routes over `lib/llms.ts` are per tenant.

## Rules
- Public tenant routes resolve the tenant with `tenantBySlug` and 404 otherwise; every
  query below is scoped by that user's id.
- Streaming routes write one JSON object per line; clients read them with
  `lib/client/ndjson.ts`.
- Admin routes check the session before any model call (a 401 costs nothing).
- Anything that mutates without needing a stream belongs in `app/admin/actions/*`, not here.

## Testing
`npm run smoke` hits chat, llms.txt, the agent card and A2A's auth gate;
`scripts/proof-multi-tenant.ts` probes cross-tenant isolation over HTTP.

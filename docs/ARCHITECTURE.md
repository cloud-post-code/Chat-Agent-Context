# Architecture

One Next.js app, one Postgres, one Anthropic client, many tenants. Every tenant is a
`User` row; everything else hangs off `userId`.

## Request flows

**A visitor asks a question** — `POST /api/chat {slug, messages}` → `tenantBySlug` →
`lib/brain.answer()`: an exact-match canned answer is served with zero model calls;
otherwise `lib/knowledge.buildSystemPrompt()` assembles persona + retrieved knowledge
(`lib/retrieval/search.retrieve`: BM25 + embeddings + one-hop graph) + the card tools the
tenant's data allows, and the model runs up to four tool turns. Tool calls hydrate cards
in `lib/cards.ts` (photos, services, booking flow, menu, social). Events stream back as
NDJSON; `app/Chat.tsx` reads them with `lib/client/ndjson.ts` and `app/cards/Cards.tsx`
renders each block. The turn is logged to `ChatSession` / `ChatMessage`.

**A new owner onboards** — `/signup` creates the user and seeds starter ingestion
sources, A2UI cards and answers (`lib/users.provisionUserDefaults`). `/admin/onboarding`
posts a site URL; `lib/onboarding/jobs.ts` crawls it (Playwright) and runs the extraction
stages in parallel, each writing through `lib/onboarding/save.ts`: profile, locations,
social links, gallery photos (vision-tagged), theme (normalized for contrast), knowledge
(blog / testimonials / team / sitemap → `Source` rows, indexed into chunks and the
graph), services and the transcribed booking form, then the first card set. The
activity stream shows progress; the owner reviews the theme and the booking form.

**A visitor books** — `show_booking` emits a booking block; the client starts a session
(`lib/booking/session.ts`) and walks the business's own step order one card at a time
(`app/cards/booking/*`), quoting and checking availability over `/api/booking/*`.
`POST /api/booking` → `lib/booking/store.createBooking` recomputes price, duration,
provider and slot from ids under an advisory lock and writes `Appointment`. The model
sees the whole booking as one "Booking so far" line.

**The owner edits** — every panel is server-rendered from `app/admin/panels/queries.ts`
(`loadAdminData`) and mutates through `app/admin/actions/<domain>.ts` (`requireUser` →
scoped write → `revalidateAll()`). The copilot (`/admin/chat`, `lib/adminBrain.ts`)
reveals panels or single elements by key (`lib/admin/contentTabs.ts`,
`lib/adminElements.ts`) and proposes edits the owner approves.

**Another agent calls** — `/.well-known/agent-card.json` describes the founder's agent;
`POST /api/a2a` (bearer token, rate-limited) dispatches JSON-RPC to `lib/a2a/rpc.ts`,
which runs the same `lib/brain.answer()`. `llms.txt` per tenant renders the knowledge as
Markdown (`lib/llms.ts`), and `middleware.ts` rewrites Markdown-accepting requests to it.

## Layers
- `app/` routes, actions and components. Client components import only prisma-free
  modules (`tests/arch/clientImports.test.ts`).
- `lib/` all server logic; never imports from `app/`. Guides: `lib/CLAUDE.md`,
  `lib/booking/CLAUDE.md`, `lib/onboarding/CLAUDE.md`, `lib/retrieval/CLAUDE.md`.
- `lib/db.ts` the only Prisma client; `lib/claude/` the only Anthropic client and the
  shared retry gate; `lib/util/` the shared helpers.

## Runtime
Railway: one service from this repo, Postgres plugin, a volume at `/data` for uploads.
`npm run build` installs Chromium for the onboarding crawler; `npm run start` applies
migrations then serves on `$PORT`. `instrumentation.ts` runs `lib/bootstrap.ts` at boot
(founder claim, legacy data migrations). Configuration is environment only
(`.env.example` lists every variable).

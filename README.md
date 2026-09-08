# Chat-Agent-Context

**A personal website whose homepage is a conversation, and whose owner is an agent other agents can call.**

There is no "About" page to scroll. A visitor lands on a chat box and asks
questions; an AI host answers as Blake, in his voice, using **only** the content
Blake has curated in a password-gated admin portal. When the answer is better
shown than said, the bot renders real UI — project cards, photo galleries, a
contact form — inline in the conversation.

The same brain is also published as a machine-callable agent: the site serves an
**A2A Agent Card** at a well-known URL and answers the A2A protocol over
JSON-RPC, SSE, and REST, so another AI agent can discover this one and interview
it about Blake without a human in the loop.

---

## Contents

- [What it is](#what-it-is)
- [The three surfaces](#the-three-surfaces)
- [How a question gets answered](#how-a-question-gets-answered)
- [The knowledge pipeline](#the-knowledge-pipeline)
- [The admin portal](#the-admin-portal)
- [A2A — agent-to-agent](#a2a--agent-to-agent)
- [A2UI — agent-to-UI](#a2ui--agent-to-ui)
- [Data model](#data-model)
- [Repository map](#repository-map)
- [Theming](#theming)
- [Configuration](#configuration)
- [Local setup](#local-setup)
- [Commands](#commands)
- [Deployment (Railway)](#deployment-railway)
- [How this repo is developed](#how-this-repo-is-developed)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Known limitations](#known-limitations)

---

## What it is

A Next.js 15 / React 19 application backed by Postgres (Prisma) and the
Anthropic Claude API. Three ideas hold it together:

1. **The site is the agent.** The homepage is a chat, not a brochure. Everything
   a visitor could want to know is reachable by asking.
2. **The agent only knows what you curate.** There is no crawling of the live
   web at answer time and no model general knowledge about Blake. Every fact the
   bot can state was added through the admin portal, then chunked, embedded and
   indexed into a knowledge graph. If it isn't in the index, the bot says it
   doesn't know and points you at the contact form.
3. **One brain, many transports.** [`lib/brain.ts`](lib/brain.ts) *is* the
   chatbot. The web chat route and the A2A protocol endpoints are *transports*
   over it — not copies of it. Adding a channel means adding a transport, never
   a second brain.

---

## The three surfaces

| Surface | Route | Who it's for |
|---|---|---|
| **Chat homepage** | `/` | Humans. Chat box, starter chips, streaming answers, inline cards. |
| **Agent page** | `/agent` | Humans evaluating the agent — a readable description of the A2A interface, linked from the homepage. |
| **Admin control room** | `/admin` → `/admin/dashboard` | Blake. Password-gated. Ten tabs that own every word the bot can say and every color the site wears. |
| **Agent interfaces** | `/.well-known/*`, `/api/a2a*` | Other AI agents. Discovery + protocol. |

---

## How a question gets answered

Every visitor message enters `answer()` in [`lib/brain.ts`](lib/brain.ts), which
runs **two tiers and only two tiers**:

```
message
  │
  ├─ Tier 1: canned answer?  ── normalized string equality against CannedAnswer
  │     └─ hit → serve stored text + optional hydrated card.  ZERO model calls.
  │
  └─ Tier 2: the model
        ├─ buildSystemPrompt(message)   ← persona core + retrieval for THIS question
        ├─ stream from Claude with 4 A2UI tools available
        ├─ tool call → hydrate() → emit a card → feed the result back → let Claude close
        └─ (max 4 tool turns)

  finally: recordTurn() logs the exchange to the Activity tab (best-effort)
```

**Tier 1** matching is deliberately dumb: lowercase, collapse whitespace, strip
trailing `?`/`.`/`!` — nothing fuzzy. A near-miss falls through to the model,
which is the safe direction to fail. The worst case of a miss is today's cost;
the worst case of a loose match is the wrong answer in Blake's voice. Blank
answers fall through too, so the admin tab is safe half-finished.

**Blank rows draft themselves.** [`lib/answerDrafts.ts`](lib/answerDrafts.ts)
fills any never-drafted blank row when the dashboard loads, using the *same*
retrieval + persona prompt the chatbot would have used — so a draft is not a
downgrade, it's the same answer, instant and free. Rows are marked `aiDraft`
until Blake saves them, which turns the tab into a review queue rather than a
to-do list. `draftedAt` guarantees the automatic pass gets exactly one shot per
row, ever, so a row Blake deliberately empties stays empty.

There is **no classifier call and no escalation tier** — a cheap router that
itself costs a model call isn't cheap.

The brain emits a stream of `{t:"text"|"card"}` events. The web route
([`app/api/chat/route.ts`](app/api/chat/route.ts), 53 lines) writes them out as
NDJSON. The A2A runner ([`lib/a2a/run.ts`](lib/a2a/run.ts)) translates them into
protocol messages and artifacts. Neither knows anything about the other.

---

## The knowledge pipeline

This is the heart of the project. Every admin surface feeds **one** index.

### Ingest

The Knowledge tab has a single unified ingest that accepts three shapes:

| Input | Handled by | Result |
|---|---|---|
| **A link** | [`lib/scrape.ts`](lib/scrape.ts) → cheerio | Cleaned article text |
| **A PDF / .docx** | `pdf-parse` / `mammoth` | Extracted text |
| **Pasted text or markdown** | direct | Text as given |

Whatever comes out is summarized and tagged by Claude and stored as a `Source`.
A resume upload takes a separate path (`writeProfileFromResume`) that splits
into Bio / Experience / Other and fills the contact fields.

### Index

Indexing is **origin-agnostic** ([`indexer.ts`](lib/retrieval/indexer.ts) +
[`origins.ts`](lib/retrieval/origins.ts)). Six surfaces feed it:

| Origin | What gets indexed |
|---|---|
| `profile` | bio, experience summary, each experience entry, "other", location |
| `persona` | the persona prose field |
| `project` | name, blurb, AI-enriched detail, tags |
| `photo` | the vision-written description |
| `source` | full extracted text of a link / PDF / paste |
| `activity` | **only** assistant answers Blake rated 👍 |

Each origin's text is:

1. **Chunked** — sentence-aware, ~1100 chars with 150-char overlap so facts
   straddling a boundary stay findable ([`chunking.ts`](lib/retrieval/chunking.ts)).
2. **Embedded** — provider chain Voyage → OpenAI → a deterministic local hashed
   n-gram embedder that needs no network ([`embed.ts`](lib/retrieval/embed.ts)).
   Anthropic has no embeddings endpoint, so with only `ANTHROPIC_API_KEY` set
   the local fallback runs and hybrid retrieval keeps quality acceptable. Every
   chunk records **which model embedded it**; cosine is only ever computed
   between same-model vectors.
3. **Entity-extracted** — one Claude call per origin pulls out named things
   (person / org / project / skill / place / topic / event) and the factual
   relations between them ([`entities.ts`](lib/retrieval/entities.ts)).
4. **Persisted** — chunks replaced wholesale, entities and edges upserted. An
   entity named in two origins converges on one row, which is how the graph
   links across surfaces.

Indexing is **best-effort at every call site**: a failure logs and moves on, and
never fails the admin save that triggered it.

> **Activity is approval-gated on purpose.** Visitors type into a public box, so
> their words are untrusted input. Indexing raw conversations would let anyone
> write into the knowledge base and have it retrieved back later as fact. Only
> an answer Blake has personally rated up ever crosses into knowledge.

### Retrieve

[`lib/retrieval/search.ts`](lib/retrieval/search.ts) — hybrid, with a graph hop:

1. Score every chunk **lexically** (BM25-style, k1=1.4, b=0.6) and by
   **embedding cosine**; blend the normalized scores; take the top seeds.
2. Collect the entities the seeds mention *plus* entities named in the raw
   query, **expand one hop over `EntityEdge`**, and pull in chunks mentioning
   the neighbours — facts connected to the question but phrased differently.
3. Return the best chunks under a character budget, plus human-readable relation
   lines rendered into the prompt as `KNOWN RELATIONSHIPS`.

The whole chunk table is scanned in-process. The corpus is one person's
knowledge base (hundreds of chunks), so this beats maintaining a vector index.

### Retract

Deleting content is the admin's retraction mechanism, so it has to reach the
graph. `EntityEdgeOrigin` records **which origin asserted each relation**.
`dropOrigin()` retracts that origin's ownership, deletes edges left with no
owner, and prunes entities with no mentions *and* no edges. Cross-origin dedup
survives: a relation two origins assert outlives losing one of them.

Edges with **no** ownership rows are never auto-pruned — that covers relations
added by hand on the Graph tab and every edge written before provenance existed,
so shipping this could not empty an existing graph.

### Prompt

[`lib/knowledge.ts`](lib/knowledge.ts) assembles the system prompt:

- **Always on:** persona prose, identity, contact block, the project *index*
  (ids + links only), photo availability, A2UI usage rules, hard rules ("only
  state facts present above", "never invent projects, jobs, dates or
  credentials"), and up to 30 **corrections** — notes Blake attached to answers
  he rated 👎, which steer the bot away from repeating mistakes.
- **Per question:** the retrieved chunks and relations, each labelled with where
  it came from.

Bio, experience, project write-ups and photo descriptions used to ship on every
single message; now they're retrieved. If retrieval fails or nothing is indexed
yet, it falls back to a dump of recent source summaries so the bot is never
knowledge-blind.

---

## The admin portal

`/admin` → password → `/admin/dashboard`. Auth is a signed cookie
([`lib/auth.ts`](lib/auth.ts)) over a single `ADMIN_PASSWORD`. All tabs are
driven by server actions in [`app/admin/actions.ts`](app/admin/actions.ts).

**The Content tabs are ingestion sources, stored as data.** Each Content tab
(Experience, Projects, Links, PDFs, Text, Photos, Persona) is an
`IngestionSource` row ([`lib/ingestionSources.ts`](lib/ingestionSources.ts)) —
the same "which X exist is data, not code" principle as A2UI cards. A row
holds the source's code (`key`), its own system prompt, its upload method,
the uniform storage rule (`text` | `image` | `text+image` — every ingested
piece is one of the two, read back uniformly via
[`lib/ingestedItems.ts`](lib/ingestedItems.ts)), where output lands, and its
display `order` (row order IS tab order). "+ New ingestion source" creates a
custom source that renders a generic text/image ingest panel over its own
`ingest:<key>`-marked rows; every tab's "Edit ingestion" button opens
`/admin/sources/<key>`, double-gated by `INGESTION_EDIT_PASSWORD` from the
local `.env` ([`lib/ingestionAuth.ts`](lib/ingestionAuth.ts)).

**The database bootstraps itself on deploy.** [`instrumentation.ts`](instrumentation.ts)
runs [`lib/bootstrap.ts`](lib/bootstrap.ts) on every server start, right
after the start script's `prisma db push`: starter ingestion sources, A2UI
cards, and canned answers are seeded into empty tables (never resurrecting
deletions), and data written under retired shapes is migrated to the current
one (the old 21-section persona catalogue folds into the single persona
field; a leftover `Profile.linkedin` moves into `socials`). Everything is
idempotent and best-effort, so the DB begins — and stays — in the same
structure at every point in time, and runtime code carries no legacy-shape
branches: old shapes live only in the bootstrap migrations.

| Tab | What it does |
|---|---|
| **Profile** | Name, tagline, location, email/LinkedIn/GitHub, arbitrary socials, headshot upload, bio, an add-one-at-a-time **experience list**, and "everything else". A CV/resume upload fills all of it. |
| **Persona** | One free-prose field — the voice the bot speaks in. It becomes the persona core of every system prompt. |
| **Theme** | Live visual editor: 7 color roles as swatches with pickers + hex entry, **20 preset palettes and a shuffle button**, curated Google Font menus rendered *in* their own font, corner-radius preview boxes, base font size, heading weight. |
| **Projects** | Cards with GitHub URL + live URL (either optional), cover image, tags, inline editing, ordering. **Import from GitHub**: paste a profile URL and it pulls public non-fork repos via the GitHub API, most-starred first, capped at 12, deduped by repo URL, then Haiku-enriches each into a "Learn more" write-up. |
| **Knowledge** | The unified link / PDF / paste ingest, plus rescan, manual summary editing, and delete. |
| **Answers** | The canned-answer table: hits counter (model calls avoided), unreviewed-draft markers, per-row **Redraft**, an optional card to render alongside, enable/disable without losing the text. |
| **Graph** | See and fix the extracted graph — index-health stats, per-origin breakdown, warnings for missing embeddings and mixed-model indexes, orphan flags, a **Cytoscape.js force-directed visual graph**, and paginated Entities/Relations panes. Rename (renaming onto an existing name **merges**: mentions move, edges rewire, self-loops drop), retype, delete, and add relations by hand. |
| **Photos** | Upload → **Claude vision writes a one-paragraph description** (editable), plus caption, kind, order. |
| **Activity** | Every visitor conversation replayed, with metrics (chats, this week, questions, messages, avg/chat, flagged 👎). Rate any answer 👍/👎 and attach a correction note. |
| **Contacts** | Submissions from the in-chat contact form, with an unhandled badge. |

Every save that changes content re-indexes its origin inline.

---

## A2A — agent-to-agent

The site publishes an Agent Card and speaks the A2A protocol, so another agent
can discover it and ask it questions. Nothing is duplicated: `lib/a2a/*` is a
transport over the same `lib/brain.ts`.

| URL | What it is |
|---|---|
| `/.well-known/agent-card.json` | Agent Card, A2A **v1.0** (the current spec) |
| `/.well-known/agent.json` | The same agent in **v0.3** vocabulary, for older clients |
| `/.well-known/agent-facts.json` | NANDA **AgentFacts** document (also served extension-less at `/.well-known/agent-facts`) |
| `/api/a2a` | JSON-RPC 2.0 endpoint, with SSE streaming |
| `/api/a2a/rest` | The same methods over HTTP+JSON |
| `/agent` | The human-readable page |

**Both live protocol generations are spoken**, negotiated by the `A2A-Version`
header — absent means 0.3, per spec §3.6.2. (v1.0 renamed nearly everything from
the v0.3 shape most tutorials still show: `supportedInterfaces` replaced
`url`/`preferredTransport`, PascalCase `SendMessage` replaced `message/send`,
`TASK_STATE_*` replaced the lowercase states, and the `kind` discriminator is
gone.)

Implemented: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`,
`CancelTask`, `SubscribeToTask`. Push notifications and the extended card are
**not** implemented, the card says so, and those methods return the specific
`-32003` / `-32004` the card's declared capabilities imply.

Both bindings are thin wrappers over one `dispatch()`
([`lib/a2a/rpc.ts`](lib/a2a/rpc.ts)) — which is what §5.1's "all bindings MUST
be functionally equivalent" requires in practice: one implementation, two
envelopes, no chance of drift.

```bash
curl -X POST http://localhost:3000/api/a2a \
  -H 'Content-Type: application/json' -H 'A2A-Version: 1.0' \
  -H 'Authorization: Bearer <your A2A_API_KEY>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{
        "message":{"messageId":"1","role":"ROLE_USER",
                   "parts":[{"text":"What are your recent projects?"}]}}}'
```

Notable properties:

- **The card is generated from the `Profile` row**, not hardcoded — a site built
  from this template describes its own owner with its own skills. There is no
  JSON to hand-edit.
- **Tasks are persisted** in Postgres (`A2ATask`), because the protocol lets a
  caller send now and fetch later; `GetTask` has to survive both the originating
  request and a redeploy.
- **`contextId` doubles as the chat `sessionId`**, so agent-to-agent traffic
  shows up in the Activity tab like any visitor's.
- **UI cards become structured `data` parts**, so a calling agent receives
  machine-readable JSON for projects and galleries rather than prose it would
  have to parse back.
- **Rate limited always** — `A2A_RATE_LIMIT`, default 30/min/IP, in-memory.
  Every accepted call spends model credits.
- **Credentials are required** ([`lib/a2a/guard.ts`](lib/a2a/guard.ts)): a
  bearer token matching `A2A_API_KEY` or the admin password. Publishing a card
  is how another agent learns this one exists and that it needs credentials —
  it is not the same as accepting anonymous work. Failed credentials are
  budgeted far more tightly than ordinary traffic (5 per 15 minutes per IP),
  comparisons are constant-time, and only the `Authorization` header is accepted
  — never the admin session cookie, since a cookie-authenticated POST endpoint
  would be cross-site forgeable. If **no** credential is configured the endpoint
  refuses everyone rather than falling open.
- The AgentFacts document makes **no fabricated audit claims** — no
  `evaluations` block, and `certification.level` is `self-declared`.

> ⚠️ **This section describes work in flight.** `lib/a2a/guard.ts` has been
> rewritten to the closed-by-default policy above, but `app/api/a2a/*` still
> imports the removed `isAuthorized`, `lib/a2a/card.ts` no longer re-exports
> `a2aApiKey` that `app/agent/page.tsx` and `lib/a2a/facts.ts` import, and
> `.env.example` still documents the old "blank key = public" behavior.
> `npx tsc --noEmit` currently fails on those four call sites.

---

## A2UI — agent-to-UI

The brain gives Claude a set of tools and streams the results as renderable
blocks:

| Tool | Renders |
|---|---|
| `show_projects` | All project cards |
| `show_project` | One project card, by id |
| `show_gallery` | Photos as a `carousel` or a `filmstrip` with lightbox |
| `show_timeline` | Work history as a vertical timeline, from `Profile.experience` |
| `show_contact_form` | An in-chat contact form, posted to `/api/contact` |
| `show_booking` | The appointment wizard: the tenant's configured questions one step at a time, then a time, posted to `/api/booking` — offered only when the Appointments toggle is on |

`hydrate()` turns a tool call into a concrete payload
([`lib/cards.ts`](lib/cards.ts)); [`app/cards/Cards.tsx`](app/cards/Cards.tsx)
renders it. The prompt instructs Claude to always speak a sentence *alongside* a
card — the card supplements the words, it doesn't replace them. Canned answers
can name the same tools, so the "projects" starter chip still renders real cards
while costing nothing.

**Which cards exist is data, not code.** The `UiCard` table
([`lib/uiCards.ts`](lib/uiCards.ts)), edited on the admin **Agent Behavior →
A2UI** tab, is the card catalog: a tool is offered to the model only when a
card row names it, and each row's "when the agent should show it" text becomes
a line of the prompt's card instructions. Deleting a card takes it away from
the chatbot; an empty catalog falls back to the starter set (which also
re-seeds on the next dashboard load). The one thing a row cannot do is force a
tool past its live gate — `show_booking` stays withheld unless booking is on
and Google is connected, `show_booking_link` unless a link is set. Canned
answers bypass the catalog on purpose: a card named on a preset is Blake's
explicit per-answer choice.

Ask the bot *"show me your projects"* or *"let me see some photos"* and you get
cards, not paragraphs.

---

## Data model

Prisma over Postgres. Sixteen models, in [`prisma/schema.prisma`](prisma/schema.prisma):

**Knowledge & retrieval**

| Model | Purpose |
|---|---|
| `Source` | An ingested link / PDF / paste: raw text, Claude summary, tags, kind, status |
| `Chunk` | A passage of any origin's text + its embedding + which model produced it |
| `Entity` | A named thing, with a normalized unique `key` |
| `EntityMention` | Which chunks mention which entities |
| `EntityEdge` | A directed, labeled relation between two entities |
| `EntityEdgeOrigin` | **Which origin asserted each edge** — the retraction mechanism |

**Content**

| Model | Purpose |
|---|---|
| `Profile` | The single row (`id = 1`): identity, bio, experience, persona, theme, contact |
| `Project` | Curated project with GitHub + live URLs, blurb, AI detail, tags |
| `Photo` | Uploaded image + vision-written description |

**Conversation**

| Model | Purpose |
|---|---|
| `ChatSession` | One visitor conversation, keyed by a stable client-side `visitorKey` |
| `ChatMessage` | One turn; assistant turns carry Blake's `rating` and correction `note` |
| `CannedAnswer` | Pre-model answers: `matchKey`, text, `aiDraft`, `draftedAt`, optional card, `hits` |
| `Contact` | A contact-form submission |
| `A2ATask` | A persisted A2A task: state, history, artifacts, cancel flag |

Every schema field is commented in place with *why* it exists, not just what it
holds — the schema is meant to be readable as documentation.

---

## Repository map

```
app/
  page.tsx              Chat homepage (server) → Chat.tsx (client)
  Chat.tsx              Thread, starters, NDJSON stream reader, session id
  Markdown.tsx          Answer rendering
  cards/Cards.tsx       A2UI card renderers
  agent/page.tsx        Human-readable agent page
  layout.tsx            DB-driven theme <style> injection + PostHog provider
  .well-known/          Agent Card (v1.0 + v0.3) and AgentFacts routes
  api/
    chat/route.ts       NDJSON transport over the brain (53 lines)
    a2a/route.ts        JSON-RPC + SSE binding
    a2a/rest/           HTTP+JSON binding
    contact/route.ts    Contact-form sink
    uploads/[name]/     Serves images off the volume
    admin/import-github Streaming GitHub profile import
  admin/
    page.tsx            Password login
    dashboard/page.tsx  The ten tabs
    actions.ts          Every server action (auth-wrapped, thin)
    *.tsx               ThemePicker, GraphView/GraphPanel/GraphCanvas,
                        AnswersPanel, Extractor, GithubImport, ExperienceEditor…
lib/
  brain.ts              THE CHATBOT. Two tiers, tool loop, event stream.
  knowledge.ts          System-prompt assembly
  canned.ts             Canned-answer data layer + normalizeQuestion()
  answerDrafts.ts       Self-drafting blank answers
  cards.ts              A2UI block hydration
  retrieval/
    chunking.ts  embed.ts  entities.ts
    indexer.ts   origins.ts  search.ts  graph.ts
  a2a/
    card.ts  facts.ts  rpc.ts  run.ts  tasks.ts
    transport.ts  downgrade.ts  guard.ts  types.ts
  scrape.ts  vision.ts  github.ts  activity.ts  persona.ts
  theme.ts  fonts.ts  auth.ts  uploads.ts  db.ts  claude.ts  util.ts
prisma/    schema.prisma, migrations/, seed.ts
scripts/   reindex.ts, use-postgres.mjs, polyfill-file.cjs
docs/features/<slug>/   FEATURE.md + PROOF.md + proof.ts, per feature
```

---

## Theming

The whole site's look comes from **the database**. `app/layout.tsx` reads the
`Profile` row on every request and injects a `<style>` block of CSS variables
that wins over `app/globals.css` defaults. The Theme tab writes those values.

The rule that keeps it readable: **one text color per fill**. There is no muted
grey — every fill (background, bg-soft, surface, accent) owns exactly one
foreground, and secondary text (captions, hints, blurbs, timestamps) is that
same color set in *italics*. A lighter neutral would be a fourth color outside
the contrast pairs, which is exactly how text ended up unreadable on themed
fills before. Flat solid colors, no gradients or glows.

Fonts are self-hosted via `next/font` (Space Grotesk / Inter / JetBrains Mono by
default), with a curated selectable library in [`lib/fonts.ts`](lib/fonts.ts).

The invented starting brand — *"Curious builder"*, ink navy + signal violet +
amber — is documented in [`BRAND.md`](BRAND.md).

---

## Configuration

Copy [`.env.example`](.env.example) to `.env`.

| Variable | Required | What it does |
|---|---|---|
| `DATABASE_URL` | **yes** | Postgres connection string. Railway injects it automatically. |
| `ANTHROPIC_API_KEY` | **yes** | Powers the chatbot, summarization, entity extraction, vision, and drafts. |
| `ADMIN_PASSWORD` | **yes** | The `/admin` gate; also accepted as an A2A bearer token. |
| `AUTH_SECRET` | **yes** | Signs the admin session cookie. Use a long random string. |
| `CLAUDE_MODEL` | no | Defaults to Haiku. |
| `UPLOAD_DIR` | no | Where images are written. `./data/uploads` locally, `/data/uploads` on a Railway volume. |
| `NEXT_PUBLIC_SITE_URL` | **for A2A** | The URL the Agent Card advertises. A wrong value tells other agents to call an address that doesn't answer. Falls back to the request host when unset. |
| `A2A_API_KEY` | recommended | A dedicated bearer token for the A2A endpoint, preferred over handing out the admin password. |
| `A2A_RATE_LIMIT` | no | Calls per IP per minute. Default `30`. `0` disables. |
| `VOYAGE_API_KEY` | no | Upgrades embeddings to `voyage-3.5-lite`. |
| `OPENAI_API_KEY` | no | Fallback embeddings (`text-embedding-3-small`), and image generation for the card builder. Unset, the builder still reuses existing images — it just can't draw new ones. |
| `OPENAI_IMAGE_MODEL` | no | Image model for the card builder. Defaults to `gpt-image-1`. |
| `NEXT_PUBLIC_POSTHOG_KEY` / `_HOST` | no | Client analytics. Blank disables it (the provider no-ops). |

With no embedding key at all, the local hashed-feature embedder runs — no
network, deterministic, and hybrid retrieval keeps quality acceptable.

---

## Local setup

Local development runs against **Postgres in Docker**, matching production — see
the note under [Deployment](#deployment-railway) about why the schema provider
must not be flipped.

```bash
npm install
cp .env.example .env     # fill ANTHROPIC_API_KEY, ADMIN_PASSWORD, AUTH_SECRET
```

Start a local Postgres (port 5433, so it doesn't collide with anything on 5432):

```bash
docker run --name blake-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=blake -p 5433:5432 -d postgres
```

Set `DATABASE_URL="postgresql://postgres:pw@localhost:5433/blake?schema=public"`,
then create the tables, seed the placeholder persona, and run:

```bash
npm run db:push
npm run db:seed
npm run dev
```

Open http://localhost:3000, then http://localhost:3000/admin, log in with
`ADMIN_PASSWORD`, and start adding content. The bot has nothing to say until you
do — that's by design.

---

## Commands

```bash
npm run dev            # Next dev server
npm run build          # prisma generate + next build (with the File/Blob polyfill)
npm run start          # prisma db push, then next start on $PORT
npm run lint           # next lint
npm run db:push        # push the schema to the database
npm run db:migrate     # create/apply a dev migration
npm run db:studio      # Prisma Studio
npm run db:seed        # seed the placeholder Blake profile
```

Backfill the retrieval index:

```bash
npx tsx scripts/reindex.ts          # index scanned sources that have no chunks
npx tsx scripts/reindex.ts --all    # rebuild EVERY origin
```

`--all` paces itself (`EMBED_PACE_MS`, default 21s between origins) because one
embed request per origin back-to-back trips provider per-minute limits. The
pacing lives in the backfill, not the embed layer, so live chat is never
throttled.

---

## Deployment (Railway)

1. Push to GitHub; in Railway choose **New Project → Deploy from GitHub repo**.
2. Add the **Postgres** plugin — `DATABASE_URL` is injected automatically.
3. Add a **Volume**, mount it at `/data`, and set `UPLOAD_DIR=/data/uploads`.
4. Set `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `AUTH_SECRET`, `CLAUDE_MODEL`,
   `A2A_API_KEY`, and `NEXT_PUBLIC_SITE_URL` (**required for A2A** — it's what
   the card advertises).
5. Deploy. `npm run start` runs `prisma db push` first, so new tables are created
   on boot; there is no manual migration step.
6. Optionally run `npm run db:seed` once from the Railway shell.
7. Run `npx tsx scripts/reindex.ts --all` after any schema change that adds
   index columns, so existing rows pick them up.

> **The schema's `provider` must stay `postgresql`.** The Railway deploy breaks
> otherwise. `scripts/use-postgres.mjs --sqlite` exists to flip the provider and
> strip `@db.Text` annotations for an offline experiment, but the committed
> schema must always be back on Postgres before you push.

Build details: [`next.config.ts`](next.config.ts) polyfills `File`/`Blob` up
front (some Node runtimes don't define them during Next's page-data collection,
which makes server-action modules throw `ReferenceError: File is not defined`),
keeps `pdf-parse` and `mammoth` external so they aren't bundled (bundling
`pdf-parse` breaks it — it reads files relative to its own package), and raises
the server-action body limit to 10 MB for uploads.

---

## How this repo is developed

Each feature gets a directory under `docs/features/<slug>/`:

- **`FEATURE.md`** — what to build and *why*, including the tradeoffs considered
  and rejected.
- **`PROOF.md`** — the definition of done and the **primary proof command**,
  with every assertion enumerated.
- **`proof.ts`** — an executable proof, run with `npx tsx`.

```bash
npx tsx docs/features/a2a-agent-interface/proof.ts        # 61 assertions, zero Anthropic calls
npx tsx docs/features/canned-answers-and-brain/proof.ts   # 38 assertions
npx tsx docs/features/graph-delete-provenance/proof.ts    # 22 assertions
npx tsx docs/features/ai-drafted-answers/proof.ts         # 22 assertions, offline
npx tsx docs/features/universal-knowledge-index/proof.ts
npx tsx docs/features/knowledge-graph-admin/proof.ts
npx tsx docs/features/retrieval-engine-v1/proof.ts
npx tsx docs/features/persona-sections/proof.ts
```

Proofs run against the local dev database, load `.env` themselves, seed what
they need, and clean up every row they create. Where possible they make **zero
model calls** — the A2A proof, for instance, seeds a canned answer and asks that
exact question, so the response travels the entire real path
(`dispatch` → `runTask` → `answer()` → persistence → version rendering) with a
byte-checkable payload at the end and no model in the loop. Each was verified
*red* before being made green.

[`docs/features/status.json`](docs/features/status.json) is the durable queue:
every feature, its status, what was proven, and what's left.

---

## Design decisions worth knowing

Each of these is a place where the obvious choice was rejected for a reason.

- **Two tiers, no router.** A classifier that decides whether to use the cheap
  path costs a model call, which is the thing it was supposed to save.
- **Exact-match canned answers, nothing fuzzy.** Failing to match costs today's
  price; matching loosely costs a wrong answer in someone's real voice.
- **The brain is not the route.** `answer()` takes `{message, history,
  sessionId, channel}` and yields events. Both the web route and the A2A runner
  are thin translators. A new channel is a transport, never a fork.
- **No fallback from provider embeddings to local ones.** Cosine only compares
  same-model vectors, so a mid-reindex provider hiccup would silently split the
  index in two and leave half the knowledge base keyword-only, with nothing to
  show for it. Leaving chunks unembedded is the honest failure — they stay
  lexically searchable and the Graph tab reports them as missing.
- **Visitor chat is untrusted.** Only 👍-rated answers are indexed. Otherwise the
  public chat box is a write endpoint into the knowledge base.
- **Deleting has to reach the graph.** Before `EntityEdgeOrigin`, deleting a
  source removed its chunks but left its extracted relations behind, and
  `retrieve()` kept rendering them into the prompt as fact. Provenance made
  deletion actually retract.
- **Edges with no recorded owner are never auto-pruned.** That's what made
  shipping provenance safe on an existing graph.
- **Rate limiting is in-memory.** It only has to stop a runaway loop; a shared
  store would put a database round-trip in front of every request to save a
  fraction of a cent. On a multi-instance deploy each instance limits
  independently — deliberately accepted.
- **Tasks live in Postgres, not memory.** `GetTask` must survive a redeploy.
- **The Agent Card is generated, not written.** Hand-edited JSON drifts from the
  profile it describes.
- **The persona is one prose field, not 21 sections.** It shipped as 21 labeled
  boxes built from buyer-persona templates, and most of those fields (purchasing
  approval thresholds, budget-cut tradeoffs, crisis mode) either don't apply to
  a personal site or can't be known about a real person without inventing them —
  and an invented section enters the prompt with exactly the same authority as a
  true one. Legacy text is folded forward on read so nothing was lost.
- **Full chunk-table scan on every question.** Hundreds of chunks. An index
  would be infrastructure to maintain in exchange for nothing measurable.

---

## Known limitations

- **The A2A auth refactor is mid-flight** and the project does not currently
  typecheck. See the warning in [A2A](#a2a--agent-to-agent).
- **LinkedIn blocks bots**, so auto-scans of LinkedIn URLs come back thin. The
  admin lets you paste and edit the summary by hand — that's what the chatbot
  uses. Public blog / GitHub / article URLs scrape well.
- **The bot only states what you've added.** It will not invent credentials, and
  it will tell a visitor it doesn't know rather than guess.
- **Not implemented in A2A:** the gRPC binding, Agent Card JWS signing (needs a
  key story), and push notifications (declared `false` on the card; the methods
  return the spec's `-32003`).
- **`npm audit`** reports advisories in `sharp`/libvips, transitive via Next.js
  image optimization, with no non-breaking upstream fix published yet. This app
  serves uploaded images through a raw route and never calls sharp directly, so
  exposure is minimal. Re-run periodically and bump `next` when a patched
  release lands.
- **There is no `/projects` page.** Projects are reachable by asking the bot,
  which renders them as cards — that's the whole premise.

---

## Stack

Next.js 15 (App Router, server actions) · React 19 · TypeScript ·
Prisma 6 + Postgres · Anthropic Claude API · Cytoscape.js (graph view) ·
cheerio / pdf-parse / mammoth (ingest) · PostHog (analytics) ·
Railway (hosting + volume).

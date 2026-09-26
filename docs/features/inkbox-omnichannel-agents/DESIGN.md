# Design: Inkbox ↔ Chat-Agent-Context

Everything below was verified against the running code and the Inkbox docs
(`https://inkbox.ai/llms.txt`). File references are real.

## 1. Capability comparison

| Need | Inkbox provides | This repo has | Gap |
|---|---|---|---|
| Per-user external identity | Identity = handle + mailbox + tunnel, created via one API call | `User.slug` → `/a/<slug>` | Store the mapping; handles are globally unique |
| Per-user internal identity | A second identity, independently configured | `lib/adminBrain.ts` behind session auth | No transport for it outside the browser |
| Owner-only access | `mail_filter_mode: whitelist` + `exact_email` allow rule; blocked mail never delivers and fires no webhook | Session cookie (`lib/auth.ts`) | Provider-side rule + app-side re-check |
| Public access | Blacklist mode (open) | Public page, no auth | Matches already |
| Inbound delivery | Webhooks: `message.received`, `text.received`, `imessage.received`; ≤20 subs/mailbox | No inbound anything | New webhook route |
| Authenticity | Per-identity signing secret, `X-Inkbox-*` headers, optional bearer | `lib/a2a/guard.ts` bearer + rate limit | New verifier, same spirit |
| Threading | `thread_id`, `in_reply_to_message_id` | `ChatSession` | Map thread ↔ session |
| Agent-to-agent | Inkbox A2A (proprietary v1.0), card at `/a2a/{handle}/card` | Google-style A2A at `/api/a2a`, single-tenant | Two different A2A protocols — see §4 |
| Replay safety | Envelope `event_id` stable across replays | — | Dedup table |

## 2. The cards question

**Web does not change.** `/api/chat` keeps its NDJSON contract
(`app/api/chat/route.ts:44-63`) and `app/cards/Cards.tsx` keeps painting cards.

Coexistence works because the brain already separates *what to say* from *how it is
carried*. `lib/brain.ts:41`:

```ts
const CARD_CHANNELS: ReadonlySet<string> = new Set(["web", "a2a"]);
```

and `lib/brain.ts:272`:

```ts
if (event.t === "card" && !cards) continue;   // ← today: silent drop
```

`Channel` is `"web" | "a2a" | (string & {})` — passing `"email"` already works and
already yields text-only. The one change: replace the drop with a render.

```ts
// after
if (event.t === "card" && !cards) {
  yield { t: "text", v: renderBlockAsText(event.v, { origin }) };
  continue;
}
```

That is the whole coexistence story. Same brain, same tools, same knowledge; the card
becomes prose on channels that cannot paint. Web is untouched because `"web"` stays in
`CARD_CHANNELS` and takes the original branch.

### Per-variant degradation (`UiBlock`, `lib/cards.ts:44-59`)

| Variant | Text form |
|---|---|
| `projects` / `project` | Title, one-line summary, absolute link each |
| `gallery` | Caption list + absolute image URLs |
| `custom` | Walk `CustomElement` (closed set: heading, text, list, badges, stats, buttons, image, quote, divider) → markdown |
| `html` | Text content only; never forward model-authored markup |
| `contact` | Link to `/a/<slug>` — it is a form, not content |
| `booking` | Booking link, not a field dump |

`CustomElement` being a closed vocabulary is what makes this tractable rather than
open-ended.

### Two hardcoded web assumptions to fix

1. `lib/brain.ts:233` returns `"Card rendered to the user."` even when the card was
   dropped, so on email the model says "as you can see above" about nothing. Make it
   channel-aware.
2. `lib/knowledge.ts` (`cardRulesSection`) tells the model *"don't collect their details
   in conversation"* — correct for web, wrong for email where there is no form. Make it
   channel-conditional.

## 3. Internal vs external

Defense in depth, because a provider-side rule alone is one console edit from being wrong:

```
inbound → Inkbox whitelist rule (exact_email = owner)   ← never delivered otherwise
        → signature verification (per-identity secret)
        → app-side sender check vs User.email
        → adminAnswer()
```

External needs only signature verification and rate limiting before `answer()`.

The reason the internal channel needs a hard gate: `adminAnswer()` can take real admin
actions. Email `From` is trivially spoofable, so the app-side check must compare against
the *authenticated* delivery, and SMS/iMessage must not be enabled for the internal
identity — caller ID is not an authentication factor.

## 4. Two different A2A protocols (name collision)

`/api/a2a` implements **Google-style A2A** (Agent Cards, JSON-RPC, versions 0.3/1.0) —
see `lib/a2a/rpc.ts`, `lib/a2a/card.ts`. Inkbox A2A is a **different, proprietary**
protocol (v1.0) with cards at `inkbox.ai/a2a/{handle}/card`.

They are not interchangeable. Keep the existing endpoint as-is; treat Inkbox A2A as an
additional channel if wanted later.

Separately, `/api/a2a` is **single-tenant**: `app/api/a2a/route.ts:63` calls
`foundingUser()`, and `lib/a2a/guard.ts` authorizes one global `A2A_API_KEY`. So today
every A2A caller reaches the founder's agent regardless of slug. That contradicts the
per-user model and is worth fixing — but it is a pre-existing bug, out of scope here.

## 5. Data model

```prisma
model AgentIdentity {
  id             String   @id @default(cuid())
  userId         String
  kind           IdentityKind          // EXTERNAL | INTERNAL
  handle         String   @unique      // globally unique at Inkbox
  emailAddress   String   @unique
  phoneNumber    String?
  signingSecret  String                // per-identity; encrypt at rest
  sendingDomain  String?               // null = platform domain
  provisionedAt  DateTime?
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, kind])
}

model InboundEvent {                   // replay/dedup guard
  eventId    String   @id              // Inkbox envelope id, stable across replays
  identityId String
  receivedAt DateTime @default(now())
}
```

`ChatSession` gains a nullable `externalThreadId` so an email thread continues one
conversation.

## 6. Request paths

**External email in:**
```
Inkbox → POST /api/inkbox/webhook
  → verify signature (per-identity secret)
  → dedup on event_id
  → resolve AgentIdentity → User
  → find/create ChatSession by thread_id
  → answer({ userId, message, channel: "email" })
  → collect text (cards rendered inline)
  → inkbox.email.send(in_reply_to: message_id)
```

**Internal email in:** same, plus sender check, then `adminAnswer()`.

**Web:** unchanged.

## 7. Build order

1. `renderBlockAsText()` + brain change (pure, unit-testable, zero infra) — the card
   coexistence guarantee lands first and independently.
2. Schema + provisioning (idempotent, reconciling).
3. Webhook route: verify → dedup → route → reply.
4. Internal identity: whitelist rule + app-side check.
5. SMS/iMessage reusing the same path.

Step 1 is the piece that de-risks everything else, and it ships without touching Inkbox
at all.

## 8. Cost and operational notes

- Custom domains are $4/mo each and org-wide; the platform domain (`@inkboxmail.com`)
  costs nothing and is the sane default. Schema records `sendingDomain` so a later switch
  needs no migration.
- Two identities per user means identity count scales with signups; no documented cap was
  found, so confirm with Inkbox before a large rollout.
- Every inbound message is a model call. Rate limiting is a spend control, not just abuse
  control.
- The `blakeclaudecode` agent from this session is **unclaimed**: it can send only to
  blakemauri2@gmail.com, 5 recipients/24h. Verification lifts that.

## 9. Corrections found during code review

Three findings that change the design. All verified in the code.

### 9a. `AdminEvent` ≠ `BrainEvent`

`lib/adminBrain.ts:47-51` emits a *different* union:

```ts
export type AdminEvent =
  | { t: "text"; v: string }
  | { t: "panel"; v: string }              // reveal a dashboard panel inline
  | { t: "goal"; v: { id: string; text: string } }
  | { t: "approve"; v: IngestProposal };   // one-click ingestion approval
```

`panel` and `approve` are meaningless over email — `panel` names a dashboard section to
render in the browser, and `approve` is a button that performs a real write. So the
internal channel needs its own degradation, distinct from `UiBlock`:

| Event | Email/SMS form |
|---|---|
| `text` | as-is |
| `panel` | deep link to `/admin/chat` with the panel key |
| `goal` | confirm in prose — the write already happened |
| `approve` | **never auto-execute.** Link to the approval UI |

The `approve` rule matters: an ingestion approval arriving by email must not be
executable by replying "yes". Email is not an authenticated channel in the way a session
cookie is, and the whitelist rule protects delivery, not intent. Keep the click in the
browser where the session lives.

### 9b. Admin conversations are not persisted

`lib/brain.ts` calls `recordTurn()` in its `finally`; `adminAnswer()` persists nothing.
Over the web that is fine — history is client-side (`lib/chatStore.ts`, localStorage per
slug). Over email there is no localStorage, so **both** channels need a server-side
conversation store or every message starts cold. `ChatSession.visitorKey` with
`@@unique([userId, visitorKey])` is the right key: use the correspondent's address.

### 9c. Trust tiering is a stub — do not rely on it

`IngestionSource.classification` (`public | contact | close-friends | personal`) and
`AddressBookEntry.trust` (`public | co-worker | close-friend | personal`) exist as
columns, and `prisma/schema.prisma:429-431` says so plainly:

> The frontend still shows everything to everyone — classification is recorded, not yet
> enforced at retrieval.

Confirmed: `buildSystemPrompt(userId, query?)` (`lib/knowledge.ts:23`) takes no audience
argument, and retrieval never reads either column. The two vocabularies do not even match
(`contact` vs `co-worker`).

**Consequence for this feature.** The external agent is a *public* channel. If personal
material has been ingested on the assumption that classification gates it, opening an
email address to the world widens the audience for data that was already unfiltered on
the public web page. This feature does not create the exposure, but it does add a new
door to it.

Two honest options:
1. Ship the external agent knowing it answers from the same corpus as the public page —
   no worse than today, and no better.
2. Give `buildSystemPrompt` an audience parameter and enforce classification at retrieval
   first. That is its own feature and should not be smuggled in here.

Recommend (1) with the risk stated, and file (2) separately. What must not happen is
assuming those columns already protect anything.

### 9d. Also worth knowing

- `app/api/contact/route.ts` writes a `Contact` row and notifies nobody. Once outbound
  email exists, "email the owner on a new contact submission" is nearly free — but it is
  agent-initiated mail, so it needs its own opt-in.
- Gmail integration is **read-only** (`GMAIL_SCOPE = "...gmail.readonly"`,
  `lib/gmail/client.ts:22`); it mines sent mail for contacts and cannot send. Inkbox does
  not overlap with it.
- `README.md:333-336` warns the A2A auth refactor is mid-flight and the project may not
  typecheck. The current files look consistent (`authorize` exists in `lib/a2a/guard.ts`),
  but run a typecheck before building on that area.

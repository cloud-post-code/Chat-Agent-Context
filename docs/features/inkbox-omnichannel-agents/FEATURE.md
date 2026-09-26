# Inkbox omnichannel agents: per-user external and internal identities

## Summary
Give every `User` two Inkbox agent identities so their agent is reachable outside the
browser: an **external** identity anyone may contact (email, SMS, iMessage, A2A) that
answers from the same public brain as `/a/<slug>`, and an **internal** identity only the
account owner may contact, which answers from the admin copilot brain (`lib/adminBrain.ts`)
and can take admin actions. Web cards is unchanged; non-web channels render the same
`UiBlock` events to text instead of dropping them.

## Context: what already exists
The repo is closer to this than it looks. `lib/brain.ts` is already transport-agnostic:

- `Channel` (`lib/brain.ts:34`) is an open union `"web" | "a2a" | (string & {})`.
- `CARD_CHANNELS` (`lib/brain.ts:41`) gates cards; non-listed channels get text only.
- `lib/a2a/run.ts` is the precedent: a transport that translates brain events, with
  deliberately no second brain.
- `lib/adminBrain.ts` is the internal agent, already separate and already NDJSON.

So this feature is a channel plus an inbound transport, not a rewrite.

## Desired Behavior

### Identity provisioning
- Completing onboarding provisions two Inkbox identities for the user:
  external `<slug>` and internal `<slug>-admin` (handles are globally unique in Inkbox;
  on a 409 the provisioner appends a short discriminator and records what it got).
- Each identity's mailbox, tunnel, and webhook subscription are created together; the
  resulting handles, addresses, and per-identity signing secrets are persisted.
- Provisioning is idempotent: re-running it for a user who already has identities
  reconciles rather than duplicating, so a partial failure is recoverable.
- An account with no Inkbox configuration continues to work exactly as today; every
  Inkbox surface is additive and absent-safe.

### External agent (public)
- Anyone may email `<slug>@<sending-domain>`; the reply comes from the same
  `answer()` brain used by the web chat, scoped to that user's knowledge.
- Inbound email threads map to a `ChatSession`, so a conversation over email keeps
  context across replies the way the web chat does.
- SMS and iMessage behave the same when the identity has a phone number; when it does
  not, those channels are reported unavailable rather than silently failing.
- The external identity's mail filter stays in blacklist mode (open to all) — this is
  the public front door.

### Internal agent (owner-only)
- Only the owner's verified email may reach `<slug>-admin@<sending-domain>`. This is
  enforced **at Inkbox**, by setting the identity's `mail_filter_mode` to `whitelist`
  and creating one `exact_email` allow rule for the owner's address; mail from anyone
  else is never delivered and fires no webhook.
- The application enforces the same rule a second time on receipt: the webhook handler
  compares the verified sender against the owner address and refuses anything else,
  so a misconfigured rule at the provider cannot expose the admin channel.
- Answers come from `adminAnswer()` (`lib/adminBrain.ts`), so the owner gets the admin
  copilot — its tools, its data access — over email rather than only in the browser.
- Changing the owner's account email updates the whitelist rule; until the new address
  is verified, the old rule stands.

### Card coexistence (the hard requirement)
- Web is untouched: `/api/chat` still streams `{"t":"text"}` / `{"t":"card"}` NDJSON and
  `app/cards/Cards.tsx` still paints real cards. No change to the web wire format.
- A new renderer turns a `UiBlock` into text for channels that cannot paint it, replacing
  today's silent `continue` at `lib/brain.ts:272`. Every `UiBlock` variant and every
  `CustomElement` kind gets a text form.
- Interactive blocks degrade to an action, not a description: `contact` and `booking`
  become a link back to the web surface that can actually collect the input.
- `gallery` and `project` image URLs are rewritten to absolute URLs, since a relative
  `/api/uploads/...` is meaningless in a mail client.
- `html` blocks are reduced to their text content; model-authored markup is never
  forwarded into an email body.
- The tool-result string fed back to the model becomes channel-aware, so on a text
  channel the model is told the card was described rather than rendered and stops
  narrating UI the recipient cannot see.

### Safety and cost
- Replies are sent only in response to an inbound message that passed signature
  verification; the agent never initiates contact on its own.
- Webhook deliveries are deduplicated on the envelope `event_id`, which Inkbox
  preserves across replays, so a redelivery cannot answer twice.
- Per-identity inbound rate limiting bounds model spend, in the spirit of
  `lib/a2a/guard.ts`, and unauthenticated webhook calls are rejected before any model
  call happens.
- Outbound sends are capped per identity per day; exceeding the cap logs and drops
  rather than looping.

## Out of Scope
- Voice calls, vault-backed credentials, and A2A cross-org invitations.
- Custom sending domains (`$4/mo/domain`, org-wide DNS) — the platform domain is the
  default; the schema records a sending domain so this can land later without migration.
- Replacing the existing single-tenant `/api/a2a` endpoint. Its per-user successor is
  noted as a follow-up, not built here.

## Constraints
- Inkbox identity handles are globally unique across all organizations, so `<slug>`
  cannot be assumed available; the mapping must be stored, never recomputed from slug.
- Webhook signing secrets are per-identity, so verification must select the secret by
  the identity the delivery names.
- Inkbox MCP and the CLI act only when invoked; inbound handling requires the webhook
  path — nothing in this feature may depend on Claude "watching" a mailbox.
- Unclaimed agent accounts can send only to their overseer address, max 5 recipients
  per 24h; provisioning must surface that state rather than appearing broken.

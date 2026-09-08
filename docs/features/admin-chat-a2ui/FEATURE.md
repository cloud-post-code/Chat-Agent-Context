# Chat-first admin: the dashboard as A2UI elements

## Summary
Replace the click-driven (WIMP) admin experience as the primary surface with a chat
interface at `/admin/chat`. The assistant renders the existing admin dashboard panels as
A2UI elements inline in the conversation, takes real actions from chat, and turns
document-ingestion requests into a pre-filled one-click approval card. The classic
dashboard page stays reachable from a menu button at the top of the chat.

## Desired Behavior
- Logging in at `/admin` lands the user on the chat-first surface (`/admin/chat`)
  instead of the classic dashboard; onboarding still runs first for new accounts.
- Typing "show me my goals" (or any request naming an admin surface) renders that
  surface's full existing panel inline in the chat as an A2UI element — the same
  interactive panel the dashboard shows, with its real forms and server actions working.
- Typing "add a goal …" with the goal text creates the goal directly (real
  `AgentDirective` row) and shows the updated Goals panel as confirmation; asking to add
  a goal without saying what it is renders the Goals panel with its entry form.
- Asking to ingest content (a URL, pasted text, or a document) makes the assistant pick
  the best-matching ingestion source from the account's live `IngestionSource` catalog,
  pre-fill every field it can (source, title, text/url, classification), and render an
  approval card; one click on Approve performs the real ingestion through the existing
  ingest write path. For document files the card exposes the file picker (the one field
  a model cannot fill) with everything else pre-filled.
- A menu button at the top of the chat opens a menu of the dashboard's sections; picking
  one reveals that section's panel inline in the conversation (no navigation). The chat
  offers no switch to the classic dashboard; the `/admin/dashboard` route stays alive
  only for internal redirects (e.g. the Gmail sync callback) and old deep links.
- The starter questions stay reachable after the conversation begins: a ✦ toggle beside
  the composer reopens them, and tapping one sends it.
- Operator-only surfaces (Users) are only available to operators, in chat as on the
  dashboard.

## Scope
- New authed page `app/admin/chat/` (server component + client chat) that pre-renders
  the dashboard's existing panels and reveals them inline in chat bubbles.
- New admin brain (model tool loop) with tools: show a panel by key, save a goal,
  propose an ingestion (approval card payload).
- New authed NDJSON transport `app/api/admin/chat/route.ts` reusing the public chat's
  line protocol.
- New object-shaped server action(s) for chat-driven writes (approve-ingestion,
  save-goal) delegating to the existing `lib/customIngest.ts` / `lib/directives.ts`
  write paths.
- Redirect change: successful login / authed `/admin` goes to `/admin/chat`.

## Non-Goals
- No rebuilding or restyling of any existing panel; panels render as-is.
- No removal of the classic dashboard, its routes, or its deep links.
- No changes to the public visitor chat, the A2UI card catalog, or the A2A interface.
- No persistence/replay of admin chat transcripts (ChatSession stays visitor-only).
- No chat-driven edits behind the ingestion edit password (`isEditAuthed()` surfaces);
  those keep their existing gate and pages.
- No new ingestion source types; the chat only routes to sources that already exist.

## Scenarios
- Happy path: "show me my goals" → Goals panel appears inline; the user adds a goal in
  the panel's entry form; the row persists.
- Direct action: "add a goal: always mention our referral discount" → goal saved
  without further clicks; assistant confirms and shows the Goals panel.
- Ingestion happy path: "ingest this article <url>" → approval card with best source
  selected, url + title + classification pre-filled → Approve → item appears in that
  source's tab (marked `ingest:<sourceKey>`).
- Ingestion with a file: "I want to ingest a PDF" → approval card for the best
  file-accepting source with the file picker exposed → user picks the file → Approve.
- Ambiguous surface: request matches no known panel → assistant answers in text and
  offers the menu; nothing breaks.
- Unauthenticated hit of `/admin/chat` or the chat API → redirect to `/admin` / 401.
- Non-operator asks for the Users panel → refused in chat; the tool never exposes it.

## Constraints
- Reuse the existing panels exactly (`DirectivesPanel`, `GenericIngestPanel`,
  `KnowledgePanel`, `GraphPanel`, `AnswersPanel`, `A2uiPanel`, `ContactsPanel`, …) — the
  chat reveals pre-rendered server nodes; it must not fork panel markup.
- Panel keys must be derived from the live data (`IngestionSource` rows +
  `contentTabs.ts` constants), not hardcoded, so custom sources work in chat.
- The model tool loop must follow `lib/brain.ts` conventions: injectable model client
  (offline-provable), bounded iterations, NDJSON events.
- Ingestion approval must call the existing write paths in `lib/customIngest.ts` with
  the source's `ingestFormsFor()` field set; classification defaults from the source
  row.
- Chat-driven writes re-check auth server-side on every call (same as existing actions).
- Keep the dashboard's theme (`TenantThemeStyle`) on the chat page.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

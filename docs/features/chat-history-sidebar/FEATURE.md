# Feature — Chat history sidebar on the public chat page

## Problem
The public agent page (`app/Chat.tsx`, served at `/a/[slug]`) holds exactly one
conversation, in React state. Reloading the page or starting over loses the
thread, and a visitor cannot look back at an earlier conversation or run two
conversations side by side.

## Desired behavior
- The chat page grows a sidebar listing the visitor's past chats with this
  agent, stored client-side in `localStorage`, scoped per agent slug (the same
  browser can talk to several agent pages without mixing histories).
- Each chat shows a title (the first user message, truncated) and can be
  opened, continued, or deleted from the sidebar.
- A "New chat" action starts a fresh conversation with a fresh session id.
- Each chat keeps its own stable session id, sent as `sessionId` on
  `/api/chat` calls, so the admin Activity tab keeps grouping turns into one
  `ChatSession` per conversation (previously one id per browser tab).
- Messages — including rendered cards — persist as the conversation streams,
  so a reopened chat renders exactly what the visitor saw.
- The sidebar is an overlay toggled from the page (works on mobile widths),
  themed with the tenant's existing CSS variables, and hidden entirely for a
  visitor with no saved chats who hasn't started one.
- Storage is bounded (oldest chats dropped beyond a cap) and every
  localStorage access is failure-tolerant: private mode or a full quota never
  breaks the chat itself.

## Scope
- New module `lib/chatStore.ts`: pure functions over a Storage-like interface
  (list, load, save, delete, cap enforcement, id/title derivation).
- `app/Chat.tsx`: sidebar UI, chat switching, persistence wiring.
- No server or schema changes.

## Out of scope
- Server-side fetch of history (Activity data stays admin-only).
- Cross-device sync, renaming chats, search.

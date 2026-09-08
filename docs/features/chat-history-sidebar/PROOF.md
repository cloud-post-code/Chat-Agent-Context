# Proof Plan — Chat history sidebar

## Definition Of Done
- `lib/chatStore.ts` exists and every behavior below holds, exercised through
  the real module with an in-memory Storage stub (no browser, no DB).
- `app/Chat.tsx` uses the module for the sidebar (checked by the gate's
  typecheck/lint plus a source-level assertion in the proof).

## Primary Proof
Type: unit/integration (the repo's `proof.ts` pattern, offline)

Command:
```bash
npx tsx docs/features/chat-history-sidebar/proof.ts
```

Expected evidence — all assertions PASS:
1. **Empty start** — listing chats for a slug with nothing stored returns `[]`
   and never throws.
2. **Save & list** — saving a chat makes it appear in the index with a title
   derived from the first user message (truncated), and newest-first ordering
   by update time.
3. **Per-slug scoping** — chats saved under slug A are invisible under slug B.
4. **Round trip with cards** — messages persisted with card blocks load back
   deep-equal, so a reopened chat renders what the visitor saw.
5. **Update in place** — re-saving the same chat id updates its messages and
   bumps it to the top of the index without duplicating the entry.
6. **Delete** — deleting a chat removes both its index entry and its message
   payload key.
7. **Cap enforcement** — saving more than the cap drops the oldest chats'
   index entries and payloads.
8. **Corruption tolerance** — garbage JSON in the index or a payload yields
   `[]` / `[]`, not a throw.
9. **Wiring** — `app/Chat.tsx` imports the store module (source check), so the
   UI runs through the proven code path.

## Secondary checks (not proof)
- Gate: `~/.claude/scripts/gate` (tsc + eslint clean).
- Manual browser verification on the dev server.

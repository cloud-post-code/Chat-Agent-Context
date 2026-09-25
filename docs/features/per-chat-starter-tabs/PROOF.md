# Proof Plan — Per-chat starter tabs

## Definition Of Done
- `pickStarters` is deterministic in the chat id; two chats with different ids
  can get different tabs, and over many chats every question in the pool is
  shown; a pool no larger than the row comes back whole and in order; blank and
  repeated questions are dropped; `count` 0 gives `[]`.
- Goal-led: with three goals in the pool, every chat's three tabs come from
  three distinct goals and never a general question; with two goals, every chat
  shows one question from each goal plus one general, and each goal leads in
  some chat; with one goal, that goal gets two tabs; with no goals, the three
  rotate over the general pool.
- Generation asks for `STARTER_POOL_COUNT` `{label, question, goal}` items and
  shows the goals numbered; a goal number becomes that goal's text on the row, a
  goal written out is accepted when it matches, and 0 / unknown is `""`; nine
  offered items become nine rows.
- `starterChipsFor` returns every enabled row in order with its goal, not only
  three.
- `saveCannedAnswer` stores a trimmed goal; the Presets panel renders a Goal
  select listing the account's goals, and the pool copy.
- The rendered home screen, given a pool of nine and two different chat ids,
  shows three tabs each, and the two sets differ for at least one pair of ids
  out of a handful; the same id renders the same tabs twice (server/client
  agreement).
- The public page mints the first chat id on the server.
- The database returns to baseline.

## Primary Proof
Type: integration (the pure picker plus real generation/save/read paths against
the database with an injected model client, and server renders of the real
`Chat` and `AnswersPanel` components).

```bash
npx tsx docs/features/per-chat-starter-tabs/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`). Creates throwaway
users prefixed `perchattabsproof` and deletes them.

Expected evidence: every line `PASS`, final line `All proof assertions passed`,
exit 0.

Secondary: `npx tsc --noEmit`, `npx next lint`, and the four older starter
proofs (starter-tabs, personalized-starter-questions,
regenerate-starter-questions, remove-default-starter-questions) still green.

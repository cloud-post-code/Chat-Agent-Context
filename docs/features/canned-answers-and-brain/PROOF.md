# Proof — Canned answers in front of the model, and a brain the route doesn't own

## Definition Of Done
- A matching canned question is answered from the database with **zero**
  Anthropic requests, and the served text is byte-identical to the stored answer.
- A canned answer carrying `cardTool` still emits a hydrated UI card.
- Any non-match (different text, `enabled = false`, empty answer) reaches the
  model exactly once, as it does today.
- The model path — retrieval, streaming, the tool loop, A2UI cards — still works
  after being moved out of the route.
- Canned turns are recorded in Activity like model turns.
- No regression in chunk/entity counts, and the database returns to baseline.

## Primary Proof
Type: integration (internal contract — the brain is the new seam this feature
creates, and the whole point of the feature is that one branch of it makes no
network call)

Command:
```bash
npx tsx docs/features/canned-answers-and-brain/proof.ts
```

Runs against local dev Postgres (`blake-pg`, `DATABASE_URL` from `.env`); the
script loads `.env` itself. It seeds throwaway `CannedAnswer`, `Project`, and
`ChatSession` rows (ids prefixed `cannedproof`), drives the real `answer()`
brain, asserts, then deletes everything it made.

### Assertions (all must pass)
1. **Normalization** — `normalizeQuestion` folds case, collapses internal
   whitespace, trims, and strips trailing `?`/`.`/`!`; two questions that differ
   in wording still produce different keys.
2. **Canned hit costs nothing** — a message matching a seeded canned question
   yields the stored answer verbatim and the injected Anthropic double records
   **0** calls. This is the assertion the feature exists for.
3. **Match is punctuation/case/space insensitive** — `"  what ARE your   recent
   projects  "` hits the same row. Still 0 calls.
4. **Canned card hydrates** — a canned row with `cardTool = "show_projects"`
   emits a `card` event whose block is `{type:"projects"}` and contains the
   seeded `cannedproof` project, proving it went through the real `hydrate()`
   and the real database, not a stored blob.
5. **Near-miss falls through** — a longer question that merely contains the
   canned wording reaches the model: exactly **1** call, and the text is the
   double's output, not the canned text.
6. **Disabled falls through** — `enabled = false` with a filled answer: 1 call.
7. **Empty answer falls through** — `enabled = true`, `answer = ""`: 1 call, and
   the visitor gets model output rather than an empty response.
8. **Model path still renders cards** — the double scripts a `tool_use` for
   `show_projects` on turn 1 and text on turn 2; the brain runs the real tool
   loop and emits both a card and the closing text. Proves the extraction from
   `route.ts` preserved A2UI.
9. **Canned turns are recorded** — after a canned answer, the `cannedproof`
   session holds a `user` message with the question and an `assistant` message
   with the canned text. The brain awaits this write before the stream ends, so
   the assertion is not racy.
10. **`hits` counts served answers only** — serving increments `hits` by exactly
    1; a fall-through leaves every row's `hits` untouched.
11. **Channel does not change the answer** — the same canned question on
    `channel: "web"` and on a non-web channel returns identical text.
12. **Colliding saves merge, never throw** — `matchKey` is unique, so retyping
    an existing question through `saveCannedAnswer` must not surface a raw
    Prisma constraint error in the admin form. Saving a new row onto an existing
    key writes into the owning row; editing one row's question onto another's
    key collapses the two, the way a Graph-tab entity rename does.
13. **Cleanup** — `CannedAnswer`, `Project`, `ChatSession`, and `ChatMessage`
    counts return to their pre-run baseline.
14. **A saved card stays on screen** — the real `CardFields` is mounted in a
    real DOM and driven the way React drives a row around a form action: Blake
    picks a card, the form resets (React resets a form once its action
    resolves), and the row re-renders as it is now stored. The card and its
    options are still shown, and still shown after a second save that changes
    nothing — the case with no re-render to repair the fields afterwards.
    Without this, a saved card came back as "No card" and the next save wrote
    that emptiness to the database.

Expected evidence: every assertion prints `PASS`, followed by
`All proof assertions passed`; exit code 0.

### Secondary guards (not proof)
- **Route is thin** — `app/api/chat/route.ts` no longer contains an
  `@anthropic-ai/sdk` import, a tool catalogue (`input_schema`), or `hydrate`,
  and does import `lib/brain`. A source check, so it is a guard, not the proof.
- `npx tsc --noEmit` clean.
- Prisma migration applies with `provider = "postgresql"` intact.

## Environment And Data
- Local dev Postgres container `blake-pg` on port 5433, `DATABASE_URL` in `.env`.
- The `CannedAnswer` migration must be applied before the run.
- Assertion 15 renders in `jsdom` (devDependency). It runs last and installs
  browser globals for the rest of the process, so nothing above can see them.
- No `ANTHROPIC_API_KEY` is required: the canned path makes no call, and the
  model path is driven by an injected double.

## Anti-Gaming Constraints
- The Anthropic double is injected at the **outermost provider boundary only**
  (the client object). Retrieval, prompt assembly, the tool loop, `hydrate()`,
  and `recordTurn` all run for real.
- "Zero API calls" is asserted by counting calls on the double, never by reading
  source or trusting a comment.
- Card assertions read the hydrated block's contents, so a canned answer cannot
  pass by storing a pre-baked card payload.
- The proof must not import from `app/api/chat/route.ts`; if the brain still
  lived there, the import of `lib/brain` would fail.
- Assertion 15 reads the live DOM values of the real `CardFields` after real
  React commits, so a component that merely renders the right markup once — the
  shape that produced the bug — cannot pass it.

## Red Expectation
Before implementation the script fails at import time: `lib/brain.ts` does not
exist (and `prisma.cannedAnswer` is undefined).

## Repo Safety Gate
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The admin "Answers" tab is not driven by this script (admin login required).
  Manual: open the tab, fill a starter's answer, click that chip on the public
  site, confirm the stored text appears instantly and `hits` increments.

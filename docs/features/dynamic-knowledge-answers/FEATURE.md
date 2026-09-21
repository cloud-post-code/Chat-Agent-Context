# Dynamic knowledge answers

## Why

A recorded session on a nail salon's agent: the Content tab held the full price
list ("Acrylic Short Nails Full Set. $65", forty-odd rows), yet "show me all
services and prices" was answered with "I don't have the complete pricing list —
give us a call", and "Can I do mani pedi combo for less" with "I don't have
specific combo pricing". The knowledge was there; the model never saw it.

Three causes, all in how one question becomes one prompt:

1. **A menu is saved one row per chunk** (`lib/onboarding/services.ts`), and
   retrieval served the top six chunks. Six rows of forty answers nothing about
   "all services", "the cheapest pedicure" or a combo.
2. **Matching was literal.** Rows never contain the word "services" (their
   source title does), "mani" is not "manicure", "calluses" is not "callus",
   "fill" is not the token "fill-in". Tiny chunks also lose the vector half of
   the blend to long prose.
3. **One shot, then a rule to give up.** The prompt carried a single retrieval
   and the rule "If you don't know, say so and point them to contact" — so a
   near miss became a deflection.

## Behavior

- **Small sources are served whole.** When any chunk of a multi-chunk origin is
  a seed and the origin's text is ≤ 5000 chars, the whole origin goes into the
  prompt as one ordered block. Long documents stay chunk-ranked. The seed limit
  counts blocks, so a menu filling the top ranks does not shut other sources
  out.
- **Forgiving lexical matching** (`lib/retrieval/search.ts` only — `tokenize()`
  is untouched because the stored local embeddings depend on it): plurals,
  `-ing` and trailing `e` fold together; hyphenated tokens also count as their
  parts; a stem of ≥ 4 chars matches a longer stem it prefixes (mani→manicure).
- **Source titles are scored**, with idf computed across origins rather than
  chunks, so "services" finds the Services source.
- **`search_knowledge` tool** (`lib/brain.ts`): the model can query the
  knowledge base again in its own words. The result returns to the model; no
  card is drawn. The prompt lists the knowledge sections (title + passage
  count) and instructs the model to search before saying it doesn't know.
  Scripted turns (an owner-approved canned answer) get neither.
- **Answer rules** (`lib/knowledge.ts`): lead with what is known; when the exact
  thing isn't listed, give the closest related facts and say which part isn't
  listed; asked for everything, give the full list. Inventing facts stays
  forbidden.
- `max_tokens` 1024 → 2048 so a full price list is not cut off mid-menu.

## Not in scope

Changing chunking or the onboarding write path, embeddings, the card catalog,
or re-indexing existing tenants (none is needed — this is read-side only).

## Files

- `lib/retrieval/search.ts` — stems, title scoring, whole-origin blocks.
- `lib/brain.ts` — `search_knowledge` tool, LOOKING THINGS UP prompt section.
- `lib/knowledge.ts` — answer rules.
- `docs/features/dynamic-knowledge-answers/questions.ts` — the test question set.

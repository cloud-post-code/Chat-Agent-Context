# Proof — dynamic knowledge answers

## Primary proof command

```bash
npx tsx docs/features/dynamic-knowledge-answers/proof.ts
```

Exit 0 and `All proof assertions passed`. Offline: no model call, no network.

## What it proves

Seeds a throwaway tenant through the real onboarding write path
(`saveKnowledgeRecord`, one chunk per menu row — what a crawl leaves), among
other sources as noise, then runs the question set in `questions.ts`.

| Assertion | Guards |
|---|---|
| each of the 14 questions: the real `buildSystemPrompt` carries the facts it needs | retrieval — the recorded failures ("all services and prices", "mani pedi combo"), plurals, slang, hyphenated tokens, comparisons, non-menu facts winning over the menu, profile facts |
| the prompt stays under 16k chars for a narrow question | whole-origin expansion does not flood the prompt |
| `search_knowledge` is offered to the model | the tool is wired |
| a search returns matching knowledge as the tool result | the tool runs real retrieval |
| a search draws no card; closing words reach the visitor | the tool loop is not disturbed |
| the prompt says to search before "don't know", and to give related facts | the behavior rules survive edits |
| every row the proof created is gone | self-cleaning |

The model is doubled at the provider boundary only; retrieval, prompt assembly
and the tool loop are real.

## Secondary: live answer eval (not the primary proof)

```bash
npx tsx docs/features/dynamic-knowledge-answers/proof.ts --live
```

Same seed, real model. Each answer must contain the expected facts
(`answer` in `questions.ts`) and match none of `DEFLECTIONS`. Costs ~14 model
calls; model output varies, so treat a single miss as a prompt to read the
answer, not as a hard gate. Add a question here whenever a bad answer is seen
in the wild.

## Red/green

Red before the change: 10 failures — "show me all services and prices" carried
none of the menu, five more questions missed their facts, and all
`search_knowledge` assertions failed.

Green after: all assertions pass; live eval 14/14.

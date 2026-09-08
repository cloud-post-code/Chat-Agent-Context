# Proof — starter questions can show A2UI cards

## Primary proof command

```bash
npx tsx docs/features/starter-questions-a2ui-cards/proof.ts
```

Exit 0 and `All proof assertions passed`.

## What it proves

Drives the real `lib/brain.answer()` over seeded `CannedAnswer` and `UiCard`
rows for a throwaway tenant. The Anthropic client is injected as a double at the
outermost provider boundary **only** — retrieval, prompt assembly, the tool loop
and `hydrate()` all run for real — so "the model was reached" is proven by
counting calls on the double rather than by reading source, and "the owner's
wording survives" by inspecting the system prompt the double received.

| Assertion | Guards |
|---|---|
| a starter question with no attached card reaches the model | the regression itself |
| and can therefore render an A2UI card | the point of the feature |
| the owner's approved wording is handed to the model verbatim | prose is not silently regenerated |
| the model is told to speak it as written | the `APPROVED ANSWER` instruction survives edits |
| a row that already carries its own card still costs zero model calls | presets stay a cost saver |
| and still serves the owner's exact answer / renders that card | no behavior change on the attached-card path |
| on a channel that cannot draw cards the row still short-circuits | voice/A2A do not start paying for a model call |
| the canned hit is still recorded | Presets usage numbers stay honest |
| every row the proof created is gone | the proof is self-cleaning |

## Red/green

Red before the change: the first four assertions fail with `calls=0` and
`cards=[]` — the canned row returned its prose and stopped.

Green after: all assertions pass. Reaching green also required fixing a
check-then-create race in `lib/db.ts` that the proof surfaced (see FEATURE.md).

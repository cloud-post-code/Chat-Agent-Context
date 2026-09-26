# Starter questions can show cards

## Why

A starter question is a `CannedAnswer` row (see `lib/starterQuestions.ts`), and
`lib/brain.answer()` served *any* canned row by yielding its prose and
returning. The model, its tool list and the card tools were never
reached. So the five questions a visitor is most likely to click — the ones on
the chip row — were the only questions that could never produce a card, however
well one fit. A card could only appear if the owner had hand-attached one in the
Presets tab's per-row dropdown, and the auto-drafter is explicitly forbidden
from doing that.

## Behavior

- A canned row that **already carries a card** (`cardTool` set) still
  short-circuits the model entirely: same prose, same card, zero model calls.
  Presets stay a cost saver.
- A canned row with **no card**, on a channel that can draw cards, now runs the
  model — with the owner's approved answer injected into the system prompt under
  an `APPROVED ANSWER` heading instructing it to speak that text as written. The
  model's only added job is choosing a card when one genuinely fits.
- On a channel that **cannot draw cards** (voice, and anything outside
  `CARD_CHANNELS`) a canned row short-circuits as before — there is nothing to
  gain from a model call.
- The canned hit counter still increments on every path, so the Presets tab's
  usage numbers stay honest.

## Not in scope

Changing which cards exist.

## Files

- `lib/brain.ts` — the canned short-circuit condition and the `script` argument
  to `runModel`.
- `lib/db.ts` — `getProfile`/`getPersonaConfig`/`getThemeConfig` upsert rather
  than find-then-create. Surfaced by this feature's proof: the three run
  concurrently inside `buildSystemPrompt`, so on an account whose rows did not
  exist yet they raced and one threw a unique-constraint error, failing the
  visitor's entire answer.

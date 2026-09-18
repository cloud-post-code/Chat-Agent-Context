# Proof Plan

## Definition Of Done
- `filingSeconds` turns counted work into a whole-ten-second estimate that
  grows with origins and sources by the pace interval and includes the tail
  stages.
- `etaFor` reports remaining seconds as of now, floors at zero, and is absent
  once the job is done or failed.
- The filing activity line states the estimate in words.
- `ActivityStream` renders the countdown when given an ETA, omits it
  otherwise, and the displayed number decreases as the clock advances.

## Primary Proof
Type: unit + component (no server)

Command:
```bash
npx tsx docs/features/onboarding-filing-eta/proof/filing-eta.ts
```

Prints `PROOF PASS` or exits 1. Asserts the estimate math against the pacing
formula, the wire ETA's floor and lifecycle, the wording of the log line, a
static render with and without an ETA, and a jsdom mount whose countdown
falls as `Date.now` advances and flips to the over-estimate wording past
zero.

## Secondary guards
- `npx tsc --noEmit` and `npm run lint` clean.
- `npx tsx docs/features/guided-onboarding/proof/activity-stream-retention.ts`
  and `npx tsx docs/features/guided-onboarding/proof/chat-transcript.ts`
  still pass (the feed renders unchanged when no ETA is present).

## Anti-Gaming Constraints
- The estimate must come from counts the pass actually iterates, not a
  constant; the proof checks the formula's dependence on each input.
- The countdown must derive from elapsed time, not advance on a timer
  regardless of the estimate.

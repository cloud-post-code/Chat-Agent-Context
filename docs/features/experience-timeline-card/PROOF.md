# Proof Plan — A2UI experience timeline card

## Definition Of Done
- Asking the bot about Blake's background renders a timeline card, not a
  paragraph of recited job titles.
- The card shows every stored role with its company, dates and description, in
  the order the Experience editor holds them.
- A long history folds; the visitor can unfold it.
- An empty, blank or corrupt `Profile.experience` produces an empty state, never
  an error and never a half-card.
- The model is told the tool exists and told to leave the facts to the card.

## Primary Proof
Type: integration (real Postgres, real brain, real component in a real DOM; no
Anthropic calls, no network)

Command:
```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/experience-timeline-card/proof.ts
```

The `--tsconfig` flag is required, not incidental: the app's `tsconfig.json`
sets `"jsx": "preserve"` because Next compiles the JSX itself, so under `tsx`
`Cards.tsx` would emit `React.createElement` against a `React` binding it never
imports. The proof-local tsconfig turns on `"jsx": "react-jsx"` for this run
only.

Expected evidence: `All proof assertions passed`, exit 0. 30 assertions.

### Assertions

**1. The hydrator** (real Postgres, Profile singleton loaded with a fixture)
1. `experienceTimelineBlock()` returns a `timeline` block.
2. It carries all five fixture roles.
3. **It preserves stored order.** The fixture is deliberately out of
   chronological order and uses four different date formats (`2019–2021`,
   `2023 – present`, `Summer '22`, `Jan 2018 - Mar 2018`). No sort can
   reproduce that order, so this fails the moment anyone adds one.
4. Every field survives — role, company, dates, description.
5. `Profile.experienceSummary` rides on the block.
6. An empty history hydrates an empty timeline.
7. **Malformed JSON degrades to empty rather than throwing.** `experience` is a
   free text column that has held hand-edited JSON and resume-parser output.
8. Entries with missing fields are trimmed; entirely empty ones are dropped.

**2. Wiring into the chat**
9. `show_timeline` is in `CARD_TOOLS`, so a canned answer can draw it.
10. A canned answer naming `show_timeline` hydrates a card through the real
    `answer()` → `hydrate()` path, with no model in the loop.
11. The card that reaches the transport carries the roles — not an empty shell.
12. `show_timeline` is in the tool list the brain hands the model, observed by
    injecting a `ModelClient` that records `params.tools` and returns nothing.
13. Adding it did not displace `show_projects` / `show_gallery` /
    `show_contact_form`.
14. The system prompt names `show_timeline`.
15. The prompt tells the model to leave roles, companies and dates to the card.

**3. The card on screen** (jsdom + `act`, the real `Cards` component)
16. Headed "Experience".
17. The summary is rendered.
18. **A role, its company AND its dates are all on screen.** Dates are the field
    a renderer most easily drops, and the block looks identical either way.
19. The description is rendered.
20. One marker per visible role, each `aria-hidden` — the dots are decoration,
    and a screen reader should not read four bullets with no text.
21. **A five-role history folds**: the fifth role is absent from the collapsed
    render. This is the one that catches a long career pushing the conversation
    off the screen.
22. The fold control says how many roles are behind it ("1 earlier role").
23. Clicking it reveals them.
24. Unfolded, it offers to fold back.
25. A four-role history has no fold control at all.
26. An absent summary renders nothing, not an empty italic line.
27. An empty history renders "No experience added yet".

**Cleanup** (28–30): canned rows returned to their prior count, Profile restored
to its prior `experience` and `experienceSummary`.

Secondary guards: `npx tsc --noEmit`, `npx next lint`,
`$HOME/.claude/scripts/gate`.

## Red Expectation
Verified red by `git stash`-ing the five source files and re-running:

```
Proof run errored: TypeError: (0 , import_cards.experienceTimelineBlock) is not a function
```

## Environment And Data
- Local Postgres (`blake-pg`, port 5433). The proof loads `.env` itself.
- **The Profile singleton is mutated** — it is the only place experience lives —
  and restored in `cleanup()`, with assertion 30 checking the restore. Every
  other row this writes is prefixed `tlproof`.
- `VOYAGE_API_KEY` and `OPENAI_API_KEY` are deleted from the environment before
  the imports, so `buildSystemPrompt`'s query embedding uses the local hashed
  embedder and the run makes no network call. Nothing here asserts on retrieved
  content, so the substitution costs nothing.
- Profile writes go straight to the row rather than through
  `saveProfileBasics`, which would reindex — an embedding request and an
  extraction call per write, for text the proof deletes seconds later.

## Anti-Gaming Constraints
- Assertion 3's fixture must stay out of chronological order and in mixed date
  formats. Sorting it into a sensible order would make the assertion pass
  against a hydrator that sorts, which is the behavior the feature rejects.
- Assertion 21 must stay a *negative* check on the collapsed render. Asserting
  only that the toggle exists passes on a card that draws all fifteen roles and
  offers a pointless button.
- The component must be mounted and clicked, not string-matched as source.
  Assertions 16–27 are all reads of `container.textContent` after a real render.
- Assertion 10 must go through `answer()`, not call `hydrate()` directly — the
  point is that the tool name survives the whole canned path.

## Manual Gaps
- **Rendered and screenshotted, but not clicked through in the running app.**
  The card was server-rendered against the site's real theme CSS
  (`themeCssVars()` + `themeOverrideCss()` off the live Profile row) and
  screenshotted in headless Chrome, which is how the dot color bug below was
  caught — jsdom does not execute CSS, so all 27 functional assertions passed
  against an effectively invisible timeline. What is still unverified is the
  card inside a real chat bubble at real widths, and the Experience editor that
  feeds it, which is behind the admin password Claude does not enter.

  > **Caught by that screenshot, not by the proof:** the dot was
  > `background: var(--primary)`, and `lib/theme.ts` lets `surface` double as
  > `--primary` — so on the default palette it painted a navy dot onto a navy
  > card and the timeline read as an indented list. It now uses
  > `--accent-on-bg-soft`, which `readableOn()` derives against this exact
  > surface. **No assertion here would catch a regression of this.** Color
  > contrast is not observable from `textContent`, and asserting on an inline
  > style string would pin the implementation without proving the result.
  > A screenshot diff is the honest test and this repo has no harness for one.
- **The model's own choice to call the tool is unverified.** Assertion 12 proves
  it is offered and 14–15 prove it is explained; whether Haiku actually reaches
  for it on "what's your background?" is a live model call this proof
  deliberately does not make.
- The A2A channel will emit the timeline block as a `data` part with no special
  handling, same as every other card. Not exercised here.

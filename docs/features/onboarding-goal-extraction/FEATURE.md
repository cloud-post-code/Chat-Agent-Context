# Feature — Onboarding derives the agent's goals

## What
After a guided onboarding run finishes extracting a business, the tenant's
chatbot should already know what it is *for*. Today onboarding fills the agent
with knowledge (services, team, testimonials, hours) but leaves the **Agent
Behavior → Goals** tab empty, so a freshly onboarded agent answers questions
accurately and steers nowhere. The owner has to guess what a good goal looks
like and type it from scratch.

This stage reads the pages the crawl already loaded and writes a short set of
goals — the outcomes this specific business wants from a visitor conversation —
as real `AgentDirective` rows of kind `"goal"`. They land live, so they reach
the system prompt through the existing `goalsPromptSection` with no further
action, and they are ordinary rows the owner can edit, disable, or delete on
the tab that already exists.

A dentist's site yields "Get visitors with a dental problem to book an
appointment"; a consultancy's yields "Get qualified prospects to request a
discovery call". The goals are grounded in the site — never a generic list.

## Behavior

### Extraction (`lib/onboarding/goals.ts`)
Follows the sibling-extractor shape (`services.ts` is the closest precedent):
a system prompt, a sanitizer, and one entry point with an injectable model seam.

- **Corpus** — the pages the knowledge stage has already loaded (home, extras,
  and the service/booking pages discovered for the services stage). No new
  crawling: goals are a reading of what was already fetched, so the stage costs
  one model call and no page loads.
- **Signals given to the model** — alongside the page text, the extraction is
  told what the run actually found: whether the business takes appointments
  (booking is on by default), and which knowledge categories produced content.
  A goal about booking a call is only useful if this tenant books calls.
- **Prompt rules** — each goal is one outcome the *business* wants from a
  visitor conversation, phrased as a directive to the agent, written in the
  business's own vocabulary for what it sells. Never invent an offering the
  pages do not describe; never emit generic assistant behavior ("be helpful",
  "answer accurately") — those are the agent's job already, not goals.
- **Cap** — at most 5 goals, each at most 200 characters. A short, sharp list
  the owner will actually read beats a wall the model pads out.
- **Sanitizer** — `sanitizeGoals` enforces the caps, trims, drops blanks, and
  de-duplicates case-insensitively. Never throws on a junk shape (returns an
  empty list), matching `sanitizeServices`.

### Persistence
- Goals are written through the existing `saveDirective(userId, {kind:"goal"})`
  — the same path the admin form and the admin-chat `save_goal` tool use. No
  new table, no new write path.
- **Seeding is additive and never overwrites the owner's own work.** The rule
  matches the booking-form precedent: the stage seeds only when the tenant has
  **zero goals**. A tenant who already wrote goals (or re-onboards after
  editing) keeps exactly what they have, and the run reports that it left them
  alone.
- Rows are created `enabled: true` with ascending `order`, so they take effect
  immediately and read in the model's stated priority.

### Job wiring (`lib/onboarding/jobs.ts`)
- Runs at the **end of the knowledge stage**, after the extractors and after
  the graph pass — it is a reading of the whole run, so it needs the run to be
  over.
- **Best-effort**, like the graph pass: a failed goals call logs honestly and
  leaves `phase: "done"`. Knowledge already saved must never be lost to it, and
  onboarding must never fail because goal-writing failed.
- Reports into the job payload as `job.goals` (`GoalsReport`), and logs a real
  line per outcome: the goals written, or that existing goals were kept, or
  that nothing was derived.

## Boundaries
- `lib/onboarding/goals.ts` owns the prompt, sanitizer, and seeding; `jobs.ts`
  gains a thin call and log lines. No changes to `lib/directives.ts`,
  `lib/knowledge.ts`, the prompt renderers, or the Goals admin panel — the tab
  already lists, edits, toggles, and deletes these rows.
- No new dependency; no new crawling; no schema change.

## Out of scope
- Rules (`kind: "rule"`) — hard constraints are the owner's to state, and a
  model inferring a constraint from a website would invent policy.
- A review/confirm step in the onboarding UI for the drafted goals; they land
  live and are editable on the existing tab.
- Re-deriving goals later from chat transcripts or performance.
- Per-goal analytics (whether a conversation achieved the goal).

## Implementation Routing
Required skills: none beyond repo conventions — backend TypeScript library
code in the established onboarding-extractor shape; no UI change.

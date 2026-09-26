# Feature — Agent Behavior: Goals and Rules pages

## What
Fill in the two placeholder sub-tabs of the admin **Agent Behavior** section —
**Goals** and **Rules** — so Blake can write, edit, toggle, and delete short
directives that are injected into the chatbot's system prompt.

- **Goals** — what the chatbot should steer conversations toward: the outcomes
  Blake wants from a visitor chat (e.g. "Get interested visitors to book a
  call", "Surface my agent work to technical visitors").
- **Rules** — hard rules the chatbot must follow regardless of what a visitor
  asks (e.g. "Never share my phone number", "Always answer in English").

Both tabs already exist as keys in `AGENT_TAB_KEYS`
(`app/admin/contentTabs.ts`) and render empty placeholders in
`app/admin/dashboard/page.tsx`. This feature gives them storage, an editor,
and a prompt hookup.

## Data model
One table for both kinds — the pages are the same shape and differ only in
how the prompt uses them:

```
AgentDirective {
  id        String   @id @default(cuid())
  kind      String            // "goal" | "rule"
  text      String            // the directive, one sentence or short paragraph
  enabled   Boolean  @default(true)
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## Behavior
### Admin (both tabs, one shared panel component)
- List existing directives of the tab's kind, ordered by `order`, then
  `createdAt` — same ordering rule as canned answers.
- Add one at a time via a always-present blank form at the bottom (the
  ExperienceEditor / AnswersPanel pattern).
- Each row: editable text, a Live checkbox (`enabled`), Save, Delete.
- Saving a blank text is a no-op create / leaves an existing row unchanged —
  a blank directive must never reach the prompt.
- Each tab keeps its existing intro blurb explaining what belongs there.

### System prompt (`lib/knowledge.ts` → `buildSystemPrompt`)
- Enabled goals render as a `GOALS` section (one `- ` bullet per goal) placed
  before the `RULES` section, with a one-line instruction that these are the
  outcomes to steer toward — naturally, never pushy.
- Enabled rules render as extra bullets appended to the existing `RULES`
  list, after the built-in rules — Blake's hard constraints sit beside the
  ones the site always enforces.
- Zero enabled goals → no `GOALS` heading at all (a bare heading the model
  tries to honor is worse than none — same principle as the persona block).
- Zero enabled rules → the RULES section is exactly what it is today.
- Disabled rows are invisible to the prompt.

## Boundaries
- Logic lives in `lib/directives.ts` (CRUD + pure prompt renderers) so it is
  provable offline; `app/admin/actions.ts` gets thin auth wrappers; the panel
  is a server component in `app/admin/DirectivesPanel.tsx` shared by both
  tabs.
- No AI drafting, no reordering UI, no import/export — smallest change that
  makes the two placeholder tabs real.
- No changes to canned answers, cards, retrieval, or persona.

## Out of scope
- Per-goal analytics (did the chat achieve the goal).
- Rule enforcement outside the prompt (no output filtering).
- Drag-to-reorder; `order` exists in the schema for later but the UI appends.

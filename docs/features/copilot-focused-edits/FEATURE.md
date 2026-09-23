# Copilot focused edits: the copilot makes the change, the admin sees only that slice

## Summary
When the admin asks the copilot at `/admin/chat` for a settings change it can work out,
the copilot prepares the change itself and renders only the affected slice of the panel
inline, pre-filled with the new value. Clicking Save in that slice persists it. Today it
refuses ("I don't have a function to directly change theme settings") and opens the whole
Theme panel for the admin to edit by hand. This pass covers theme colors.

## Desired Behavior
- "Can you change the accent color to be the color of the name" → the copilot resolves
  "the color of the name" to the current value of the `text` role (the page headline —
  the owner's name — has no color of its own and renders in `--text`), and shows a
  focused color editor for the Accent role: swatch + hex field pre-filled with that
  value, the current value beside it, a small preview, and a Save button. The full Theme
  panel is not shown.
- The copilot knows the account's current theme colors (every role in `COLOR_ROLES`,
  stored value or fallback), so it can resolve references to existing colors and
  concrete requests ("make the background #faf3ee").
- Save persists only that role. Every other color role, the fonts, radius, font size,
  heading weight, aesthetic text, and brand voice fields are unchanged.
- The admin can adjust the pre-filled value in the slice before saving.
- Dismissing or ignoring the slice writes nothing.
- A reference the copilot cannot resolve to a hex value ("the color of my logo") gets
  one short question or the full Theme panel — never a guessed color, never a write.
- "Show me my theme" still reveals the full Theme panel via `show_panel`.

## Scope
- `lib/adminBrain.ts`: a `propose_theme_color` tool, a generic `edit` event
  (`{ panel: "theme", role, label, value, current }`), current colors in the system
  prompt, and `applyThemeColor` — a writer that merges one role into `themeColors`.
- `app/admin/actions.ts`: `applyThemeColorAction`, the authed wrapper.
- `app/admin/chat/AdminChat.tsx`: the focused edit card.
- `agent.md`: the new tool and rules.

## Non-Goals
- No focused edits for non-theme panels, or for theme fonts / radius / sizes, this pass.
  The `edit` event carries a `panel` field so other panels can add slices later.
- No change to the Theme panel, `ThemePicker`, or `saveTheme`.
- No model-side writes: the tool only proposes.
- No changes to the public agent page, onboarding, or ingestion.
- No new dependencies.

## Scenarios
- Happy path: the exchange above → edit card for `accent`, value = current `text` color
  → Save → `themeColors.accent` updated, everything else identical → revealed panels and
  the page theme refresh.
- Adjust then save: admin changes the hex in the card → the adjusted value is saved.
- Dismiss: admin clicks Dismiss → card closes, nothing written.
- Bad proposal: unknown role or a non-hex value from the model → no edit event, the tool
  result tells the model why, loop terminates.
- Bad save: a malformed hex reaching the writer → error string, nothing written.
- Unresolvable reference → question or `show_panel theme`; no edit event required.

## Constraints
- Follow the `propose_ingestion` precedent: tool emits an event, the chat renders a
  card, the write happens only on the admin's click through an authed server action.
- Hex validation matches `saveTheme` (`/^#[0-9a-fA-F]{3,8}$/`); roles come from
  `COLOR_ROLES`, not a second list.
- The partial write must not route through `saveTheme` (it rewrites every theme field
  from the form and would blank the rest).
- `show_panel` behavior is unchanged.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

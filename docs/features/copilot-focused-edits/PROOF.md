# Proof Plan — Copilot focused edits (theme colors)

## Definition Of Done
- A scripted model turn calling `propose_theme_color {role:"accent", value:<hex>}` yields
  exactly one `edit` event `{ panel:"theme", role:"accent", label:"Accent", value,
  current }` where `current` is the account's stored accent, and yields no `panel` event.
- The system prompt sent to the model contains the account's current color for every
  `COLOR_ROLES` role (stored value, or the role's fallback when unset), and states that
  the page name renders in the `text` role — what lets the model resolve "the color of
  the name".
- Proposing writes nothing: the `ThemeConfig` row is byte-identical after the turn.
- An unknown role or a non-hex value yields no `edit` event and the loop terminates.
- `applyThemeColor(userId, "accent", value)` persists `themeColors.accent = value` and
  leaves every other color role and every other `ThemeConfig` column unchanged.
- `applyThemeColor` with a malformed hex or unknown role returns an error string and
  writes nothing.
- `show_panel {key:"theme"}` still yields a `panel` event.

## Primary Proof
Type: integration (repo-native proof script over the real DB, model doubled only at the
Anthropic client boundary)

Command:
```bash
npx tsx docs/features/copilot-focused-edits/proof.ts
```

Expected evidence:
- All `PASS` lines, `failures: 0`, exit code 0.
- Persisted rows observed and then cleaned up: throwaway user and its `ThemeConfig`.

Secondary guards:
- `npx tsx docs/features/admin-chat-panels/proof.ts` still green.
- `npx tsc --noEmit` and `npm run lint` clean.
- Red run recorded before implementation: `applyThemeColor` is not exported and no
  `edit` event is emitted.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: the model client is a scripted double implementing `ModelClient`; it
  records the `system` string it is called with.
- All rows live under a throwaway user (`proof-copilot-focused-edits@example.invalid`),
  deleted in a `finally` block.

## Anti-Gaming Constraints
- Only the Anthropic client boundary may be doubled; the tool loop, validation, and the
  theme write path are the real code.
- No assertion relies on model-authored text; assertions read events, the system prompt
  the code built, and DB rows.
- "Unchanged" is asserted by comparing the full `ThemeConfig` row before and after, not
  a hand-picked subset of columns.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- The card's rendering and the Save click in `/admin/chat` (login required) and the real
  model's resolution of "the color of the name" are verified in the browser preview, not
  by the script.

# Proof — Theme Extraction Normalization

## Primary proof
```
npx tsx docs/features/theme-extraction-normalize/proof.ts
```
No server or DB required — the proof exercises `normalizeExtractedTheme` from
`lib/theme.ts` directly against known-bad fixture palettes.

## What it proves
- **white-on-yellow** (`bg #ffeb3b`, `text #ffffff`): corrected to ≥ 4.5:1, background
  near-neutral.
- **neon-on-neon** (`bg #39ff14`, `text #ff00ff`, `primary #00ffff`): text/bg,
  surfaceText/surface, accentText/accent all ≥ 4.5:1; background desaturated.
- **saturated background only** (`bg #ff0000`): background becomes near-neutral, text
  readable — corrected, not rejected.
- **sparse extraction** (`{}` and text-only): full default fallback theme
  (`THEME_PRESETS[0].colors`), never a partial palette.
- **role separation**: surface ≠ bg, accent ∉ {bg, surface}, accent never the text color.
- **restraint**: accent hue derived from the extracted brand hue (≤ 40° hue distance);
  background saturation ≤ 0.3.
- **pass-through**: an already-good palette (`#ffffff` / `#111827` / `#0f4c81`) keeps
  bg/text unchanged and the brand color as surface.
- **contract**: output roles ⊆ the seven `ThemeColors` keys, all values valid hex.

## Secondary guards (not proof)
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- Repo safety gate: `$HOME/.claude/scripts/gate`
- The guided-onboarding E2E proof (`docs/features/guided-onboarding/PROOF.md`) still
  asserts the fixture brand color `0f4c81` survives into `themeColors`.

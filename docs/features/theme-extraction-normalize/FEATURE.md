# Theme Extraction Normalization

## Goal
After onboarding theme extraction, the theme applied to the user's UI always passes a
defined set of readability and harmony rules — never an unreadable or clashing palette —
regardless of what colors the source site provides.

## Context
- Extraction: `lib/onboarding/extract.ts` (`extractTheme`) yields raw `bg` / `text` /
  `primary` from the crawled site's inline CSS.
- The applied theme object is `ThemeColors` (`lib/theme.ts`), seven roles:
  `bg, text, surface, surfaceText, accent, accentText, border`.
- `app/admin/onboarding/OnboardingFlow.tsx` maps the extract into `ThemePicker` initial
  colors (previously `primary → surface` with no readability enforcement).
- All WCAG color math already exists in `lib/theme.ts` (`contrastRatio`, `readableOn`,
  `shift`, `derivedSurfaces`, `contrastOn`). No new dependencies.

## Behavior
Add an explicit, named post-processing step `normalizeExtractedTheme(raw)` in
`lib/theme.ts`, applied inside `extractTheme` to every extracted theme. Rules:

1. **Contrast** — body text vs. its background ≥ 4.5:1 (WCAG AA). A failing pairing is
   corrected (lightness-adjusted foreground, falling back to a neutral dark/light text
   color), never rejected. Text-on-surface and text-on-accent also ≥ 4.5:1.
2. **Role separation** — bg, surface, text, and accent are distinct roles; the accent is
   never emitted as the body-text color.
3. **Restraint** — at most one saturated hue enters the palette (the extracted brand
   color); the accent is derived from it (tint/shade), not an unrelated hue.
4. **Neutral foundation** — the page background must be low-saturation (near-neutral);
   a highly saturated extracted background is desaturated, and saturated colors land on
   surface/accent, never the full-page background.
5. **Safe fallback** — if extraction yields too few usable colors (no valid background
   and no valid brand color), the full default theme (`THEME_PRESETS[0]`) applies
   instead of a partial palette.

`extractTheme` returns the normalized seven-role palette in `themeColors`, and
`OnboardingFlow` passes those roles through to `ThemePicker` unchanged.

## Constraints / Non-goals
- Change only the extraction/theme pipeline and its proof. No ThemePicker UI redesign,
  no changes to unrelated onboarding stages, no new dependencies.
- Rule set is exactly the five above — no broader design-system work.

## Implementation Routing
- Required skills: coding-frontend conventions apply (Next.js repo); change is
  lib-level TypeScript only.

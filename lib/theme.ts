/**
 * ── MAIN STREET BRAND · single source of truth ────────────────────────
 *
 * Vibe: the joy of Main Street, delivered to your door. Classic street-sign
 * green on warm paper, serif type, hometown-storefront charm.
 *
 * Change the values here and the whole site re-skins. These are emitted as
 * CSS custom properties in app/globals.css / the <html> style, so both React
 * components and raw CSS read from the same tokens.
 *
 * Note: tenant surfaces (/a/[slug] and the admin dashboard) inject their own
 * ThemeConfig overrides on top of these defaults, so this brand is what every
 * shared/default surface (directory, signup, login, onboarding) wears.
 */

export const brand = {
  name: "Main Street",
  tagline: "The joy of Main Street, delivered to your door.",

  // ── Color ──
  color: {
    // Warm paper ground with a cream soft tone.
    bg: "#F7F7F5",
    bgSoft: "#F1E9D8",
    surface: "#015237",
    border: "#DDD5C2",

    text: "#0F1805",

    // Street-sign green — primary brand fill (cards & buttons).
    primary: "#015237",
    primarySoft: "#7A9E7E",

    // Terracotta brick — the hometown accent.
    accent: "#BE6E46",

    // Semantic
    success: "#1E7A44",
    danger: "#B3261E",
  },

  // ── Type ── (both open-source, commercial-safe, loaded via next/font)
  font: {
    heading: "var(--font-heading)", // Playfair Display
    body: "var(--font-body)",       // Lora
    mono: "var(--font-mono)",       // system mono for code / terminal bits
  },

  radius: {
    sm: "8px",
    md: "14px",
    lg: "22px",
    pill: "999px",
  },

  // Gradients/glows removed site-wide — flat solids only.
  glow: {
    primary: "none",
    accent: "none",
  },
} as const;

/** Emit the palette as CSS variables for globals.css. */
export function themeCssVars(): string {
  const c = brand.color;
  return `
    --bg:${c.bg}; --bg-soft:${c.bgSoft}; --surface:${c.surface}; --border:${c.border};
    --text:${c.text};
    --primary:${c.primary}; --primary-soft:${c.primarySoft}; --accent:${c.accent};
    --success:${c.success}; --danger:${c.danger};
    --radius-sm:${brand.radius.sm}; --radius-md:${brand.radius.md};
    --radius-lg:${brand.radius.lg}; --radius-pill:${brand.radius.pill};
    --glow-primary:${brand.glow.primary}; --glow-accent:${brand.glow.accent};
  `.trim();
}

/**
 * Corner-roundness presets. Each drives the --radius-* CSS tokens so the whole
 * site (buttons, cards, inputs) shares one curvature. Shown in the admin
 * "Corners" picker.
 *
 * `pill` is the radius for lozenge-shaped things — chips, tabs, badges, round
 * icon buttons. It stays fully round for both soft presets, but a Sharp theme
 * squares them off too: leaving them at 999px was the one thing the picker
 * could never restyle, so "Sharp" still rendered a page full of capsules.
 */
export const RADIUS_PRESETS = {
  sharp: { label: "Sharp", sm: "2px", md: "3px", lg: "4px", pill: "3px" },
  rounded: { label: "Rounded (default)", sm: "8px", md: "14px", lg: "22px", pill: "999px" },
  pill: { label: "Pill (extra soft)", sm: "14px", md: "22px", lg: "32px", pill: "999px" },
} as const;

export type RadiusKey = keyof typeof RADIUS_PRESETS;

/** Options for the admin corner-roundness picker (with a preview radius). */
export const RADIUS_OPTIONS = (Object.keys(RADIUS_PRESETS) as RadiusKey[]).map((key) => ({
  key,
  label: RADIUS_PRESETS[key].label,
  // The card-level radius, used to render the corner-preview box.
  preview: RADIUS_PRESETS[key].md,
}));

/**
 * The full set of admin-controllable colors. Every role the site uses maps to
 * a CSS token, so the whole design follows from here — nothing is hardcoded.
 */
export type ThemeColors = {
  bg?: string;
  /** Cards, panels, and primary buttons all share this fill. */
  surface?: string;
  border?: string;
  accent?: string;

  // ── Per-fill text ── each pairs with the fill it sits on, so contrast is
  // chosen where it's actually seen rather than as a floating global. There is
  // one text color per fill; secondary text is the same color in italics.
  text?: string;
  surfaceText?: string;
  accentText?: string;
};

/**
 * The design panel is organized as fills, each owning the text that sits on
 * it. `surface` doubles as `--primary` so cards and buttons never drift apart.
 * Text is nested under its backdrop rather than standing alone, so a contrast
 * pair is always edited together.
 */
export const COLOR_GROUPS: {
  fill: { key: keyof ThemeColors; label: string; fallback: string };
  text: { key: keyof ThemeColors; label: string; fallback: string }[];
}[] = [
  {
    fill: { key: "bg", label: "Background", fallback: "#0B1020" },
    text: [{ key: "text", label: "Text on background", fallback: "#E8ECFF" }],
  },
  {
    fill: { key: "surface", label: "Surface / cards & primary", fallback: "#1A2140" },
    text: [{ key: "surfaceText", label: "Text on surface", fallback: "#E8ECFF" }],
  },
  {
    fill: { key: "accent", label: "Accent", fallback: "#FFB84D" },
    text: [{ key: "accentText", label: "Text on accent", fallback: "#10131C" }],
  },
];

/** Flat list of every color role — used to emit the hidden form inputs. */
export const COLOR_ROLES: { key: keyof ThemeColors; label: string; fallback: string }[] = [
  ...COLOR_GROUPS.flatMap((g) => [g.fill, ...g.text]),
  { key: "border", label: "Border", fallback: "#2A335C" },
];

/**
 * Ready-made color themes for the admin "Shuffle" button. Each one is a full
 * set of the seven roles — no partial presets, so shuffling can never leave a
 * previous theme's background under a new theme's cards. Every fill/text pair
 * here clears 4.5:1, which is the same bar the picker's live readout asks for.
 */
export const THEME_PRESETS: { name: string; colors: ThemeColors }[] = [
  {
    name: "Night Terminal",
    colors: { bg: "#0B1020", text: "#E8ECFF", surface: "#1A2140", surfaceText: "#E8ECFF", accent: "#FFB84D", accentText: "#10131C", border: "#2A335C" },
  },
  {
    name: "Sage Paper",
    colors: { bg: "#F1E9D8", text: "#1F2A21", surface: "#3F5D46", surfaceText: "#F1E9D8", accent: "#9C4F2B", accentText: "#FFFFFF", border: "#D8CDB6" },
  },
  {
    name: "Blueprint",
    colors: { bg: "#0D1B2A", text: "#E0E6ED", surface: "#1B2C3F", surfaceText: "#E0E6ED", accent: "#4CC9F0", accentText: "#06121C", border: "#2C4159" },
  },
  {
    name: "Mono Slate",
    colors: { bg: "#18181B", text: "#FAFAFA", surface: "#27272A", surfaceText: "#FAFAFA", accent: "#A1A1AA", accentText: "#18181B", border: "#3F3F46" },
  },
  {
    name: "Rose Ink",
    colors: { bg: "#FFF5F7", text: "#2B1A20", surface: "#8C2F49", surfaceText: "#FFF5F7", accent: "#A32B4B", accentText: "#FFFFFF", border: "#EBD3DA" },
  },
  {
    name: "Forest Cream",
    colors: { bg: "#FAF7F0", text: "#1C2B21", surface: "#14432A", surfaceText: "#F3FBF6", accent: "#9A4A08", accentText: "#FFFFFF", border: "#DDD8C8" },
  },
  {
    name: "Cyber Lime",
    colors: { bg: "#0A0F0A", text: "#E6FFE6", surface: "#14251A", surfaceText: "#DFF7E3", accent: "#A3E635", accentText: "#0A0F0A", border: "#244430" },
  },
  {
    name: "Copper Dusk",
    colors: { bg: "#1C1614", text: "#F5EBE4", surface: "#2E241F", surfaceText: "#F5EBE4", accent: "#E08D50", accentText: "#1C1614", border: "#4A3A31" },
  },
  {
    name: "Arctic",
    colors: { bg: "#F7FAFC", text: "#0F1E2B", surface: "#1E3A5F", surfaceText: "#EAF2FA", accent: "#0B6076", accentText: "#FFFFFF", border: "#D3DEE8" },
  },
  {
    name: "Plum Noir",
    colors: { bg: "#17111F", text: "#EFE6F7", surface: "#291B36", surfaceText: "#EFE6F7", accent: "#C084FC", accentText: "#17111F", border: "#43305A" },
  },
  {
    name: "Sand & Ink",
    colors: { bg: "#EDE6DA", text: "#14110D", surface: "#2B2620", surfaceText: "#EDE6DA", accent: "#6F5423", accentText: "#FFFFFF", border: "#CFC5B4" },
  },
  {
    name: "Ocean Deep",
    colors: { bg: "#06232E", text: "#DDF2F7", surface: "#0C3543", surfaceText: "#DDF2F7", accent: "#22D3EE", accentText: "#052029", border: "#17505F" },
  },
  {
    name: "Crimson Terminal",
    colors: { bg: "#120708", text: "#FFE9EA", surface: "#24100F", surfaceText: "#FFE9EA", accent: "#F87171", accentText: "#1A0708", border: "#451F1E" },
  },
  {
    name: "Mint Chalk",
    colors: { bg: "#F2FBF6", text: "#0F241A", surface: "#0F5132", surfaceText: "#EAF7F0", accent: "#0B6058", accentText: "#FFFFFF", border: "#CFE6DA" },
  },
  {
    name: "Mustard Press",
    colors: { bg: "#FBF6E9", text: "#1F1B10", surface: "#3A3423", surfaceText: "#FBF6E9", accent: "#7A5108", accentText: "#FFFFFF", border: "#E0D7BE" },
  },
  {
    name: "Cobalt Snow",
    colors: { bg: "#FFFFFF", text: "#111827", surface: "#1D4ED8", surfaceText: "#FFFFFF", accent: "#B81F63", accentText: "#FFFFFF", border: "#E2E5EB" },
  },
  {
    name: "Charcoal Amber",
    colors: { bg: "#1F1D1B", text: "#F5F1EA", surface: "#2C2926", surfaceText: "#F5F1EA", accent: "#F59E0B", accentText: "#1F1D1B", border: "#46413B" },
  },
  {
    name: "Lavender Fog",
    colors: { bg: "#F5F3FF", text: "#1E1B2E", surface: "#4C1D95", surfaceText: "#EDE9FE", accent: "#5B21B6", accentText: "#FFFFFF", border: "#DDD8F0" },
  },
  {
    name: "Teal Slate",
    colors: { bg: "#102A2E", text: "#E2F4F2", surface: "#1B3F44", surfaceText: "#E2F4F2", accent: "#5EEAD4", accentText: "#0B1F22", border: "#2E5C62" },
  },
  {
    name: "Peach Clay",
    colors: { bg: "#FFF1E8", text: "#2A1810", surface: "#7C2D12", surfaceText: "#FFF1E8", accent: "#A93409", accentText: "#FFFFFF", border: "#F0DACB" },
  },
];

/** Heading weight options for the design panel. */
export const HEADING_WEIGHTS = [
  { key: "500", label: "Medium" },
  { key: "600", label: "Semibold" },
  { key: "700", label: "Bold" },
  { key: "800", label: "Extra bold" },
];

const hex = (v?: string) => (v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null);

/** Parse a #rgb / #rrggbb hex into [r,g,b] 0-255. Returns null if unparseable. */
function rgb(h: string): [number, number, number] | null {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6);
  if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance(h: string): number {
  const c = rgb(h);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** True when a surface is light enough that it needs dark text on top. */
export function isLight(h: string): boolean {
  return luminance(h) > 0.45;
}

/**
 * WCAG contrast ratio between two hex colors, or null if either won't parse.
 * Used by the admin panel to show each fill/text pair's live ratio.
 */
export function contrastRatioOf(a: string, b: string): number | null {
  if (!rgb(a) || !rgb(b)) return null;
  return contrastRatio(a, b);
}

/** WCAG contrast ratio between two hex colors (1 = identical, 21 = max). */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Near-black / near-white foregrounds — softer than pure #000/#fff. */
const INK = "#10131C";
const PAPER = "#FFFFFF";

/** Semantic hues. Not admin-editable, so they need per-fill readable copies. */
const DANGER = brand.color.danger;
const SUCCESS = brand.color.success;

/**
 * The readable foreground for text/icons sitting ON a colored surface. Every
 * filled element (primary button, accent chip, card) pairs its background with
 * this so the contents never vanish into it. Picks whichever of ink/paper
 * actually scores the higher contrast ratio rather than guessing from
 * luminance — mid-tone fills (violet, teal) sit right at the boundary.
 */
export function contrastOn(h: string): string {
  return contrastRatio(h, INK) >= contrastRatio(h, PAPER) ? INK : PAPER;
}

/**
 * Keep a *hue* usable as text on a given fill. Accent-colored text (links,
 * tags, the headline spark) has to stay recognisably the accent, so instead of
 * flipping it to ink/paper this walks the hue toward white or black until it
 * clears `min`. Only if neither direction gets there does it fall back to a
 * plain readable foreground.
 *
 * Both directions are searched rather than picked from `isLight`. A mid-tone
 * fill — sage green, dusty violet — sits near that threshold, and guessing
 * wrong walks the hue toward the fill's own brightness, where no amount of
 * shifting can reach the target. Of the directions that do work, the one
 * needing the smaller shift wins, since it stays closest to the original hue.
 */
function readableOn(color: string, fill: string, min = 4.5): string {
  if (!rgb(color) || !rgb(fill)) return color;
  if (contrastRatio(color, fill) >= min) return color;

  let best: string | null = null;
  let bestAmount = Infinity;
  for (const direction of [-1, 1]) {
    for (let amount = 0.06; amount <= 1.0001; amount += 0.06) {
      const candidate = shift(color, direction * amount);
      if (contrastRatio(candidate, fill) < min) continue;
      if (amount < bestAmount) {
        bestAmount = amount;
        best = candidate;
      }
      break;
    }
  }
  return best ?? contrastOn(fill);
}

/**
 * Danger and success have to stay recognisably red and green — an ink-black
 * "Delete" reads as an ordinary action, which is worse than a slightly weaker
 * ratio. So aim for 4.5:1, and rather than give the hue up, settle for WCAG's
 * 3:1 non-text/large-text floor. Only if even that is unreachable on this fill
 * does it fall through to a plain readable foreground.
 */
function semanticOn(hue: string, fill: string): string {
  const strict = readableOn(hue, fill, 4.5);
  // readableOn signals "this hue can't get there" by returning ink/paper.
  return strict === contrastOn(fill) ? readableOn(hue, fill, 3) : strict;
}

/** Mix a hex toward white (amount>0) or black (amount<0) by `amount` (0..1). */
function shift(h: string, amount: number): string {
  const c = rgb(h);
  if (!c) return h;
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const out = c.map((v) => Math.round(v + (target - v) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Derive the supporting surface tones from the chosen background. Without this
 * a light `bg` would keep the dark-navy `--bg-soft`/`--surface`/`--border`
 * defaults from globals.css, leaving dark blue panels stuck on a light site.
 * Light backgrounds darken slightly for depth; dark ones lighten.
 */
function derivedSurfaces(bg: string): { soft: string; surface: string; border: string } {
  const light = isLight(bg);
  return light
    ? { soft: shift(bg, -0.04), surface: shift(bg, -0.07), border: shift(bg, -0.18) }
    : { soft: shift(bg, 0.05), surface: shift(bg, 0.09), border: shift(bg, 0.2) };
}

// ── Extracted-theme normalization ─────────────────────────────────────
// Site extraction can hand back anything — white text on neon yellow, a
// saturated full-page background, or almost nothing. normalizeExtractedTheme
// turns that raw material into a palette that always passes the brand rules
// in docs/features/theme-extraction-normalize/FEATURE.md.

/** HSV-style saturation (0 = neutral gray, 1 = fully saturated). */
function saturationOf(h: string): number {
  const c = rgb(h);
  if (!c) return 0;
  const max = Math.max(...c);
  return max === 0 ? 0 : (max - Math.min(...c)) / max;
}

/** Backgrounds above this saturation read as "loud", not as a page ground. */
const BG_SAT_MAX = 0.3;

/** Pull a color toward its own gray until it reads as near-neutral. */
function desaturate(h: string): string {
  let out = h;
  for (let i = 0; i < 16 && saturationOf(out) > BG_SAT_MAX; i++) {
    const c = rgb(out)!;
    const avg = (c[0] + c[1] + c[2]) / 3;
    out = `#${c.map((v) => Math.round(v + (avg - v) * 0.25).toString(16).padStart(2, "0")).join("")}`;
  }
  return out;
}

/**
 * Nudge a fill away from the mid-tones until ink or paper clears 4.5:1 on it.
 * Mid-luminance fills (pure red, mid gray) can fail AA against *both* poles;
 * every fill that carries text goes through here first so a readable
 * foreground always exists.
 */
function settleFill(h: string): string {
  let out = h;
  for (let i = 0; i < 24 && contrastRatio(out, contrastOn(out)) < 4.5; i++) {
    out = shift(out, luminance(out) > 0.2 ? 0.06 : -0.06);
  }
  return out;
}

/** Shade a color until it is visually distinct from every color in `others`. */
function separate(h: string, others: string[]): string {
  let out = h;
  const dir = isLight(h) ? -0.08 : 0.08;
  for (let i = 0; i < 12 && others.some((o) => contrastRatio(out, o) < 1.15); i++) {
    out = shift(out, dir);
  }
  return out;
}

/**
 * Post-process a raw site extraction (bg / text / brand primary) into a full
 * palette that is guaranteed readable and coherent: AA contrast on every
 * fill/text pair, a near-neutral background, the brand color on surface, an
 * accent derived from the brand hue, and a full preset fallback when the site
 * gave us too little to work with.
 */
export function normalizeExtractedTheme(raw: {
  bg?: string;
  text?: string;
  primary?: string;
}): ThemeColors {
  const rawBg = hex(raw.bg);
  const rawText = hex(raw.text);
  const primary = hex(raw.primary);

  // Too few usable colors — a full curated preset beats a partial palette.
  if (!rawBg && !primary) return { ...THEME_PRESETS[0].colors };

  // Neutral foundation: the page background never keeps a loud hue, and is
  // settled where a readable text color is reachable.
  const bg = settleFill(desaturate(rawBg ?? "#FFFFFF"));
  const text = readableOn(rawText ?? contrastOn(bg), bg);

  // The brand color lands on surface (cards & primary buttons), never the
  // full page; without one the surface stays a derived shade of the bg.
  const surfCandidate =
    primary && saturationOf(primary) > 0.25 ? primary : derivedSurfaces(bg).surface;
  const surface = settleFill(separate(surfCandidate, [bg]));

  const out: ThemeColors = {
    bg,
    text,
    surface,
    surfaceText: readableOn(text, surface),
    border: derivedSurfaces(bg).border,
  };

  // Restraint: the accent is a shade of the one brand hue, never an unrelated
  // color, and never doubles as body text.
  if (primary) {
    const accent = settleFill(
      separate(shift(primary, isLight(bg) ? -0.18 : 0.18), [bg, surface]),
    );
    out.accent = accent;
    out.accentText = readableOn(contrastOn(accent), accent);
  }
  return out;
}

/**
 * Build the CSS-variable declarations (the inner body of a :root block) from
 * admin-chosen theme values. Shared by the live-site <style> injector and the
 * admin live-preview box so both render identically. Only sets what's provided;
 * everything else falls back to globals.css defaults.
 */
export function themeVarLines(opts: {
  headingFamily: string;
  bodyFamily: string;
  radius?: string;
  fontSize?: string;
  headingWeight?: string;
  colors: ThemeColors;
}): string {
  const lines: string[] = [];

  lines.push(`--font-heading:${opts.headingFamily};`);
  lines.push(`--font-body:${opts.bodyFamily};`);

  const preset = RADIUS_PRESETS[opts.radius as RadiusKey];
  if (preset) {
    lines.push(`--radius-sm:${preset.sm};`);
    lines.push(`--radius-md:${preset.md};`);
    lines.push(`--radius-lg:${preset.lg};`);
    lines.push(`--radius-pill:${preset.pill};`);
  }

  // Base font size (px) and heading weight.
  const size = Number(opts.fontSize);
  if (Number.isFinite(size) && size >= 12 && size <= 24) {
    lines.push(`--font-size-base:${size}px;`);
  }
  if (opts.headingWeight && /^(400|500|600|700|800|900)$/.test(opts.headingWeight)) {
    lines.push(`--heading-weight:${opts.headingWeight};`);
  }

  // Full color set — every role, so the whole site follows.
  const c = opts.colors;
  const bg = hex(c.bg);
  const surface = hex(c.surface);
  const border = hex(c.border);
  const text = hex(c.text);
  const surfaceText = hex(c.surfaceText);
  const accent = hex(c.accent);
  const accentText = hex(c.accentText);

  // Picking a background re-derives every supporting tone, so a light bg can't
  // leave dark-navy panels/borders behind. Explicit choices still win below.
  if (bg) {
    const d = derivedSurfaces(bg);
    lines.push(`--bg:${bg};`);
    lines.push(`--bg-soft:${d.soft};`);
    lines.push(`--surface:${d.surface};`);
    lines.push(`--border:${d.border};`);
    // Default text to whatever reads on this background; overridden if set.
    lines.push(`--text:${contrastOn(bg)};`);
  }

  // Surface is the single fill behind BOTH cards and primary buttons, so the
  // two can never drift apart.
  if (surface) {
    lines.push(`--surface:${surface};`);
    if (!bg) lines.push(`--bg-soft:${surface};`);
  }
  const surfaceFill = surface ?? (bg ? derivedSurfaces(bg).surface : "#1A2140");
  lines.push(`--primary:${surfaceFill};`);

  if (border) lines.push(`--border:${border};`);
  if (accent) lines.push(`--accent:${accent};`);

  if (text) lines.push(`--text:${text};`);

  // ── Contrast pairs ── each fill's text, taken from the paired picker when
  // set and otherwise computed, so content on a fill is always legible. There
  // is exactly one text color per fill: secondary text reuses it in italics
  // rather than introducing a lighter neutral of its own.
  const accentFill = accent ?? "#FFB84D";
  const onSurface = surfaceText ?? contrastOn(surfaceFill);
  lines.push(`--on-surface:${onSurface};`);
  // Primary shares surface's fill, so it shares surface's foreground too.
  lines.push(`--on-primary:${onSurface};`);
  lines.push(`--on-accent:${accentText ?? contrastOn(accentFill)};`);

  // ── bg-soft ── the tone behind chips, fields and cards. It is either a shade
  // of the background or, when no background was chosen, the surface fill
  // itself — so its text follows whichever fill it actually resolved to rather
  // than always borrowing the background's.
  const bgFill = bg ?? "#0B1020";
  const onBg = text ?? (bg ? contrastOn(bg) : "#E8ECFF");
  const bgSoftFill = bg ? derivedSurfaces(bg).soft : surface ?? "#12182E";
  lines.push(`--on-bg-soft:${bg ? onBg : onSurface};`);

  // ── Accent-colored text ── links, tags and the headline spark read as the
  // accent hue, but each fill gets its own nudged copy. Without this an accent
  // picked to look good on the background disappears on a card or a bubble.
  lines.push(`--accent-on-bg:${readableOn(accentFill, bgFill)};`);
  lines.push(`--accent-on-bg-soft:${readableOn(accentFill, bgSoftFill)};`);
  lines.push(`--accent-on-surface:${readableOn(accentFill, surfaceFill)};`);

  // ── Semantic colors ── danger and success are fixed hues rather than admin
  // choices, so they collide with whatever fill the theme picks: the stock red
  // lands near 2:1 on a mid-tone panel. Same per-fill treatment as the accent.
  for (const [name, hue] of [["danger", DANGER], ["success", SUCCESS]] as const) {
    lines.push(`--${name}-on-bg:${semanticOn(hue, bgFill)};`);
    lines.push(`--${name}-on-bg-soft:${semanticOn(hue, bgSoftFill)};`);
    lines.push(`--${name}-on-surface:${semanticOn(hue, surfaceFill)};`);
  }

  return lines.join("");
}

/**
 * Build the DB-backed override <style> body. Repeats :root to raise specificity
 * (0,2,0) above globals.css's single `:root` (0,1,0) so overrides reliably win.
 */
export function themeOverrideCss(opts: {
  headingFamily: string;
  bodyFamily: string;
  radius?: string;
  fontSize?: string;
  headingWeight?: string;
  colors: ThemeColors;
}): string {
  return `:root:root{${themeVarLines(opts)}}`;
}

/** The starter questions shown as chips under the chat box. No emojis. */
export const starterQuestions = [
  { q: "What's your background and past experience?" },
  { q: "Tell me about yourself and how you see the world." },
  { q: "How can I connect with you?" },
  { q: "What are your recent projects?" },
  { q: "Show me a bit about your life?" },
];

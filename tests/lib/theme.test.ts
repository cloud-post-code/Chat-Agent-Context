import { describe, expect, it } from "vitest";
import { THEME_PRESETS, contrastRatioOf, normalizeExtractedTheme, type ThemeColors } from "@/lib/theme";

// Converted from docs/features/theme-extraction-normalize/proof.ts: the five
// brand-design rules normalizeExtractedTheme must hold.
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const ROLES = ["bg", "text", "surface", "surfaceText", "accent", "accentText", "border"];
const rgb = (h: string): [number, number, number] => {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
};
const sat = (h: string) => { const c = rgb(h); const max = Math.max(...c); return max === 0 ? 0 : (max - Math.min(...c)) / max; };
const hue = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  const x = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return x * 60;
};
const hueDist = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const ratio = (a?: string, b?: string) => (a && b ? contrastRatioOf(a, b) ?? 0 : 0);
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function expectWellFormed(t: ThemeColors) {
  for (const [k, v] of Object.entries(t)) {
    expect(ROLES).toContain(k);
    expect(String(v)).toMatch(HEX);
  }
}
function expectReadable(t: ThemeColors) {
  expect(ratio(t.text, t.bg)).toBeGreaterThanOrEqual(4.5);
  if (t.surface) expect(ratio(t.surfaceText, t.surface)).toBeGreaterThanOrEqual(4.5);
  if (t.accent) expect(ratio(t.accentText, t.accent)).toBeGreaterThanOrEqual(4.5);
}
function expectSeparated(t: ThemeColors) {
  expect(same(t.surface, t.bg)).toBe(false);
  if (t.accent) {
    expect(same(t.accent, t.bg) || same(t.accent, t.surface)).toBe(false);
    expect(same(t.accent, t.text)).toBe(false);
  }
}

describe("normalizeExtractedTheme", () => {
  it("fixes white-on-yellow into a readable near-neutral theme", () => {
    const t = normalizeExtractedTheme({ bg: "#ffeb3b", text: "#ffffff" });
    expectWellFormed(t); expectReadable(t); expectSeparated(t);
    expect(sat(t.bg!)).toBeLessThanOrEqual(0.3);
  });
  it("tames neon-on-neon and derives the accent from the brand hue", () => {
    const t = normalizeExtractedTheme({ bg: "#39ff14", text: "#ff00ff", primary: "#00ffff" });
    expectWellFormed(t); expectReadable(t); expectSeparated(t);
    expect(sat(t.bg!)).toBeLessThanOrEqual(0.3);
    expect(hueDist(hue(t.accent!), hue("#00ffff"))).toBeLessThanOrEqual(40);
  });
  it("corrects a saturated background rather than rejecting it", () => {
    const t = normalizeExtractedTheme({ bg: "#ff0000" });
    expectWellFormed(t); expectReadable(t);
    expect(sat(t.bg!)).toBeLessThanOrEqual(0.3);
    expect(t.bg && t.text).toBeTruthy();
  });
  it("falls back to the full default theme for a sparse extraction", () => {
    expect(normalizeExtractedTheme({})).toEqual(THEME_PRESETS[0].colors);
    expect(normalizeExtractedTheme({ text: "#123456" })).toEqual(THEME_PRESETS[0].colors);
  });
  it("keeps a dark-branded ground dark and hued, with the second color on accent", () => {
    const t = normalizeExtractedTheme({ bg: "#1e2b22", text: "#f5efe2", primary: "#1e2b22", accent: "#c99b45" });
    expectWellFormed(t); expectReadable(t); expectSeparated(t);
    const [r, g, b] = rgb(t.bg!);
    expect((r + g + b) / 3).toBeLessThan(96);
    expect(sat(t.bg!)).toBeGreaterThan(0.15);
    expect(hueDist(hue(t.bg!), hue("#1e2b22"))).toBeLessThanOrEqual(40);
    expect(hueDist(hue(t.accent!), hue("#c99b45"))).toBeLessThanOrEqual(40);
  });
  it("passes an already-good palette through", () => {
    const t = normalizeExtractedTheme({ bg: "#ffffff", text: "#111827", primary: "#0f4c81" });
    expect(same(t.bg, "#ffffff")).toBe(true);
    expect(same(t.text, "#111827")).toBe(true);
    expect(same(t.surface, "#0f4c81")).toBe(true);
    expectReadable(t); expectSeparated(t);
  });
});

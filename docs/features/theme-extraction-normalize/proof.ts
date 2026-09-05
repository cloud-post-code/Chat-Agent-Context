/**
 * Primary proof for theme-extraction-normalize.
 * Runs normalizeExtractedTheme against known-bad palettes and asserts the five
 * brand-design rules from FEATURE.md. Pure — no server, DB, or crawler needed.
 *
 *   npx tsx docs/features/theme-extraction-normalize/proof.ts
 */
import {
  normalizeExtractedTheme,
  contrastRatioOf,
  THEME_PRESETS,
  type ThemeColors,
} from "../../../lib/theme";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failed++;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const ROLES = ["bg", "text", "surface", "surfaceText", "accent", "accentText", "border"];

function rgbOf(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
function sat(h: string): number {
  const c = rgbOf(h);
  const max = Math.max(...c), min = Math.min(...c);
  return max === 0 ? 0 : (max - min) / max;
}
function hue(h: string): number {
  const [r, g, b] = rgbOf(h).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let x = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return x * 60;
}
function hueDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
const ratio = (a?: string, b?: string) => (a && b ? contrastRatioOf(a, b) ?? 0 : 0);
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function contract(name: string, t: ThemeColors) {
  const entries = Object.entries(t);
  check(`${name}: only known roles emitted`, entries.every(([k]) => ROLES.includes(k)),
    entries.map(([k]) => k).join(","));
  check(`${name}: all values are hex`, entries.every(([, v]) => HEX.test(String(v))),
    JSON.stringify(t));
}
function readable(name: string, t: ThemeColors) {
  check(`${name}: text/bg >= 4.5`, ratio(t.text, t.bg) >= 4.5, String(ratio(t.text, t.bg)));
  if (t.surface) {
    check(`${name}: surfaceText/surface >= 4.5`, ratio(t.surfaceText, t.surface) >= 4.5,
      `${t.surfaceText} on ${t.surface} = ${ratio(t.surfaceText, t.surface)}`);
  }
  if (t.accent) {
    check(`${name}: accentText/accent >= 4.5`, ratio(t.accentText, t.accent) >= 4.5,
      `${t.accentText} on ${t.accent} = ${ratio(t.accentText, t.accent)}`);
  }
}
function separated(name: string, t: ThemeColors) {
  check(`${name}: surface distinct from bg`, !same(t.surface, t.bg), String(t.surface));
  if (t.accent) {
    check(`${name}: accent distinct from bg and surface`,
      !same(t.accent, t.bg) && !same(t.accent, t.surface), String(t.accent));
    check(`${name}: accent not used as body text`, !same(t.accent, t.text), String(t.text));
  }
}

// ── Rule 1 + 4: white-on-yellow ──
{
  const t = normalizeExtractedTheme({ bg: "#ffeb3b", text: "#ffffff" });
  contract("white-on-yellow", t);
  readable("white-on-yellow", t);
  check("white-on-yellow: bg near-neutral (sat <= 0.3)", sat(t.bg!) <= 0.3, `${t.bg} sat=${sat(t.bg!)}`);
  separated("white-on-yellow", t);
}

// ── Rules 1-4: neon-on-neon ──
{
  const t = normalizeExtractedTheme({ bg: "#39ff14", text: "#ff00ff", primary: "#00ffff" });
  contract("neon-on-neon", t);
  readable("neon-on-neon", t);
  separated("neon-on-neon", t);
  check("neon-on-neon: bg near-neutral (sat <= 0.3)", sat(t.bg!) <= 0.3, `${t.bg} sat=${sat(t.bg!)}`);
  check("neon-on-neon: accent derived from brand hue (<= 40 deg)",
    !!t.accent && hueDist(hue(t.accent), hue("#00ffff")) <= 40,
    `${t.accent} hue=${t.accent ? hue(t.accent) : "-"}`);
}

// ── Rule 4 corrected-not-rejected: saturated background only ──
{
  const t = normalizeExtractedTheme({ bg: "#ff0000" });
  contract("saturated-bg", t);
  readable("saturated-bg", t);
  check("saturated-bg: bg near-neutral (sat <= 0.3)", sat(t.bg!) <= 0.3, `${t.bg} sat=${sat(t.bg!)}`);
  check("saturated-bg: still produced a theme (not rejected)", !!t.bg && !!t.text);
}

// ── Rule 5: sparse extraction falls back to the full default theme ──
{
  const fallback = THEME_PRESETS[0].colors;
  const empty = normalizeExtractedTheme({});
  const textOnly = normalizeExtractedTheme({ text: "#123456" });
  check("sparse {}: full default fallback theme",
    JSON.stringify(empty) === JSON.stringify(fallback), JSON.stringify(empty));
  check("sparse text-only: full default fallback theme",
    JSON.stringify(textOnly) === JSON.stringify(fallback), JSON.stringify(textOnly));
}

// ── Pass-through: an already-good palette is not mangled ──
{
  const t = normalizeExtractedTheme({ bg: "#ffffff", text: "#111827", primary: "#0f4c81" });
  check("pass-through: bg unchanged", same(t.bg, "#ffffff"), String(t.bg));
  check("pass-through: text unchanged", same(t.text, "#111827"), String(t.text));
  check("pass-through: brand color kept as surface", same(t.surface, "#0f4c81"), String(t.surface));
  readable("pass-through", t);
  separated("pass-through", t);
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

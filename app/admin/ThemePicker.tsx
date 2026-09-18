"use client";

import { useState } from "react";
import { field, Label } from "./ui";
import {
  COLOR_GROUPS,
  COLOR_ROLES,
  HEADING_WEIGHTS,
  THEME_PRESETS,
  contrastRatioOf,
  themeVarLines,
  type ThemeColors,
} from "@/lib/theme";

/** "7.2:1" for the swatch pair readout, or "—" when a color won't parse. */
function ratioLabel(bg: string, fg: string): string {
  const r = contrastRatioOf(bg, fg);
  return r ? `${r.toFixed(1)}:1` : "—";
}

/** The px range themeVarLines will honor; anything else falls back to default. */
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 24;

/** Pull a typed base size back into range; blank or junk resets to the default. */
function clampFontSize(v: string): string {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || v.trim() === "") return "16";
  return String(Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n)));
}

type FontOption = { key: string; label: string; family: string };
type RadiusOption = { key: string; label: string; preview: string };

/**
 * Full design-template panel for the Persona & Theme form. Everything the site
 * uses — all 7 color roles, both fonts, base size, heading weight, and corner
 * roundness — is controlled here and written to hidden inputs the savePersona
 * action stores. A live preview box mirrors the current values.
 */
export function ThemePicker({
  fontOptions,
  bodyFontOptions,
  radiusOptions,
  initial,
}: {
  fontOptions: FontOption[];
  bodyFontOptions: FontOption[];
  radiusOptions: RadiusOption[];
  initial: {
    themeFont: string;
    themeBodyFont: string;
    themeRadius: string;
    themeFontSize: string;
    themeHeadingWeight: string;
    colors: ThemeColors;
  };
}) {
  const [themeFont, setThemeFont] = useState(initial.themeFont || fontOptions[0]?.key);
  const [themeBodyFont, setThemeBodyFont] = useState(initial.themeBodyFont || "inter");
  const [themeRadius, setThemeRadius] = useState(initial.themeRadius || radiusOptions[0]?.key);
  const [fontSize, setFontSize] = useState(initial.themeFontSize || "16");
  const [headingWeight, setHeadingWeight] = useState(initial.themeHeadingWeight || "700");
  const [colors, setColors] = useState<ThemeColors>(initial.colors ?? {});
  // Which preset the shuffle button last applied, so its name can be shown and
  // so the next shuffle can skip it. Null until shuffled — hand-picked colors
  // don't belong to a preset even when they happen to match one.
  const [presetIndex, setPresetIndex] = useState<number | null>(null);

  const setColor = (key: keyof ThemeColors, v: string) => {
    setColors((c) => ({ ...c, [key]: v }));
    // Editing any swatch means these are no longer the preset's colors.
    setPresetIndex(null);
  };

  /**
   * Jump to a random preset, never the one already showing — a shuffle that
   * lands on the current theme reads as a broken button. Presets carry all
   * seven roles, so this replaces the palette wholesale rather than merging
   * into it and leaving an old border or accent behind.
   */
  const shuffle = () => {
    const others = THEME_PRESETS.map((_, i) => i).filter((i) => i !== presetIndex);
    const next = others[Math.floor(Math.random() * others.length)];
    setColors({ ...THEME_PRESETS[next].colors });
    setPresetIndex(next);
  };

  const headingFamily = fontOptions.find((f) => f.key === themeFont)?.family;
  const bodyFamily = bodyFontOptions.find((f) => f.key === themeBodyFont)?.family;

  // CSS the live-preview box scopes to itself, mirroring the real site pipeline.
  const previewCss = themeVarLines({
    headingFamily: headingFamily ?? "inherit",
    bodyFamily: bodyFamily ?? "inherit",
    radius: themeRadius,
    fontSize,
    headingWeight,
    colors,
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Hidden inputs the server action reads. */}
      <input type="hidden" name="themeFont" value={themeFont} />
      <input type="hidden" name="themeBodyFont" value={themeBodyFont} />
      <input type="hidden" name="themeRadius" value={themeRadius} />
      <input type="hidden" name="themeFontSize" value={fontSize} />
      <input type="hidden" name="themeHeadingWeight" value={headingWeight} />
      {COLOR_ROLES.map((r) => (
        <input key={r.key} type="hidden" name={`color_${r.key}`} value={colors[r.key] ?? ""} />
      ))}

      {/* ── Typography ── */}
      <div>
        <strong style={{ fontSize: 13, color: "var(--on-surface)", display: "block", marginBottom: 10 }}>Typography</strong>
        <div style={grid2}>
          <div>
            <Label>Headline font</Label>
            <FontDropdown options={fontOptions} value={themeFont} onChange={setThemeFont} />
          </div>
          <div>
            <Label>Text font</Label>
            <FontDropdown options={bodyFontOptions} value={themeBodyFont} onChange={setThemeBodyFont} />
          </div>
        </div>
        <div style={{ ...grid2, marginTop: 10 }}>
          <div>
            <Label>Base text size (px)</Label>
            <input
              type="number"
              min={FONT_SIZE_MIN}
              max={FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              // Typing is left alone — half-entered values like "" or "1" have
              // to survive keystrokes — and the range is enforced on blur so
              // the saved value is one the theme renderer actually honors.
              onChange={(e) => setFontSize(e.target.value)}
              onBlur={(e) => setFontSize(clampFontSize(e.target.value))}
              style={{ ...field, marginBottom: 0 }}
            />
          </div>
          <div>
            <Label>Heading weight</Label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {HEADING_WEIGHTS.map((w) => {
                const on = w.key === headingWeight;
                return (
                  <button
                    key={w.key}
                    type="button"
                    onClick={() => setHeadingWeight(w.key)}
                    style={{
                      ...field,
                      marginBottom: 0,
                      width: "auto",
                      padding: "8px 12px",
                      color: "var(--on-surface)",
                      fontWeight: Number(w.key),
                      cursor: "pointer",
                      border: on ? "1px solid var(--primary)" : "1px solid var(--border)",
                      // Mark the selection with a tint of the panel's own text
                      // rather than a different fill, so all four keep the
                      // surface pair instead of one switching underneath it.
                      background: on ? "color-mix(in srgb, var(--on-surface) 12%, transparent)" : "transparent",
                    }}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Colors ── grouped by fill, each owning the text that sits on it. ── */}
      <div>
        {/* Heading and shuffle sit on one row: the button rewrites every swatch
            below it, so it belongs with the section it replaces, not floating. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <strong style={{ fontSize: 13, color: "var(--on-surface)" }}>Colors</strong>
          <button
            type="button"
            onClick={shuffle}
            title={`Apply a random one of the ${THEME_PRESETS.length} preset palettes`}
            style={{
              ...field,
              marginBottom: 0,
              width: "auto",
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--on-surface)",
              border: "1px solid var(--border)",
              background: "color-mix(in srgb, var(--on-surface) 12%, transparent)",
              cursor: "pointer",
            }}
          >
            Shuffle palette
          </button>
          {presetIndex !== null && (
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--on-surface)" }}>
              {/* A strip of the applied palette, so the name has something to
                  read against while the eye is still on this row. */}
              <span style={{ display: "flex", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border)" }}>
                {PRESET_SWATCH_ROLES.map((role) => (
                  <span
                    key={role}
                    style={{ width: 14, height: 14, background: THEME_PRESETS[presetIndex].colors[role] }}
                  />
                ))}
              </span>
              <em>{THEME_PRESETS[presetIndex].name}</em>
            </span>
          )}
        </div>
        {/* Three across on desktop, stacked on mobile — auto-fit handles both
            without a media query, since each card has a 240px floor. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            alignItems: "start",
          }}
        >
          {COLOR_GROUPS.map((g) => {
            const fillValue = colors[g.fill.key] ?? "";
            const fillShown = /^#[0-9a-fA-F]{3,8}$/.test(fillValue) ? fillValue : g.fill.fallback;
            return (
              <div
                key={g.fill.key}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {/* The fill, then the text that sits on it — one card each. */}
                <ColorField
                  label={g.fill.label}
                  value={fillValue}
                  fallback={g.fill.fallback}
                  onChange={(v) => setColor(g.fill.key, v)}
                />
                {g.text.map((t) => {
                  const tv = colors[t.key] ?? "";
                  const tShown = /^#[0-9a-fA-F]{3,8}$/.test(tv) ? tv : t.fallback;
                  return (
                    <div key={t.key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <ColorField
                        label={t.label}
                        value={tv}
                        fallback={t.fallback}
                        onChange={(v) => setColor(t.key, v)}
                      />
                      {/* Read the pair exactly as it appears on the site. */}
                      <div
                        style={{
                          background: fillShown,
                          color: tShown,
                          borderRadius: "var(--radius-sm)",
                          padding: "10px 12px",
                          fontSize: 12,
                          border: "1px solid var(--border)",
                        }}
                      >
                        Sample text · {ratioLabel(fillShown, tShown)}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 12, marginTop: 10 }}>
          Each fill owns the text that sits on it, with its live contrast ratio — aim for 4.5 or
          higher. Muted text is derived from each text color automatically. Cards and primary
          buttons share the Surface color. Clear a hex field to fall back to its default.
        </p>
      </div>

      {/* ── Corners & border ── both describe an element's edge, so the corner
          shape and the line drawn around it are chosen side by side. ── */}
      <div>
        <strong style={{ fontSize: 13, color: "var(--on-surface)", display: "block", marginBottom: 10 }}>Corners &amp; border</strong>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {radiusOptions.map((r, i) => {
            const on = r.key === themeRadius;
            const tint = CORNER_TINTS[i % CORNER_TINTS.length];
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => setThemeRadius(r.key)}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer" }}
                title={r.label}
              >
                <span
                  style={{
                    width: 64,
                    height: 64,
                    background: tint,
                    borderRadius: r.preview,
                    border: on ? "3px solid var(--on-surface)" : "3px solid transparent",
                    boxShadow: on ? "none" : "inset 0 0 0 1px var(--border)",
                    transition: "border-color 0.15s ease",
                  }}
                />
                <span style={{ fontSize: 12, color: "var(--on-surface)", fontStyle: on ? "normal" : "italic" }}>
                  {r.label.replace(/\s*\(.*\)$/, "")}
                </span>
              </button>
            );
          })}
        </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: 14,
              minWidth: 200,
            }}
          >
            <ColorField
              label="Border color"
              value={colors.border ?? ""}
              fallback="#2A335C"
              onChange={(v) => setColor("border", v)}
            />
          </div>
        </div>
      </div>

      {/* ── Live preview ── */}
      <div>
        <strong style={{ fontSize: 13, color: "var(--on-surface)", display: "block", marginBottom: 10 }}>Live preview</strong>
        <div className="theme-preview" style={{ borderRadius: "var(--radius-md)", overflow: "hidden", border: "1px solid var(--border)" }}>
          {/* Scoped CSS vars so the preview renders exactly like the live site. */}
          <style>{`.theme-preview{${previewCss}}`}</style>
          <PreviewCard />
        </div>
      </div>
    </div>
  );
}

/** A miniature of the real site, styled entirely by the scoped preview vars. */
function PreviewCard() {
  return (
    <div style={{ background: "var(--bg)", color: "var(--text)", padding: 18, fontFamily: "var(--font-body)" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontWeight: "var(--heading-weight)" as unknown as number, fontSize: 26, letterSpacing: "-0.02em" }}>
        Welcome in. <span style={{ color: "var(--accent-on-bg)" }}>Ask me anything.</span>
      </div>
      <p style={{ color: "var(--text)", fontStyle: "italic", fontSize: "var(--font-size-base)", margin: "6px 0 14px" }}>
        Curious builder. I make things and talk about them.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--on-surface)", borderRadius: "var(--radius-md)", padding: "8px 12px", fontSize: 13 }}>
          A card / bubble
        </span>
        <span style={{ background: "var(--primary)", color: "var(--on-primary)", borderRadius: "var(--radius-md)", padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>
          Primary button
        </span>
      </div>
      <a href="#" onClick={(e) => e.preventDefault()} style={{ color: "var(--accent-on-bg)", fontSize: 13 }}>
        A link on the background
      </a>
    </div>
  );
}

/** A dropdown whose closed value and each option render in that option's font. */
function FontDropdown({
  options,
  value,
  onChange,
}: {
  options: FontOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value) ?? options[0];

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ ...field, marginBottom: 0, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", textAlign: "left", color: "var(--on-bg-soft)" }}
      >
        <span style={{ fontFamily: current?.family, fontSize: 16, color: "var(--on-bg-soft)" }}>{current?.label}</span>
        <span style={{ color: "var(--on-bg-soft)", fontStyle: "italic", fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div style={{ position: "absolute", zIndex: 20, top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 280, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "0 12px 32px rgba(0,0,0,0.4)" }}>
          {options.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                onChange(o.key);
                setOpen(false);
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", background: o.key === value ? "color-mix(in srgb, var(--on-surface) 12%, transparent)" : "transparent", border: "none", color: "var(--on-surface)", cursor: "pointer", fontFamily: o.family, fontSize: 17 }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One color row: a swatch that opens the native picker, its label, and a hex
 * field. Carries no card chrome of its own — the containing group card frames
 * it — and no reset; clearing the hex field falls back to the default.
 */
function ColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const shown = /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {/* The swatch is the color picker — clicking it opens the OS picker. */}
        <span style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}>
          <span
            aria-hidden
            style={{
              display: "block",
              width: 32,
              height: 32,
              borderRadius: "var(--radius-sm)",
              background: shown,
              border: "2px solid var(--border)",
            }}
          />
          <input
            type="color"
            value={shown}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            title={`${label}: ${value || "default"}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          />
        </span>
        <span style={{ fontSize: 12, color: "var(--on-surface)", fontWeight: 600, lineHeight: 1.2 }}>
          {label}
        </span>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={fallback}
        style={{ ...field, marginBottom: 0, color: "var(--on-bg-soft)", fontFamily: "var(--font-mono)", fontSize: 12, padding: "6px 8px" }}
      />
    </div>
  );
}

const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
// The roles shown in the shuffled-preset swatch strip — the three fills that
// carry the palette's character, in the order the picker cards below use.
const PRESET_SWATCH_ROLES = ["bg", "surface", "accent"] as const;
// Fills for the corner-shape previews. These are decorative shape samples, so
// they must stay visible against the editor panel no matter what the live theme
// colors are — a theme whose --primary matches the panel would otherwise make
// the swatch blend in and read as an empty bordered box.
const CORNER_TINTS = ["var(--accent)", "var(--primary)", "var(--border)"];

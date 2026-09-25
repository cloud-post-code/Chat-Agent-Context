import { ImageResponse } from "next/og";
import { getProfile, getPersonaConfig, getThemeConfig } from "@/lib/db";
import { brand, themeVarLines, type ThemeColors } from "@/lib/theme";
import { starterChipsFor } from "@/lib/starterQuestions";
import { safeJson } from "@/lib/util";
import { foundingUser } from "@/lib/users";

// The share thumbnail mirrors the live home hero, so it reads the same
// admin-editable profile + theme per request instead of baking a build-time look.
export const dynamic = "force-dynamic";

export const alt = `${brand.name} — ${brand.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Google family name for an admin font key ("space-grotesk" → "Space Grotesk").
 * Only keys whose family isn't a plain title-casing need an explicit entry.
 */
const FAMILY_EXCEPTIONS: Record<string, string> = {
  playfair: "Playfair Display",
  josefin: "Josefin Sans",
  bebas: "Bebas Neue",
  cormorant: "Cormorant Garamond",
  abril: "Abril Fatface",
};

function googleFamily(key: string): string {
  return (
    FAMILY_EXCEPTIONS[key] ??
    key
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/**
 * Fetch a subsetted TTF from Google Fonts for satori. Returns null on any
 * failure — the image then renders with next/og's built-in font instead of 500ing.
 */
async function loadGoogleFont(
  family: string,
  weight: number,
  text: string,
  italic = false,
): Promise<ArrayBuffer | null> {
  try {
    const axis = italic ? `ital,wght@1,${weight}` : `wght@${weight}`;
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:${axis}&text=${encodeURIComponent(text)}`;
    const css = await (await fetch(url)).text();
    const match = css.match(/src: url\((https:[^)]+)\) format\('(?:opentype|truetype)'\)/);
    if (!match) return null;
    const res = await fetch(match[1]);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** A font at the wanted weight, or 400, or (for the heading) Space Grotesk. */
async function loadWithFallback(
  family: string,
  weight: number,
  text: string,
  italic = false,
): Promise<ArrayBuffer | null> {
  return (
    (await loadGoogleFont(family, weight, text, italic)) ??
    (weight !== 400 ? await loadGoogleFont(family, 400, text, italic) : null)
  );
}

/** Parse themeVarLines' `--a:x;--b:y;` output into a lookup map. */
function parseVars(lines: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines.split(";")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export default async function OgImage() {
  const founder = await foundingUser().catch(() => null);
  const profile = founder ? await getProfile(founder.id).catch(() => null) : null;
  const persona = founder ? await getPersonaConfig(founder.id).catch(() => null) : null;
  const theme = founder ? await getThemeConfig(founder.id).catch(() => null) : null;
  const name = profile?.company_name || profile?.owner_name || brand.name;
  const tagline = persona?.tagline || brand.tagline;

  // Resolve the exact same tokens the layout injects, so the thumbnail keeps
  // matching the site as the admin restyles it.
  const colors = safeJson<ThemeColors>(theme?.themeColors ?? "{}", {});
  const v = parseVars(
    themeVarLines({
      headingFamily: "heading",
      bodyFamily: "body",
      radius: theme?.themeRadius ?? "rounded",
      fontSize: theme?.themeFontSize ?? "",
      headingWeight: theme?.themeHeadingWeight ?? "",
      colors,
    }),
  );
  const bg = v["--bg"] ?? "#0b1020";
  const text = v["--text"] ?? "#e8ecff";
  const accentOnBg = v["--accent-on-bg"] ?? "#ffb84d";
  const bgSoft = v["--bg-soft"] ?? "#12182e";
  const onBgSoft = v["--on-bg-soft"] ?? "#e8ecff";
  const surface = v["--surface"] ?? "#1a2140";
  const onSurface = v["--on-surface"] ?? "#e8ecff";
  const border = v["--border"] ?? "#2a335c";
  const primary = v["--primary"] ?? surface;
  const onPrimary = v["--on-primary"] ?? onSurface;
  const radiusLg = v["--radius-lg"] ?? "22px";
  const radiusMd = v["--radius-md"] ?? "14px";
  const radiusPill = v["--radius-pill"] ?? "999px";
  // themeVarLines only emits 400–900 in hundreds, matching next/og's Weight union.
  const headingWeight = (Number(v["--heading-weight"] ?? "700") || 700) as 400 | 500 | 600 | 700 | 800 | 900;

  const heroLine1 = name;
  const heroLine2 = "Ask me anything.";
  const placeholder = "Type your question…";
  const sendLabel = "Send ↵";
  // The founder's own starter questions; none when the account has none.
  const chips = founder ? (await starterChipsFor(founder.id).catch(() => [])).map((s) => s.q) : [];
  const allText = [heroLine1, heroLine2, tagline, placeholder, sendLabel, ...chips].join("");

  const headingName = googleFamily(theme?.themeFont ?? "space-grotesk");
  const bodyName = googleFamily(theme?.themeBodyFont ?? "inter");
  const [headingData, bodyData, bodyItalicData] = await Promise.all([
    loadWithFallback(headingName, headingWeight, allText).then(
      (d) => d ?? loadWithFallback("Space Grotesk", headingWeight, allText),
    ),
    loadWithFallback(bodyName, 400, allText),
    loadWithFallback(bodyName, 400, allText, true),
  ]);
  const fonts = [
    headingData && { name: "heading", data: headingData, weight: headingWeight, style: "normal" },
    bodyData && { name: "body", data: bodyData, weight: 400, style: "normal" },
    bodyItalicData && { name: "body", data: bodyItalicData, weight: 400, style: "italic" },
  ].filter(Boolean) as {
    name: string;
    data: ArrayBuffer;
    weight: 400 | 500 | 600 | 700 | 800 | 900;
    style: "normal" | "italic";
  }[];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: bg,
          color: text,
          fontFamily: "body",
          padding: "40px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            fontFamily: "heading",
            fontWeight: headingWeight,
            fontSize: 68,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            textAlign: "center",
          }}
        >
          <div style={{ display: "flex" }}>{heroLine1}</div>
          <div style={{ display: "flex", color: accentOnBg }}>{heroLine2}</div>
        </div>

        <div
          style={{
            display: "flex",
            fontStyle: "italic",
            fontSize: 24,
            marginTop: 20,
            maxWidth: 700,
            textAlign: "center",
          }}
        >
          {tagline}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
            marginTop: 34,
            maxWidth: 980,
          }}
        >
          {chips.map((q) => (
            <div
              key={q}
              style={{
                display: "flex",
                background: bgSoft,
                border: `1px solid ${border}`,
                color: onBgSoft,
                borderRadius: radiusPill,
                padding: "11px 20px",
                fontSize: 17,
                whiteSpace: "nowrap",
              }}
            >
              {q}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: surface,
            border: `1px solid ${border}`,
            borderRadius: radiusLg,
            padding: 10,
            width: 620,
            marginTop: 34,
          }}
        >
          <div
            style={{
              display: "flex",
              color: onSurface,
              fontStyle: "italic",
              fontSize: 19,
              padding: "10px 14px",
            }}
          >
            {placeholder}
          </div>
          <div
            style={{
              display: "flex",
              background: primary,
              color: onPrimary,
              borderRadius: radiusMd,
              padding: "14px 18px",
              fontWeight: 400,
              fontSize: 16,
            }}
          >
            {sendLabel}
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}

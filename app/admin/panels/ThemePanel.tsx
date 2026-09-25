import { safeJson } from "@/lib/util";
import { FONT_OPTIONS, BODY_FONT_OPTIONS } from "@/lib/fonts";
import { RADIUS_OPTIONS } from "@/lib/theme";
import { saveTheme } from "@/app/admin/actions/profile";
import { SaveButton } from "../SaveButton";
import { ThemePicker } from "../ThemePicker";
import { panel, field, SectionTitle, Label } from "../ui";
import type { AdminData } from "./queries";

export function ThemePanel({ data }: { data: AdminData }) {
  const { personaConfig, themeConfig, colors } = data;
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Theme</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 18 }}>
        Everything here restyles the live site.
      </p>

      <form action={saveTheme}>
        <Label>Aesthetic (describe the visual feeling you want)</Label>
        <textarea name="aesthetic" defaultValue={themeConfig.aesthetic} rows={2} style={{ ...field, resize: "vertical" }} />

        {/* ── Brand voice: tagline (with provenance), values, tone. ── */}
        <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0", paddingTop: 16 }}>
          <Label>
            Tagline
            {personaConfig.tagline && personaConfig.taglineSource === "suggested" && (
              <span
                style={{
                  marginLeft: 8, fontSize: 11, padding: "2px 8px", borderRadius: 999,
                  background: "var(--bg-soft)", border: "1px solid var(--border)",
                  fontStyle: "italic", fontWeight: 400,
                }}
                title="Your site doesn't state a tagline, so this one was written from your site's own copy during onboarding."
              >
                suggested — not from your site
              </span>
            )}
          </Label>
          <input name="tagline" defaultValue={personaConfig.tagline} style={field} />
          <input type="hidden" name="taglineSource" defaultValue={personaConfig.taglineSource} />

          <Label>Brand values (one per line — what the business stands for)</Label>
          <textarea
            name="brandValues"
            defaultValue={safeJson<string[]>(personaConfig.brandValues, []).join("\n")}
            rows={3}
            style={{ ...field, resize: "vertical" }}
          />

          <Label>Tone of voice (how your agent writes — used as a style instruction)</Label>
          <textarea
            name="toneOfVoice"
            defaultValue={personaConfig.toneOfVoice}
            rows={2}
            style={{ ...field, resize: "vertical" }}
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", margin: "16px 0", paddingTop: 16 }}>
          <ThemePicker
            fontOptions={FONT_OPTIONS}
            bodyFontOptions={BODY_FONT_OPTIONS}
            radiusOptions={RADIUS_OPTIONS}
            initial={{
              themeFont: themeConfig.themeFont,
              themeBodyFont: themeConfig.themeBodyFont,
              themeRadius: themeConfig.themeRadius,
              themeFontSize: themeConfig.themeFontSize,
              themeHeadingWeight: themeConfig.themeHeadingWeight,
              colors,
            }}
          />
        </div>

        <SaveButton>Save theme</SaveButton>
      </form>
    </section>
  );
}

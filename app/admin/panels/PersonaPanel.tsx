import { PERSONA_BLURB, PERSONA_SECTIONS } from "@/lib/persona";
import { savePersona, uploadLogo } from "@/app/admin/actions/profile";
import { PersonaPrompt } from "../PersonaPrompt";
import { personaExtractionPrompt } from "@/lib/personaPrompt";
import { SaveButton } from "../SaveButton";
import { AutoUploadFile } from "../AutoUploadFile";
import { panel, field, SectionTitle, Label } from "../ui";
import type { AdminData } from "./queries";

export function PersonaPanel({ data }: { data: AdminData }) {
  const { personaConfig, personaSections } = data;
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Persona</SectionTitle>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 18 }}>
        {PERSONA_BLURB}
      </p>

      {/* Company logo — auto-uploads the moment a file is chosen. */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
        {personaConfig.company_logo ? (
          /* "contain" so the preview shows the whole mark — the same rule the
             public header uses; "cover" cropped wide wordmarks. */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={personaConfig.company_logo} alt="company logo" style={{ width: 72, height: 72, borderRadius: "var(--radius-md)", objectFit: "contain", background: "var(--bg-soft)", padding: 6, border: "1px solid var(--border)" }} />
        ) : (
          <div style={{ width: 72, height: 72, borderRadius: "var(--radius-md)", background: "var(--bg-soft)", border: "1px solid var(--border)" }} />
        )}
        <form action={uploadLogo}>
          <Label>Company logo</Label>
          <AutoUploadFile name="file" accept="image/*" hint="Pick an image — it uploads automatically." />
        </form>
      </div>

      <PersonaPrompt prompt={personaExtractionPrompt()} />

      <form action={savePersona}>
        <Label>Tagline (shown under the company name on the live site)</Label>
        <input name="tagline" defaultValue={personaConfig.tagline} style={field} />

        <div style={{ borderTop: "1px solid var(--border)", margin: "18px 0", paddingTop: 16 }}>
          {PERSONA_SECTIONS.map((s) => (
            <div key={s.key} style={{ marginBottom: 4 }}>
              <Label>{s.label}</Label>
              <textarea
                name={`section_${s.key}`}
                defaultValue={personaSections[s.key]}
                rows={s.rows}
                placeholder={s.hint}
                style={{ ...field, resize: "vertical", lineHeight: 1.5 }}
              />
            </div>
          ))}
        </div>

        <SaveButton>Save persona</SaveButton>
      </form>
    </section>
  );
}

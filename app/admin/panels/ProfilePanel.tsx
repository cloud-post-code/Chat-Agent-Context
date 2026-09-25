import { parseSocialLinks } from "@/lib/socialLinks";
import { saveProfile, restartOnboarding } from "@/app/admin/actions/profile";
import { PendingButton } from "../PendingButton";
import { SaveButton } from "../SaveButton";
import { panel, field, btnDanger, SectionTitle, Label } from "../ui";
import { grid2 } from "./shared";
import type { AdminData } from "./queries";

export function ProfilePanel({ data }: { data: AdminData }) {
  const { profile, photos } = data;
  return (
    <section data-fill="surface" style={panel}>
      <SectionTitle>Profile</SectionTitle>

      <form action={saveProfile}>
        <div style={grid2}>
          <div>
            <Label>Company name</Label>
            <input name="company_name" defaultValue={profile.company_name} style={field} />
          </div>
          <div>
            <Label>Owner name</Label>
            <input name="owner_name" defaultValue={profile.owner_name} style={field} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Company address</Label>
          <input name="company_address" defaultValue={profile.company_address} placeholder="Street, City, State" style={field} />
        </div>
        <div style={grid2}>
          <div>
            <Label>Company phone number</Label>
            <input name="company_phone_number" defaultValue={profile.company_phone_number} style={field} />
          </div>
          <div>
            <Label>Company email</Label>
            <input name="company_email" defaultValue={profile.company_email} style={field} />
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Company hours</Label>
          <input name="company_hours" defaultValue={profile.company_hours} placeholder="Mon-Fri 9am-5pm" style={field} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <Label>Social media (one per line, &quot;platform: link&quot;)</Label>
          <textarea
            name="social_links"
            rows={3}
            defaultValue={parseSocialLinks(profile.social_links)
              .map((s) => (s.platform ? `${s.platform}: ${s.url}` : s.url))
              .join("\n")}
            placeholder={"instagram: https://instagram.com/yourbusiness"}
            style={{ ...field, resize: "vertical" }}
          />
        </div>

        <SaveButton>Save profile</SaveButton>
      </form>

      <form action={restartOnboarding} style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <PendingButton pendingLabel="Clearing…" style={btnDanger}>
          Restart onboarding — clears all account data
        </PendingButton>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 12, marginTop: 6 }}>
          Deletes everything on this account — profile, knowledge, photos, chats, persona, and theme — and walks you through setup again.
        </p>
      </form>
    </section>
  );
}

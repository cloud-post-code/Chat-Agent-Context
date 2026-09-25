"use server";

import { redirect } from "next/navigation";
import { prisma, getProfile } from "@/lib/db";
import { sanitizeSocialLinks } from "@/lib/socialLinks";
import { provisionUserDefaults } from "@/lib/users";
import { indexProfile, indexPersona } from "@/lib/retrieval/origins";
import { savePersonaBrand } from "@/lib/brand";
import { PERSONA_SECTIONS, writePersonaSections } from "@/lib/persona";
import { COLOR_ROLES } from "@/lib/theme";
import { saveUpload } from "@/lib/uploads";
import { wipeAccountContent } from "@/lib/accountWipe";
import { requireUser, reindex, isUpload, revalidateAll } from "./_shared";

// ── Profile (business identity) ──
export async function saveProfile(formData: FormData) {
  const user = await requireUser();
  await getProfile(user.id);

  await prisma.profile.update({
    where: { userId: user.id },
    data: {
      company_name: String(formData.get("company_name") ?? ""),
      owner_name: String(formData.get("owner_name") ?? ""),
      company_address: String(formData.get("company_address") ?? ""),
      company_phone_number: String(formData.get("company_phone_number") ?? ""),
      company_email: String(formData.get("company_email") ?? ""),
      company_hours: String(formData.get("company_hours") ?? ""),
      social_links: JSON.stringify(sanitizeSocialLinks(
        String(formData.get("social_links") ?? "")
          .split("\n")
          .map((line) => {
            const m = line.trim().match(/^(?:([^:\s][^:]*?):\s*)?(https?:\/\/\S+)$/i);
            return m ? { platform: (m[1] ?? "").toLowerCase(), url: m[2] } : null;
          })
          .filter(Boolean),
      )),
    },
  });
  await reindex("profile", () => indexProfile(user.id));
  revalidateAll();
}

/**
 * Wipe the account's data and send the user back through guided onboarding.
 * The button lives at the bottom of the Profile tab; clearing onboardedAt is
 * what routes the next admin visit into the flow again.
 *
 * "Wipe" is a full content reset, not just the profile — see
 * lib/accountWipe.ts for exactly what goes (everything onboarding or the
 * dashboard populated, including the booking domain, menu, orders and the
 * uploaded files on the volume) and what stays (the login and GmailAuth).
 */
export async function restartOnboarding() {
  const user = await requireUser();
  await wipeAccountContent(user.id);

  // The transaction above clears the rows a NEW account is provisioned with —
  // ingestion sources, A2UI cards, starter answers, persona and theme. Without
  // putting them back the account restarts onboarding with no content tabs, no
  // cards and no starter questions, which is what "reset isn't working" looked
  // like: it wiped everything and rebuilt nothing.
  await provisionUserDefaults(user.id);

  revalidateAll();
  redirect("/admin/onboarding");
}

// ── Persona (the section catalogue in lib/persona.ts) ──
export async function savePersona(formData: FormData) {
  const user = await requireUser();

  // Driven by the catalogue so adding a section can't silently fail to save.
  const sections: Record<string, string> = {};
  for (const s of PERSONA_SECTIONS) {
    sections[s.key] = String(formData.get(`section_${s.key}`) ?? "");
  }

  // A tagline edited here is the owner's own wording — the extracted/
  // suggested provenance flag only survives while the text is unchanged.
  const tagline = String(formData.get("tagline") ?? "");
  const existing = await prisma.personaConfig.findUnique({ where: { userId: user.id } });
  const taglineSource = existing && existing.tagline === tagline ? existing.taglineSource : "";
  await prisma.personaConfig.upsert({
    where: { userId: user.id },
    update: { tagline, taglineSource },
    create: { userId: user.id, tagline, taglineSource },
  });
  await writePersonaSections(user.id, sections);
  await reindex("persona", () => indexPersona(user.id));
  revalidateAll();
}

// ── Theme (aesthetic description + the design tokens the site renders from) ──
export async function saveTheme(formData: FormData) {
  const user = await requireUser();

  // Driven by COLOR_ROLES so adding a role to the design panel can't silently
  // fail to save. Only valid hex values are stored — a blank or malformed entry
  // is omitted entirely so the role falls back to its default rather than being
  // persisted as an empty string.
  const colors: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    const v = String(formData.get(`color_${role.key}`) ?? "").trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) colors[role.key] = v;
  }

  const theme = {
    aesthetic: String(formData.get("aesthetic") ?? ""),
    themeFont: String(formData.get("themeFont") ?? "space-grotesk"),
    themeBodyFont: String(formData.get("themeBodyFont") ?? "inter"),
    themeRadius: String(formData.get("themeRadius") ?? "rounded"),
    themeFontSize: String(formData.get("themeFontSize") ?? "").trim(),
    themeHeadingWeight: String(formData.get("themeHeadingWeight") ?? "").trim(),
    themeColors: JSON.stringify(colors),
  };
  await prisma.themeConfig.upsert({
    where: { userId: user.id },
    update: theme,
    create: { userId: user.id, ...theme },
  });

  // Brand voice lives on the Theme tab too — tagline (with its extracted/
  // suggested provenance flag), brand values (one per line), tone of voice.
  // An edited tagline is the owner's own wording, so the provenance flag
  // only survives while the text matches what is stored.
  const tagline = String(formData.get("tagline") ?? "");
  const existingPersona = await prisma.personaConfig.findUnique({ where: { userId: user.id } });
  await savePersonaBrand(user.id, {
    tagline,
    taglineSource:
      existingPersona && existingPersona.tagline === tagline.trim()
        ? String(formData.get("taglineSource") ?? "")
        : "",
    values: String(formData.get("brandValues") ?? "").split("\n"),
    tone: String(formData.get("toneOfVoice") ?? ""),
  });
  revalidateAll();
}

/** Company logo image upload. */
export async function uploadLogo(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  const filename = await saveUpload(file);
  const company_logo = `/api/uploads/${filename}`;
  await prisma.personaConfig.upsert({
    where: { userId: user.id },
    update: { company_logo },
    create: { userId: user.id, company_logo },
  });
  revalidateAll();
}

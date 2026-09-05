import { prisma } from "@/lib/db";

/**
 * Persist the brand-voice fields onto PersonaConfig. Shared by the
 * onboarding save route and the dashboard Theme tab's save action so the two
 * surfaces cannot drift. Values are validated here — the source flag is
 * clamped to its vocabulary (an empty tagline always clears it), and values
 * are stored as a JSON string array.
 */

export type PersonaBrand = {
  tagline: string;
  taglineSource: string;
  values: string[];
  tone: string;
};

export async function savePersonaBrand(userId: string, brand: PersonaBrand): Promise<void> {
  const tagline = brand.tagline.trim().slice(0, 200);
  const taglineSource =
    tagline && (brand.taglineSource === "extracted" || brand.taglineSource === "suggested")
      ? brand.taglineSource
      : "";
  const data = {
    tagline,
    taglineSource,
    brandValues: JSON.stringify(
      brand.values.map((v) => v.trim().slice(0, 120)).filter(Boolean).slice(0, 5),
    ),
    toneOfVoice: brand.tone.trim().slice(0, 600),
  };
  await prisma.personaConfig.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

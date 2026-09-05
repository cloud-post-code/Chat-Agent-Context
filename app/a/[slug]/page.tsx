import { notFound } from "next/navigation";
import { prisma, getProfile, getPersonaConfig, getThemeConfig } from "@/lib/db";
import { starterChipsFor } from "@/lib/starterQuestions";
import { TenantThemeStyle } from "@/app/TenantThemeStyle";
import Chat from "@/app/Chat";

/**
 * One user's public agent page: their chat, their knowledge, their theme.
 * The slug is the stable public address — /a/<slug>.
 */

// Reads the DB per-request (profile is admin-editable) — never prerender.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) return { title: "Agent not found" };
  const [profile, persona] = await Promise.all([
    getProfile(user.id),
    getPersonaConfig(user.id),
  ]);
  const name = profile.company_name || profile.owner_name || user.name;
  return {
    title: `${name} — chat`,
    description: persona.tagline || `Chat with ${name}'s AI agent.`,
  };
}

export default async function AgentPage({ params }: Params) {
  const { slug } = await params;
  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) notFound();

  const [profile, persona, theme, starters] = await Promise.all([
    getProfile(user.id),
    getPersonaConfig(user.id),
    getThemeConfig(user.id).catch(() => null),
    starterChipsFor(user.id),
  ]);

  return (
    <>
      <TenantThemeStyle theme={theme} />
      <Chat
        name={profile.company_name || profile.owner_name || user.name}
        tagline={persona.tagline}
        logo={persona.company_logo}
        starters={starters}
        slug={user.slug}
      />
    </>
  );
}

import { tenantBySlug } from "@/lib/tenant";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getProfile, getPersonaConfig, getThemeConfig } from "@/lib/db";
import { starterChipsFor } from "@/lib/starterQuestions";
import { homePhotos } from "@/lib/cards";
import { TenantThemeStyle } from "@/app/TenantThemeStyle";
import Chat from "@/app/Chat";
import { siteOrigin } from "@/lib/util";

/**
 * One user's public agent page: their chat, their knowledge, their theme.
 * The slug is the stable public address — /a/<slug>.
 */

// Reads the DB per-request (profile is admin-editable) — never prerender.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug } = await params;
  const user = await tenantBySlug(slug);
  if (!user) return { title: "Agent not found" };
  const [profile, persona] = await Promise.all([
    getProfile(user.id),
    getPersonaConfig(user.id),
  ]);
  const name = profile.company_name || profile.owner_name || user.name;
  // The Markdown twin of this page, for an LLM that reads <head> before
  // deciding what to fetch (lib/llms.ts).
  const page = `${siteOrigin(await headers())}/a/${user.slug}`;
  return {
    title: `${name} — chat`,
    description: persona.tagline || `Chat with ${name}'s AI agent.`,
    alternates: {
      types: {
        "text/markdown": [{ url: `${page}/llms-full.txt`, title: `${name} — everything, in Markdown` }],
        "text/plain": [{ url: `${page}/llms.txt`, title: `${name} — llms.txt` }],
      },
    },
  };
}

export default async function AgentPage({ params }: Params) {
  const { slug } = await params;
  const user = await tenantBySlug(slug);
  if (!user) notFound();

  const [profile, persona, theme, starters, photos] = await Promise.all([
    getProfile(user.id),
    getPersonaConfig(user.id),
    getThemeConfig(user.id).catch(() => null),
    starterChipsFor(user.id),
    // Decoration only: the page must render even if the photo read fails.
    homePhotos(user.id).catch(() => []),
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
        photos={photos}
      />
    </>
  );
}

import { getProfile, getPersonaConfig } from "@/lib/db";
import Chat from "./Chat";
import { starterQuestions } from "@/lib/theme";

// Reads the DB per-request (profile is admin-editable) — never prerender.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [profile, persona] = await Promise.all([getProfile(), getPersonaConfig()]);
  return (
    <Chat
      name={profile.company_name || profile.owner_name}
      tagline={persona.tagline}
      logo={persona.company_logo}
      starters={starterQuestions}
    />
  );
}

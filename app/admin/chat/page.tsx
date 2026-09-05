import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { TenantThemeStyle } from "@/app/TenantThemeStyle";
import { buildAdminPanels } from "../panels";
import { adminPanelKeys } from "@/lib/adminBrain";
import { AdminChat } from "./AdminChat";

export const dynamic = "force-dynamic";

/**
 * The chat-first admin surface. Every dashboard panel is pre-rendered here
 * (same builder as the classic page) and handed to the client chat, which
 * reveals panels inline as the copilot calls for them. The classic dashboard
 * stays one menu click away.
 */
export default async function AdminChatPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (!user.onboardedAt) redirect("/admin/onboarding");

  const set = await buildAdminPanels(user, {});
  const menu = await adminPanelKeys(user.id, set.operator);

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "16px 16px 40px", minHeight: "100dvh", display: "flex", flexDirection: "column" }}>
      <TenantThemeStyle theme={set.themeConfig} />
      <AdminChat
        name={user.name}
        slug={user.slug}
        menu={menu}
        labels={set.labels}
        panels={set.flat}
      />
    </main>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { TenantThemeStyle } from "@/app/TenantThemeStyle";
import { logout, setIngestionSourceHiddenAction } from "../actions";
import { PendingButton } from "../PendingButton";
import { Tabs } from "../Tabs";
import { SubTabs } from "../SubTabs";
import { resolveAdminTab, NEW_SOURCE_TAB_KEY } from "../contentTabs";
import { buildAdminPanels } from "../panels";
import { btnGhost } from "../ui";

export const dynamic = "force-dynamic";

/**
 * The classic full-page dashboard. Every panel is built once in
 * app/admin/panels.tsx (shared with the chat-first surface at /admin/chat);
 * this page only lays them out on the Tabs/SubTabs strips.
 */
export default async function Dashboard({
  searchParams,
}: {
  // Deep links (?tab=…) open the dashboard on a specific tab.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user) redirect("/admin");
  // First login: the guided onboarding flow owns the panel until completed.
  if (!user.onboardedAt) redirect("/admin/onboarding");

  const query = await searchParams;
  const one = (k: string) => (Array.isArray(query[k]) ? query[k][0] : query[k]);

  const set = await buildAdminPanels(user, { error: one("error"), gmail: one("gmail") });
  const { flat, labels, contentKeys, hiddenSources } = set;

  // ?tab= deep links resolve against the live source keys so custom tabs
  // deep-link too; every non-content key targets its own nav entry.
  const { nav: initialNav, sub: initialSub } = resolveAdminTab(
    one("tab"),
    contentKeys.filter((k) => k !== NEW_SOURCE_TAB_KEY),
  );

  const sub = (keys: string[]) =>
    keys.filter((k) => flat[k] !== undefined).map((k) => ({
      key: k,
      label: labels[k] ?? k,
      content: flat[k],
    }));

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 80px" }}>
      {/* The dashboard wears its owner's theme, so Theme-tab edits show here. */}
      <TenantThemeStyle theme={set.themeConfig} />
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26 }}>Control room</h1>
          <p style={{ color: "var(--text)", fontStyle: "italic", fontSize: 14 }}>
            Everything here feeds your agent page at <a href={`/a/${user.slug}`}>/a/{user.slug}</a>.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/admin/chat" style={btnGhost as React.CSSProperties}>✦ Chat</Link>
          <Link href="/" style={btnGhost as React.CSSProperties}>View site</Link>
          <form action={logout}>
            <PendingButton pendingLabel="Logging out…" style={btnGhost as React.CSSProperties}>
              Log out
            </PendingButton>
          </form>
        </div>
      </header>

      <Tabs
        initial={initialNav}
        tabs={[
          {
            key: "profile",
            label: "Me",
            content: (
              <SubTabs initial={initialSub} ariaLabel="Me sections" tabs={sub(["profile", "theme"])} />
            ),
          },
          {
            key: "content",
            label: "Content",
            content: (
              <>
                {hiddenSources.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 10,
                      marginBottom: 10,
                      fontSize: 13,
                      color: "var(--on-surface)",
                    }}
                  >
                    <span style={{ fontStyle: "italic" }}>
                      Hidden sources ({hiddenSources.length}):
                    </span>
                    {hiddenSources.map((s) => (
                      <form
                        key={s.id}
                        action={setIngestionSourceHiddenAction}
                        style={{ display: "flex", alignItems: "center", gap: 4 }}
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="hidden" value="" />
                        <span>{s.label}</span>
                        <PendingButton
                          pendingLabel="…"
                          style={{
                            fontSize: 13,
                            textDecoration: "underline",
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            color: "inherit",
                          }}
                        >
                          (show)
                        </PendingButton>
                      </form>
                    ))}
                  </div>
                ) : null}
                <SubTabs initial={initialSub} tabs={sub(contentKeys)} />
              </>
            ),
          },
          {
            key: "graph",
            label: "Knowledge",
            content: flat.graph,
          },
          {
            key: "activity",
            label: "Activity",
            content: flat.activity,
          },
          {
            key: "agent",
            label: "Agent Behavior",
            content: (
              <SubTabs
                initial={initialSub}
                ariaLabel="Agent Behavior sections"
                tabs={sub(["answers", "goals", "rules", "contacts", "a2ui"])}
              />
            ),
          },
          // Unconditional: the Calendar carries the Appointments settings, so
          // turning booking off must not remove the way to turn it back on.
          { key: "calendar", label: "Calendar", content: flat.calendar },
          ...(set.operator ? [{ key: "users", label: "Users", content: flat.users }] : []),
        ]}
      />
    </main>
  );
}

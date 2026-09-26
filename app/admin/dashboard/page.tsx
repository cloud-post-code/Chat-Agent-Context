import { redirect } from "next/navigation";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { TenantThemeStyle } from "@/app/TenantThemeStyle";
import { logout } from "@/app/admin/actions/auth";
import { setIngestionSourceHiddenAction } from "@/app/admin/actions/ingestion";
import { PendingButton } from "../PendingButton";
import { Tabs } from "../Tabs";
import { SubTabs } from "../SubTabs";
import { resolveAdminTab, NAV_GROUPS, NEW_SOURCE_TAB_KEY, type NavGroup } from "../contentTabs";
import { buildAdminPanels } from "../panels";
import { btnGhost } from "../ui";

export const dynamic = "force-dynamic";

/**
 * The classic full-page dashboard. Every panel is built once in
 * app/admin/panels/index.tsx (shared with the chat-first surface at /admin/chat);
 * this page only lays them out on the Tabs/SubTabs strips, in the groups
 * NAV_GROUPS declares.
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

  const set = await buildAdminPanels(user, { error: one("error"), booking: one("booking") });
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

  // Knowledge leads with the live source tabs; every other group is fixed.
  const keysFor = (g: NavGroup) =>
    g.key === "knowledge"
      ? [...contentKeys.filter((k) => k !== NEW_SOURCE_TAB_KEY), ...g.subs.map((s) => s.key)]
      : g.subs.map((s) => s.key);

  const groupContent = (g: NavGroup) => {
    const tabs = sub(keysFor(g));
    if (tabs.length === 0) return null;
    // A single panel needs no strip (Home, Cards).
    if (tabs.length === 1) return tabs[0].content;
    // Keyed on the resolved sub so a same-route ?tab= link (Home's rows)
    // remounts the strip on the new tab; useState never re-syncs otherwise.
    return (
      <>
        {g.key === "knowledge" ? <HiddenSources rows={hiddenSources} /> : null}
        <SubTabs key={initialSub} initial={initialSub} ariaLabel={`${g.label} sections`} tabs={tabs} />
      </>
    );
  };

  const tabs = NAV_GROUPS.map((g) => ({ key: g.key, label: g.label, content: groupContent(g) }))
    .filter((t) => t.content !== null);

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
          <Link href={`/a/${user.slug}`} style={btnGhost as React.CSSProperties}>View site</Link>
          <form action={logout}>
            <PendingButton pendingLabel="Logging out…" style={btnGhost as React.CSSProperties}>
              Log out
            </PendingButton>
          </form>
        </div>
      </header>

      <Tabs key={initialNav ?? "home"} initial={initialNav} tabs={tabs} />
    </main>
  );
}

/** Disabled sources, each with a one-click "show" so they can come back. */
function HiddenSources({ rows }: { rows: { id: string; label: string }[] }) {
  if (rows.length === 0) return null;
  return (
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
      <span style={{ fontStyle: "italic" }}>Hidden sources ({rows.length}):</span>
      {rows.map((s) => (
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
  );
}

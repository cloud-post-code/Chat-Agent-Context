import Link from "next/link";
import { prisma } from "@/lib/db";

/**
 * The public directory: every agent page on this deployment, with a name and
 * a link. The old single-tenant chat that lived here is now per-user at
 * /a/[slug].
 */

export const dynamic = "force-dynamic";

export default async function DirectoryPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      slug: true,
      name: true,
      profile: { select: { company_name: true, owner_name: true } },
      personaConfig: { select: { tagline: true, company_logo: true } },
    },
  });

  const agents = users.map((u) => ({
    slug: u.slug,
    name:
      u.profile?.company_name?.trim() ||
      u.profile?.owner_name?.trim() ||
      u.name,
    tagline: u.personaConfig?.tagline?.trim() || "",
    logo: u.personaConfig?.company_logo || null,
  }));

  return (
    <main style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <h1 style={s.h1}>Agent directory</h1>
          <p style={s.lede}>
            Every agent page on this site. Each one chats from its owner&apos;s own
            knowledge, in its owner&apos;s own voice.
          </p>
          <nav style={s.nav}>
            <Link href="/signup" style={s.cta}>
              Create your agent page →
            </Link>
            <Link href="/admin" style={s.navLink}>
              Log in
            </Link>
          </nav>
        </header>

        {agents.length === 0 ? (
          <p style={s.empty}>
            No agent pages yet. <Link href="/signup" style={s.navLink}>Be the first.</Link>
          </p>
        ) : (
          <div style={s.list}>
            {agents.map((a) => (
              <Link key={a.slug} href={`/a/${a.slug}`} style={s.card} data-fill="surface">
                {a.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.logo} alt="" style={s.logo} />
                ) : (
                  <div style={s.logoFallback}>{a.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div style={s.cardBody}>
                  <span style={s.cardName}>{a.name}</span>
                  {a.tagline && <span style={s.cardTagline}>{a.tagline}</span>}
                  <code style={s.cardPath}>/a/{a.slug}</code>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100dvh", background: "var(--bg)", padding: "48px 20px" },
  wrap: { maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 },
  header: { display: "flex", flexDirection: "column", gap: 10 },
  h1: { fontSize: 36, lineHeight: 1.15, margin: 0 },
  lede: { fontSize: 16, lineHeight: 1.6, color: "var(--text)", opacity: 0.8, margin: 0 },
  nav: { display: "flex", gap: 18, alignItems: "center", marginTop: 6 },
  cta: {
    padding: "10px 16px",
    background: "var(--primary)",
    color: "var(--on-primary)",
    borderRadius: "var(--radius-md)",
    textDecoration: "none",
    fontWeight: 600,
    fontSize: 14,
  },
  navLink: { color: "var(--accent-on-bg)", textDecoration: "none", fontSize: 14 },
  empty: { fontSize: 15, opacity: 0.75 },
  list: { display: "flex", flexDirection: "column", gap: 12 },
  card: {
    display: "flex",
    gap: 14,
    alignItems: "center",
    padding: "16px 18px",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    textDecoration: "none",
    color: "var(--on-surface)",
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: "var(--radius-md)",
    objectFit: "cover",
    flexShrink: 0,
  },
  logoFallback: {
    width: 44,
    height: 44,
    borderRadius: "var(--radius-md)",
    background: "var(--bg-soft)",
    color: "var(--on-bg-soft)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 18,
    flexShrink: 0,
  },
  cardBody: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  cardName: { fontWeight: 600, fontSize: 16 },
  cardTagline: { fontSize: 13.5, opacity: 0.75, lineHeight: 1.4 },
  cardPath: { fontFamily: "var(--font-mono), monospace", fontSize: 12, opacity: 0.6 },
};

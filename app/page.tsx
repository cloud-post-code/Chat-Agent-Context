import Link from "next/link";
import { prisma } from "@/lib/db";
import { themeVarLines, type ThemeColors } from "@/lib/theme";
import { headingFamily, bodyFamily } from "@/lib/fonts";
import { safeJson } from "@/lib/util";

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
      personaConfig: { select: { tagline: true, company_logo: true, brandValues: true } },
      themeConfig: {
        select: {
          themeFont: true,
          themeBodyFont: true,
          themeColors: true,
          themeRadius: true,
          themeHeadingWeight: true,
        },
      },
    },
  });

  const agents = users.map((u) => {
    let values: string[] = [];
    try {
      const parsed = JSON.parse(u.personaConfig?.brandValues || "[]");
      if (Array.isArray(parsed)) values = parsed.filter((v) => typeof v === "string").slice(0, 3);
    } catch {
      // malformed brandValues JSON — show no tags
    }
    return {
      slug: u.slug,
      name:
        u.profile?.company_name?.trim() ||
        u.profile?.owner_name?.trim() ||
        u.name,
      tagline: u.personaConfig?.tagline?.trim() || "",
      logo: u.personaConfig?.company_logo || null,
      values,
      theme: u.themeConfig,
    };
  });

  // Each card wears its company's own theme: the same CSS variables that skin
  // the tenant's agent page, scoped to the card via its data attribute. Cards
  // without a ThemeConfig keep the Main Street brand defaults.
  const cardThemeCss = agents
    .filter((a) => a.theme)
    .map((a) => {
      const t = a.theme!;
      const vars = themeVarLines({
        headingFamily: headingFamily(t.themeFont ?? "space-grotesk"),
        bodyFamily: bodyFamily(t.themeBodyFont ?? "inter"),
        radius: t.themeRadius ?? "rounded",
        headingWeight: t.themeHeadingWeight ?? "",
        colors: safeJson<ThemeColors>(t.themeColors ?? "{}", {}),
      });
      return `[data-agent-card=${JSON.stringify(a.slug)}]{${vars}}`;
    })
    .join("\n");

  return (
    <main style={s.page}>
      <div style={s.wrap}>
        <header style={s.header}>
          <div style={s.sign} data-fill="surface">
            MAIN STREET
          </div>
          <h1 style={s.h1}>Agent directory</h1>
          <p style={s.lede}>
            The joy of Main Street, delivered to your door. Every agent page on
            this site chats from its owner&apos;s own knowledge, in its
            owner&apos;s own voice.
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
          <div style={s.grid}>
            {cardThemeCss && <style dangerouslySetInnerHTML={{ __html: cardThemeCss }} />}
            {agents.map((a) => (
              <Link
                key={a.slug}
                href={`/a/${a.slug}`}
                style={s.card}
                data-fill="surface"
                data-agent-card={a.slug}
              >
                {a.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.logo} alt="" style={s.cardImage} />
                ) : (
                  <div style={s.cardImageFallback}>{a.name.slice(0, 1).toUpperCase()}</div>
                )}
                <div style={s.cardBody}>
                  <span style={s.cardName}>{a.name}</span>
                  {a.tagline && <span style={s.cardTagline}>{a.tagline}</span>}
                  {a.values.length > 0 && (
                    <div style={s.cardTags}>
                      {a.values.map((v) => (
                        <span key={v} style={s.cardTag}>
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
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
  wrap: { maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 28 },
  header: { display: "flex", flexDirection: "column", gap: 10, maxWidth: 720 },
  // The street-sign wordmark: green plate, thin inner keyline, spaced serif caps.
  sign: {
    alignSelf: "flex-start",
    background: "var(--primary)",
    color: "var(--on-primary)",
    fontFamily: "var(--font-heading), serif",
    fontWeight: 700,
    fontSize: 20,
    letterSpacing: "0.22em",
    padding: "12px 26px 12px calc(26px + 0.22em)",
    border: "5px solid var(--primary)",
    borderRadius: "var(--radius-md)",
    boxShadow: "inset 0 0 0 1.5px var(--on-primary)",
    marginBottom: 6,
  },
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
  // Responsive card grid: 3 per row at full width, fewer on narrow screens.
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
    gap: 20,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-lg)",
    overflow: "hidden",
    textDecoration: "none",
    color: "var(--on-surface)",
    fontFamily: "var(--font-body), sans-serif",
  },
  cardImage: {
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover",
    display: "block",
    borderBottom: "1px solid var(--border)",
  },
  cardImageFallback: {
    width: "100%",
    aspectRatio: "16 / 9",
    background: "var(--surface)",
    color: "var(--on-surface)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-heading), serif",
    fontWeight: 700,
    fontSize: 44,
    borderBottom: "1px solid var(--border)",
  },
  cardName: {
    fontWeight: "var(--heading-weight, 600)" as React.CSSProperties["fontWeight"],
    fontSize: 16,
    lineHeight: 1.3,
    fontFamily: "var(--font-heading), serif",
  },
  cardBody: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "14px 16px 16px",
    minWidth: 0,
    flexGrow: 1,
  },
  cardTagline: { fontSize: 13.5, opacity: 0.75, lineHeight: 1.4 },
  cardTags: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 },
  // Outlined in the card's own text color, so chips stay readable on any
  // tenant surface (a solid chip fill can pair badly with partial themes).
  cardTag: {
    fontSize: 11.5,
    lineHeight: 1,
    padding: "5px 9px",
    borderRadius: "var(--radius-pill)",
    border: "1px solid",
    color: "inherit",
    opacity: 0.85,
    whiteSpace: "nowrap",
  },
  cardPath: {
    fontFamily: "var(--font-mono), monospace",
    fontSize: 12,
    opacity: 0.6,
    marginTop: "auto",
    paddingTop: 6,
  },
};

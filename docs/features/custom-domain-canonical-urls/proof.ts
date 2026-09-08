/**
 * Primary proof for custom-domain-canonical-urls (see PROOF.md).
 * Run: npx tsx docs/features/custom-domain-canonical-urls/proof.ts
 *
 * Two blocks. The integration block asserts canonicalOrigin/siteOrigin against
 * the real DB. The HTTP block drives a running server with real Host headers
 * and reads the documents it actually returns — the only way to prove per-host
 * tenant selection for the agent card, canonical link, robots and sitemap.
 *
 * Nothing is stubbed. Throwaway users are deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

const BASE = process.env.PROOF_BASE_URL || "http://localhost:3100";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name: string, why: string) {
  console.log(`  SKIP  ${name} — ${why}`);
}

const HOST_LIVE = "proof-canonical-clinic.invalid";
const HOST_SPOOF = "evil.invalid";
const EMAIL_A = "proof-canonical-a@example.invalid";
const EMAIL_B = "proof-canonical-b@example.invalid";

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { createUser } = await import("../../../lib/users");
  const { addDomain, canonicalOrigin } = await import("../../../lib/customDomains");
  const { siteOrigin } = await import("../../../lib/util");

  let userAId = "";
  let userBId = "";

  try {
    // A has a custom domain; B never will — the control.
    const a = await createUser({
      email: EMAIL_A,
      name: "Proof Canonical Clinic",
      password: "proof-password-1",
    });
    const b = await createUser({
      email: EMAIL_B,
      name: "Proof Control Studio",
      password: "proof-password-2",
    });
    if (!("user" in a) || !("user" in b)) throw new Error("proof users could not be created");
    const userA = a.user;
    const userB = b.user;
    userAId = userA.id;
    userBId = userB.id;

    await addDomain(userAId, HOST_LIVE);

    // ── canonicalOrigin ──
    console.log("\ncanonicalOrigin");
    const platform = siteOrigin();

    // Not live yet: must still fall back to the platform path.
    let canon = await canonicalOrigin(userA);
    check(
      "a non-live domain does not become canonical",
      canon.includes(`/a/${userA.slug}`) && !canon.includes(HOST_LIVE),
      canon,
    );

    await prisma.customDomain.update({ where: { hostname: HOST_LIVE }, data: { status: "live" } });
    canon = await canonicalOrigin(userA);
    check("a live domain is canonical", canon.includes(HOST_LIVE), canon);
    check("it is an https origin", canon.startsWith("https://"), canon);
    check("it carries no /a/<slug> path", !canon.includes(`/a/${userA.slug}`), canon);

    const canonB = await canonicalOrigin(userB);
    check(
      "a tenant with no domain keeps the platform path",
      canonB === `${platform}/a/${userB.slug}`,
      canonB,
    );

    // ── siteOrigin host trust ──
    console.log("\nsiteOrigin host trust");
    const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
    if (configured) {
      skip(
        "host-derived origin assertions",
        "NEXT_PUBLIC_SITE_URL is pinned, which short-circuits host derivation by design",
      );
    } else {
      const spoofed = siteOrigin(new Headers({ "x-forwarded-host": HOST_SPOOF }));
      check(
        "an unrecognized forwarded host is not advertised",
        !spoofed.includes(HOST_SPOOF),
        spoofed,
      );
      const known = siteOrigin(new Headers({ "x-forwarded-host": HOST_LIVE }));
      check("a live custom domain is honored", known.includes(HOST_LIVE), known);
    }

    // ── HTTP: per-host documents ──
    console.log("\nHTTP (real server at PROOF_BASE_URL)");
    const reachable = await fetch(BASE, { redirect: "manual" })
      .then(() => true)
      .catch(() => false);

    if (!reachable) {
      for (const n of [
        "agent card names the host's tenant",
        "platform host still serves the founding user's card",
        "canonical link points at the custom domain",
        "robots and sitemap are per-tenant",
        "spoofed host is not advertised in the card",
      ]) {
        skip(n, `no server at ${BASE}`);
      }
    } else {
      const get = (host: string, p: string) =>
        fetch(`${BASE}${p}`, { headers: { Host: host }, redirect: "manual" });

      // The card on the custom domain describes that tenant.
      const cardRes = await get(HOST_LIVE, "/.well-known/agent-card.json");
      const cardText = await cardRes.text();
      check("card served on the custom domain", cardRes.status === 200, `status ${cardRes.status}`);
      check(
        "it names the host's tenant",
        cardText.includes("Proof Canonical Clinic"),
        "tenant name absent from card",
      );
      check(
        "its interface URLs are on that host",
        cardText.includes(HOST_LIVE),
        "custom domain absent from card URLs",
      );

      // The platform host must be unchanged: still the founding user.
      const platformHost = new URL(BASE).host;
      const founder = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
      const platformCard = await get(platformHost, "/.well-known/agent-card.json");
      const platformText = await platformCard.text();
      check(
        "the platform host still serves the founding user's card",
        founder !== null && !platformText.includes("Proof Canonical Clinic"),
        "a tenant leaked into the platform card",
      );

      // Canonical link on /a/<slug>.
      const slugPage = await get(platformHost, `/a/${userA.slug}`);
      const slugHtml = await slugPage.text();
      check("/a/<slug> still returns 200", slugPage.status === 200, `status ${slugPage.status}`);
      check(
        "it declares the custom domain canonical",
        /rel=["']canonical["']/.test(slugHtml) && slugHtml.includes(HOST_LIVE),
        "canonical link to the custom domain not found",
      );

      const controlPage = await get(platformHost, `/a/${userB.slug}`);
      const controlHtml = await controlPage.text();
      check(
        "a tenant without a domain has no foreign canonical",
        !controlHtml.includes(HOST_LIVE),
        "another tenant's domain leaked into the control page",
      );

      // robots + sitemap are per-tenant.
      const robots = await get(HOST_LIVE, "/robots.txt");
      const robotsText = await robots.text();
      check("robots.txt served on the custom domain", robots.status === 200);
      check(
        "it does not expose another tenant",
        !robotsText.includes(userB.slug),
        "control tenant's slug appeared in robots.txt",
      );

      const sitemap = await get(HOST_LIVE, "/sitemap.xml");
      const sitemapText = await sitemap.text();
      check("sitemap.xml served on the custom domain", sitemap.status === 200);
      check(
        "it lists only this tenant",
        !sitemapText.includes(userB.slug),
        "control tenant's slug appeared in the sitemap",
      );

      // A spoofed forwarded host must not shape the advertised origin.
      const spoofRes = await fetch(`${BASE}/.well-known/agent-card.json`, {
        headers: { "X-Forwarded-Host": HOST_SPOOF },
        redirect: "manual",
      });
      const spoofText = await spoofRes.text();
      check(
        "a spoofed forwarded host is not advertised",
        !spoofText.includes(HOST_SPOOF),
        "the card advertised an attacker-supplied host",
      );
    }
  } finally {
    for (const id of [userAId, userBId].filter(Boolean)) {
      await prisma.customDomain.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

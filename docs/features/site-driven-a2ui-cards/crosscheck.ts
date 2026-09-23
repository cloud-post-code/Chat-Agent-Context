/**
 * Live cross-check for site-driven-a2ui-cards (NOT the proof; spends tokens).
 * Run: npx tsx docs/features/site-driven-a2ui-cards/crosscheck.ts [source-user-slug]
 *
 * Copies a real tenant's imported site (link Sources, profile, photos, starter
 * questions, existing cards) onto a throwaway tenant, runs the agent with the
 * REAL planner and card builder, prints every event and the resulting
 * catalog, then deletes the throwaway tenant. The source tenant is only read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { buildCardsFromSite } = await import("../../../lib/siteCards");
  const { listUiCards } = await import("../../../lib/uiCards");

  const slug = process.argv[2];
  const candidates = await prisma.user.findMany({
    where: slug ? { slug } : { sources: { some: { type: "link" } } },
    select: { id: true, slug: true, _count: { select: { sources: true, uiCards: true } } },
  });
  const src = candidates.sort((a, b) => b._count.sources - a._count.sources)[0];
  if (!src) throw new Error("no tenant with an imported site");
  console.log(`source tenant: ${src.slug} (${src._count.sources} sources, ${src._count.uiCards} cards)`);

  const tmp = await prisma.user.create({
    data: {
      email: `crosscheck-site-cards-${Date.now()}@example.invalid`, name: "Crosscheck",
      slug: `crosscheck-site-cards-${Date.now()}`, passwordHash: "", onboardedAt: new Date(),
    },
  });
  try {
    const strip = <T extends { id: string; userId: string }>(r: T) => {
      const { id: _i, userId: _u, ...rest } = r;
      return { ...rest, userId: tmp.id };
    };
    const [profile, persona, sources, photos, canned, cards] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: src.id } }),
      prisma.personaConfig.findUnique({ where: { userId: src.id } }),
      prisma.source.findMany({ where: { userId: src.id } }),
      prisma.photo.findMany({ where: { userId: src.id } }),
      prisma.cannedAnswer.findMany({ where: { userId: src.id } }),
      prisma.uiCard.findMany({ where: { userId: src.id } }),
    ]);
    if (profile) await prisma.profile.create({ data: strip(profile) as never });
    if (persona) await prisma.personaConfig.create({ data: strip(persona) as never });
    await prisma.themeConfig.create({ data: { userId: tmp.id } });
    for (const s of sources) await prisma.source.create({ data: strip(s) as never });
    for (const p of photos) await prisma.photo.create({ data: strip(p) as never });
    for (const c of canned) await prisma.cannedAnswer.create({ data: strip(c) as never });
    for (const c of cards) await prisma.uiCard.create({ data: strip(c) as never });
    console.log("existing cards:", cards.map((c) => `${c.label} (${c.tool})`).join("; ") || "(none)");

    const t0 = Date.now();
    const report = await buildCardsFromSite(tmp.id, (e) => console.log(" ", JSON.stringify(e)));
    console.log(`\nreport after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(report, null, 1));
    for (const r of (await listUiCards(tmp.id)).slice(cards.length)) {
      console.log(`\nNEW ${r.order} ${r.label} [${r.tool}] — ${r.reason}\n${r.sampleBlock.slice(0, 700)}`);
    }
  } finally {
    await prisma.user.delete({ where: { id: tmp.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

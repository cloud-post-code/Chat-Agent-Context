/**
 * Backfill the retrieval index for existing knowledge sources, per user.
 *   npx tsx scripts/reindex.ts          -> index scanned sources with no chunks
 *   npx tsx scripts/reindex.ts --all    -> re-index every scanned source
 *   npx tsx scripts/reindex.ts --user <slug-or-id>  -> only that user
 *
 * Each source gets chunked + embedded + entity-extracted (one Claude call per
 * source), same as inline ingestion does for new sources.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

async function main() {
  const { prisma } = await import("../lib/db");
  const { indexSource } = await import("../lib/retrieval/indexer");
  const { indexEverything } = await import("../lib/retrieval/origins");
  const { buildClusterOverviews } = await import("../lib/retrieval/clusters");

  const all = process.argv.includes("--all");
  const userFlag = process.argv.indexOf("--user");
  const userFilter = userFlag >= 0 ? process.argv[userFlag + 1] : undefined;

  const users = await prisma.user.findMany({
    where: userFilter
      ? { OR: [{ id: userFilter }, { slug: userFilter }] }
      : undefined,
    select: { id: true, slug: true },
    orderBy: { createdAt: "asc" },
  });
  if (!users.length) {
    console.log(userFilter ? `No user matches "${userFilter}".` : "No users yet.");
    await prisma.$disconnect();
    return;
  }

  const pace = Number(process.env.EMBED_PACE_MS ?? 21_000);
  let failedAny = false;
  for (const user of users) {
    console.log(`── user ${user.slug} ──`);

    // --all also rebuilds the non-Source origins (profile, persona, projects,
    // photos, approved answers); the default pass only fills in unindexed
    // sources.
    if (all) {
      const n = await indexEverything(user.id, {
        onProgress: (label) => console.log(`  indexed  ${label}`),
      });
      console.log(`${n} non-source origin(s) indexed`);
    }
    const sources = await prisma.source.findMany({
      where: all
        ? { userId: user.id, status: "scanned" }
        : { userId: user.id, status: "scanned", chunks: { none: {} } },
      select: { id: true, title: true, url: true, filename: true },
      orderBy: { createdAt: "asc" },
    });

    console.log(`${sources.length} source(s) to index${all ? " (--all)" : ""}`);
    let ok = 0;
    for (const s of sources) {
      const label = s.title ?? s.url ?? s.filename ?? s.id;
      try {
        // Same per-minute-limit pacing as indexEverything.
        if (ok > 0 && pace > 0) await new Promise((r) => setTimeout(r, pace));
        await indexSource(user.id, s.id);
        ok++;
        console.log(`  indexed  ${label}`);
      } catch (e) {
        console.error(`  FAILED   ${label}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`Done: ${ok}/${sources.length} indexed`);
    if (ok < sources.length) failedAny = true;
    // --all finishes by rebuilding the neighborhood overviews: the graph the
    // clusters are computed from has just been rewritten. One Claude call per
    // cluster (max 6), same spend profile as the Graph tab's Rebuild button.
    if (all) {
      try {
        const n = await buildClusterOverviews(user.id);
        console.log(`${n} overview(s) rebuilt`);
      } catch (e) {
        console.error(`overview rebuild FAILED: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  await prisma.$disconnect();
  if (failedAny) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

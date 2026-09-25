/**
 * Backfill facet tags for photos uploaded before tagging existed (tags ==
 * "[]"). One describeAndTagImage vision call per photo, paced like
 * scripts/reindex.ts, then re-indexed so the retrieval graph picks up the
 * new tags too.
 *
 *   npx tsx scripts/tagPhotos.ts                    -> every untagged photo
 *   npx tsx scripts/tagPhotos.ts --user <slug-or-id> -> only that user's
 *   npx tsx scripts/tagPhotos.ts --dry-run           -> list, no writes, no calls
 *
 * Never run automatically — the owner runs this explicitly (see
 * docs/features/composable-a2ui-elements). New uploads and onboarding tag
 * automatically; this only catches photos that predate that.
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
  const { readUpload } = await import("../lib/uploads");
  const { describeAndTagImage } = await import("../lib/vision");
  const { indexPhoto } = await import("../lib/retrieval/origins");

  const dryRun = process.argv.includes("--dry-run");
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
    const photos = await prisma.photo.findMany({
      where: { userId: user.id, tags: "[]" },
      select: { id: true, filename: true },
      orderBy: { order: "asc" },
    });
    console.log(`── user ${user.slug} — ${photos.length} untagged photo(s) ──`);
    if (dryRun) {
      for (const p of photos) console.log(`  would tag  ${p.filename}`);
      continue;
    }

    let ok = 0;
    for (const p of photos) {
      try {
        if (ok > 0 && pace > 0) await new Promise((r) => setTimeout(r, pace));
        const upload = await readUpload(p.filename);
        if (!upload) {
          console.error(`  SKIP     ${p.filename}: not found on the upload store`);
          continue;
        }
        const ext = path.extname(p.filename);
        const { tags } = await describeAndTagImage(upload.bytes, ext);
        if (!tags.length) {
          console.log(`  no tags  ${p.filename} (model returned none)`);
          ok++;
          continue;
        }
        await prisma.photo.update({ where: { id: p.id }, data: { tags: JSON.stringify(tags) } });
        await indexPhoto(user.id, p.id);
        ok++;
        console.log(`  tagged   ${p.filename}: ${tags.join(", ")}`);
      } catch (e) {
        console.error(`  FAILED   ${p.filename}: ${e instanceof Error ? e.message : e}`);
      }
    }
    console.log(`Done: ${ok}/${photos.length} tagged`);
    if (ok < photos.length) failedAny = true;
  }

  await prisma.$disconnect();
  if (failedAny) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Primary proof for onboarding-graph-indexing (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-graph-indexing/proof.ts
 *
 * Seeds throwaway users and writes Sources exactly the way onboarding writes
 * them — through the real `saveKnowledgeRecord`, with deliberately curated
 * chunk boundaries — then runs the graph pass and asserts. Entity extraction
 * is stubbed so the proof never depends on live Claude output.
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = "obgproof";

// Two sources that share ONE entity, so cross-source convergence is provable.
// The testimonial source never contains the word "Larkmoor" — reaching it from
// a "Larkmoor" query is only possible through a graph edge.
const SALON = "Larkmoor Nail Studio";
const HOURS = "Mon-Sat 9:30am-7:00pm";
const OWNER = "Perrin Vale";

const SERVICE_FACTS = [
  `${SALON} offers a gel manicure that includes a soak-off and cuticle work.`,
  `${SALON} offers a spa pedicure with a paraffin treatment.`,
  `${SALON} is open Monday to Saturday from 9:30am to 7:00pm.`,
];
const TESTIMONIAL_PIECES = [
  `Customer testimonial from ${OWNER} (regular client): "The paraffin pedicure here is the best I have had."`,
  `Customer testimonial from Wrenna Osgood: "Spotless studio and the gel lasted three full weeks."`,
];

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { saveKnowledgeRecord } = await import("../../../lib/onboarding/knowledge");
  const { indexOnboardingGraph, finishOnboardingIndex } =
    await import("../../../lib/onboarding/graphIndex");
  const { retrieve } = await import("../../../lib/retrieval/search");

  // Stub extraction: both sources name the salon, so the entity must converge.
  // The edge salon -> owner is what makes the testimonial reachable from a
  // "Larkmoor" query without the word appearing in its text.
  const stub = {
    extract: async (text: string) => {
      if (text.includes("__THROW__")) throw new Error("simulated extraction failure");
      return {
        entities: [
          { name: SALON, type: "org" },
          { name: OWNER, type: "person" },
        ],
        edges: [{ from: SALON, to: OWNER, relation: "reviewed by" }],
      };
    },
  };

  const mkUser = async (n: string) =>
    prisma.user.create({
      data: {
        email: `${TAG}-${n}@example.test`,
        name: `${TAG} ${n}`,
        slug: `${TAG}-${n}`,
        passwordHash: "x",
      },
      select: { id: true },
    });

  const userA = await mkUser("a");
  const userB = await mkUser("b");

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  };

  try {
    // ── Seed the way onboarding does: curated chunk boundaries ──
    await saveKnowledgeRecord(
      userA.id,
      {
        url: `https://${TAG}.test/services`,
        title: "Services",
        kind: "other",
        rawText: SERVICE_FACTS.join("\n\n"),
      },
      SERVICE_FACTS,
    );
    await saveKnowledgeRecord(
      userA.id,
      {
        url: `https://${TAG}.test/reviews`,
        title: "Customer testimonials",
        kind: "other",
        rawText: TESTIMONIAL_PIECES.join("\n\n"),
      },
      TESTIMONIAL_PIECES,
    );
    // Tenant B: same shape, must stay untouched by A's run.
    await saveKnowledgeRecord(
      userB.id,
      { url: `https://${TAG}.test/b`, title: "Other tenant", kind: "other", rawText: SERVICE_FACTS[0] },
      [SERVICE_FACTS[0]],
    );

    // 1. Baseline is the reported bug.
    const baseEntities = await prisma.entity.count({ where: { userId: userA.id } });
    const baseChunks = await prisma.chunk.findMany({
      where: { userId: userA.id },
      select: { id: true, text: true, embedding: true },
      orderBy: { id: "asc" },
    });
    check(
      "1 baseline is the bug — chunks written, graph empty",
      baseChunks.length === SERVICE_FACTS.length + TESTIMONIAL_PIECES.length && baseEntities === 0,
      `chunks=${baseChunks.length} entities=${baseEntities}`,
    );

    // ── Run the graph pass ──
    const report = await indexOnboardingGraph(userA.id, { extract: stub.extract, paceMs: 0 });

    // 2. Graph populated.
    const entities = await prisma.entity.findMany({ where: { userId: userA.id } });
    const edges = await prisma.entityEdge.findMany({ where: { from: { userId: userA.id } } });
    check("2 graph populated", entities.length > 0 && edges.length > 0,
      `entities=${entities.length} edges=${edges.length}`);

    // 3. Curated chunking preserved — ids, texts and count all identical.
    const afterChunks = await prisma.chunk.findMany({
      where: { userId: userA.id },
      select: { id: true, text: true, embedding: true },
      orderBy: { id: "asc" },
    });
    const sameIds = afterChunks.map((c) => c.id).join() === baseChunks.map((c) => c.id).join();
    const sameTexts = afterChunks.map((c) => c.text).join("|") === baseChunks.map((c) => c.text).join("|");
    check("3 curated chunking preserved (ids + texts unchanged)", sameIds && sameTexts,
      `before=${baseChunks.length} after=${afterChunks.length} sameIds=${sameIds} sameTexts=${sameTexts}`);
    // The specific regression: one testimonial per chunk, still intact.
    check("3b one testimonial still one chunk",
      afterChunks.filter((c) => c.text.startsWith("Customer testimonial")).length === 2);

    // 4. Embeddings preserved byte-for-byte.
    const embedEq = baseChunks.every((b) => {
      const a = afterChunks.find((x) => x.id === b.id);
      if (!a) return false;
      if (b.embedding === null) return a.embedding === null;
      return a.embedding !== null && Buffer.compare(Buffer.from(a.embedding), Buffer.from(b.embedding)) === 0;
    });
    check("4 embeddings preserved", embedEq);

    // 5. Mentions attach to this user's real chunks.
    const mentions = await prisma.entityMention.findMany({
      where: { entity: { userId: userA.id } },
      select: { chunkId: true, entity: { select: { name: true } } },
    });
    const chunkIds = new Set(afterChunks.map((c) => c.id));
    const salonChunk = afterChunks.find((c) => c.text.includes(SALON));
    check("5 mentions attach to real chunks",
      mentions.length > 0 && mentions.every((m) => chunkIds.has(m.chunkId)) &&
      mentions.some((m) => m.entity.name === SALON && m.chunkId === salonChunk?.id));

    // 6. Cross-source convergence — one row, mentions spanning both sources.
    const salonRows = entities.filter((e) => e.name === SALON);
    const salonMentions = await prisma.entityMention.findMany({
      where: { entity: { userId: userA.id, name: SALON } },
      select: { chunk: { select: { sourceId: true } } },
    });
    const spanned = new Set(salonMentions.map((m) => m.chunk.sourceId)).size;
    check("6 cross-source convergence — one entity row", salonRows.length === 1,
      `rows=${salonRows.length} sourcesSpanned=${spanned}`);

    // 7. Best-effort: a failing source keeps its chunks and doesn't abort.
    await saveKnowledgeRecord(
      userA.id,
      { url: `https://${TAG}.test/bad`, title: "Bad", kind: "other", rawText: "__THROW__ page" },
      ["__THROW__ page content that still deserves to survive"],
    );
    const failReport = await indexOnboardingGraph(userA.id, { extract: stub.extract, paceMs: 0 });
    const badChunks = await prisma.chunk.count({
      where: { userId: userA.id, text: { contains: "__THROW__" } },
    });
    check("7 best-effort — failed source keeps chunks, run continues",
      badChunks === 1 && failReport.failed === 1 && failReport.indexed >= 2,
      `badChunks=${badChunks} failed=${failReport.failed} indexed=${failReport.indexed}`);

    // 8. Idempotent.
    const beforeCounts = {
      e: await prisma.entity.count({ where: { userId: userA.id } }),
      m: await prisma.entityMention.count({ where: { entity: { userId: userA.id } } }),
      g: await prisma.entityEdge.count({ where: { from: { userId: userA.id } } }),
    };
    await indexOnboardingGraph(userA.id, { extract: stub.extract, paceMs: 0 });
    const afterCounts = {
      e: await prisma.entity.count({ where: { userId: userA.id } }),
      m: await prisma.entityMention.count({ where: { entity: { userId: userA.id } } }),
      g: await prisma.entityEdge.count({ where: { from: { userId: userA.id } } }),
    };
    check("8 idempotent",
      beforeCounts.e === afterCounts.e && beforeCounts.m === afterCounts.m && beforeCounts.g === afterCounts.g,
      `${JSON.stringify(beforeCounts)} vs ${JSON.stringify(afterCounts)}`);

    // 9. Tenant isolation.
    const bEntities = await prisma.entity.count({ where: { userId: userB.id } });
    const crossEdges = await prisma.entityEdge.count({
      where: { from: { userId: userA.id }, to: { userId: userB.id } },
    });
    check("9 tenant isolation", bEntities === 0 && crossEdges === 0,
      `bEntities=${bEntities} crossEdges=${crossEdges}`);

    // 10. Retrieval improves: "Larkmoor" reaches the testimonial chunk, whose
    // text never contains that word — only a graph hop gets there.
    const testimonialText = TESTIMONIAL_PIECES[1];
    check("10 precondition — testimonial has no lexical match",
      !testimonialText.includes("Larkmoor"));
    const res = await retrieve(userA.id, `What do people say about ${SALON}?`);
    const reached = res.chunks.some((c) => c.text === testimonialText);
    check("10 retrieval reaches a graph-only chunk", reached,
      `got: ${res.chunks.map((c) => c.text.slice(0, 40)).join(" | ")}`);

    // 12. Pacing default matches the shared per-minute-limit spacing. The
    // production call site (lib/onboarding/jobs.ts) passes no paceMs, so a
    // default of 0 would fire unpaced model calls in real onboarding while
    // every stubbed assertion above still passed.
    const { DEFAULT_PACE_MS } = await import("../../../lib/onboarding/graphIndex");
    check("12 pacing default matches indexEverything/reindex", DEFAULT_PACE_MS === 21_000,
      `got ${DEFAULT_PACE_MS}, expected 21000 (see lib/retrieval/origins.ts)`);

    // 13. Only scanned sources are indexed. A pending/failed source asserts
    // nothing yet; indexing it would attach entities to provisional text.
    const pendingSrc = await prisma.source.create({
      data: {
        userId: userA.id, type: "link", url: `https://${TAG}.test/pending`,
        title: "Pending", rawText: `${SALON} pending page`, status: "pending",
      },
      select: { id: true },
    });
    await prisma.chunk.create({
      data: {
        userId: userA.id, originKind: "source", originId: pendingSrc.id,
        originLabel: "Pending", sourceId: pendingSrc.id, seq: 0,
        text: `${SALON} pending page`,
      },
    });
    await indexOnboardingGraph(userA.id, { extract: stub.extract, paceMs: 0 });
    const pendingMentions = await prisma.entityMention.count({
      where: { chunk: { sourceId: pendingSrc.id } },
    });
    check("13 pending sources are not indexed", pendingMentions === 0,
      `mentions on pending source=${pendingMentions}`);

    // 14. Onboarding's OTHER surfaces are indexed, not just Sources. The
    // review steps write Profile/hours/brand rows via the save route, which
    // calls no indexer — so without this a visitor asking "what are your
    // opening hours?" retrieves nothing, even though the data is saved.
    await prisma.profile.upsert({
      where: { userId: userA.id },
      update: { company_name: SALON, company_hours: HOURS },
      create: { userId: userA.id, company_name: SALON, company_hours: HOURS },
    });
    const beforeProfile = await prisma.chunk.count({
      where: { userId: userA.id, originKind: "profile" },
    });
    check("14a precondition — profile saved but unindexed", beforeProfile === 0);

    await finishOnboardingIndex(userA.id, { extract: stub.extract, paceMs: 0 });

    const profileChunks = await prisma.chunk.count({
      where: { userId: userA.id, originKind: "profile" },
    });
    check("14b profile indexed on completion", profileChunks > 0,
      `profile chunks=${profileChunks}`);
    const hoursHit = await retrieve(userA.id, "What are your opening hours?");
    check("14c opening hours are retrievable",
      hoursHit.chunks.some((c) => c.text.includes("9:30")),
      `got: ${hoursHit.chunks.map((c) => c.text.slice(0, 40)).join(" | ")}`);

    // 11. Cleanup.
    await cleanup();
    const left = await prisma.user.count({ where: { id: { in: [userA.id, userB.id] } } });
    const leftChunks = await prisma.chunk.count({ where: { userId: { in: [userA.id, userB.id] } } });
    const leftEntities = await prisma.entity.count({ where: { userId: { in: [userA.id, userB.id] } } });
    check("11 cleanup", left === 0 && leftChunks === 0 && leftEntities === 0,
      `users=${left} chunks=${leftChunks} entities=${leftEntities}`);
  } finally {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  if (failures) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

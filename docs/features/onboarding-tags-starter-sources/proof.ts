/**
 * Primary proof for onboarding-tags-starter-sources (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-tags-starter-sources/proof.ts
 *
 * The claim is that a finished onboarding fills the four starter Content
 * tabs. So the proof drives the REAL persistence boundary every extractor
 * writes through (`saveKnowledgeRecord`) with the REAL mapping, then reads
 * back through the REAL dashboard query (`listIngestedItems`) — the same
 * function the Content panels call. The services extractor is LLM-injectable,
 * so it runs end-to-end for real. The four call sites that cannot be run
 * offline (they need a live crawler) are asserted statically against source.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

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

const TAG = "otssproof";

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { saveKnowledgeRecord } = await import("../../../lib/onboarding/knowledge");
  const { extractServicesAndBooking } = await import("../../../lib/onboarding/services");
  const { listIngestedItems } = await import("../../../lib/ingestedItems");
  const { ONBOARDING_SOURCE_KEYS, onboardingIngestKind, STARTER_INGESTION_SOURCES } =
    await import("../../../lib/ingestionSources");

  // ── 1. Every extractor maps to a tab that actually exists ──
  const starterKeys = new Set(STARTER_INGESTION_SOURCES.map((s) => s.key));
  const mapped = Object.entries(ONBOARDING_SOURCE_KEYS);
  check(
    "every onboarding extractor maps to a real starter tab",
    mapped.every(([, key]) => starterKeys.has(key)),
    JSON.stringify(ONBOARDING_SOURCE_KEYS),
  );
  check(
    "the mapping covers all five extractors",
    ["blog", "testimonials", "team", "services", "sweep"].every(
      (e) => e in ONBOARDING_SOURCE_KEYS,
    ),
  );
  check(
    "onboardingIngestKind produces the ingest:<key> mark the panels query",
    onboardingIngestKind("team") === "ingest:about-team" &&
      onboardingIngestKind("sweep") === "ingest:services",
    `${onboardingIngestKind("team")} / ${onboardingIngestKind("sweep")}`,
  );

  // ── 2. Every write site uses the mapping, not a bare literal ──
  const knowledgeSrc = readFileSync(path.join(root, "lib/onboarding/knowledge.ts"), "utf8");
  const servicesSrc = readFileSync(path.join(root, "lib/onboarding/services.ts"), "utf8");
  for (const e of ["blog", "testimonials", "team", "sweep"]) {
    check(
      `knowledge.ts tags its ${e} write via onboardingIngestKind`,
      knowledgeSrc.includes(`onboardingIngestKind("${e}")`),
    );
  }
  check(
    "services.ts tags its write via onboardingIngestKind",
    servicesSrc.includes('onboardingIngestKind("services")'),
  );
  const untagged = [...knowledgeSrc.matchAll(/kind: "(?!ingest:)([a-z-]+)"/g)].map((m) => m[1]);
  check(
    "no onboarding write site still uses an untagged kind literal",
    untagged.length === 0,
    untagged.join(", "),
  );

  const user = await prisma.user.create({
    data: {
      email: `${TAG}@example.test`,
      name: `${TAG}`,
      slug: `${TAG}`,
      passwordHash: "x",
    },
    select: { id: true },
  });
  const cleanup = () => prisma.user.deleteMany({ where: { id: user.id } });

  try {
    // ── 3. The real services extractor lands in the Services tab ──
    const html = "<html><body><h1>Services</h1><p>Gel manicure. Spa pedicure.</p></body></html>";
    const page = {
      url: `https://${TAG}.test/services`,
      html,
      $: cheerio.load(html),
    } as Parameters<typeof extractServicesAndBooking>[0][number];
    await extractServicesAndBooking([page], user.id, () => {}, {
      llm: async () => ({
        services: [
          { name: "Gel manicure", description: "Soak-off and cuticle work." },
          { name: "Spa pedicure", description: "Includes a paraffin treatment." },
        ],
        booking: { takesAppointments: true, requirements: [] },
      }),
    });
    const servicesItems = await listIngestedItems(user.id, "services");
    check(
      "services extractor's rows appear in the Services tab",
      servicesItems.length > 0 &&
        servicesItems.some((i) => i.text.includes("Gel manicure")),
      `${servicesItems.length} items`,
    );

    // ── 4. Each remaining extractor's write lands in ITS tab, via the real
    //       saveKnowledgeRecord + the real dashboard query ──
    const writes: Array<[Parameters<typeof onboardingIngestKind>[0], string, string, string]> = [
      ["blog", "blog", `https://${TAG}.test/post-1`, "A post about winter nail care."],
      ["testimonials", "testimonials", `https://${TAG}.test/reviews`, "Customer testimonial from Wrenna Osgood."],
      ["team", "about-team", `https://${TAG}.test/team#team`, "Perrin Vale — studio owner since 2015."],
      ["sweep", "services", `https://${TAG}.test/hours`, "Open Monday to Saturday 9:30am to 7:00pm."],
    ];
    for (const [extractor, tab, url, body] of writes) {
      await saveKnowledgeRecord(
        user.id,
        { url, title: `${extractor} record`, kind: onboardingIngestKind(extractor), rawText: body },
        [body],
      );
      const items = await listIngestedItems(user.id, tab);
      check(
        `${extractor} output shows in the "${tab}" tab`,
        items.some((i) => i.text.includes(body)),
        `${items.length} items in ${tab}`,
      );
    }

    // ── 5. The sweep and the services extractor share the Services tab ──
    const servicesTab = await listIngestedItems(user.id, "services");
    check(
      "Services tab holds both the catalog and the swept facts",
      servicesTab.some((i) => i.text.includes("Gel manicure")) &&
        servicesTab.some((i) => i.text.includes("Monday to Saturday")),
      `${servicesTab.length} items`,
    );

    // ── 6. Tagged rows leave the built-in Links tab (the intended move) ──
    const links = await listIngestedItems(user.id, "links");
    check(
      "onboarding rows no longer land in the built-in Links tab",
      links.length === 0,
      `${links.length} stray rows`,
    );

    // ── 7. A re-onboard re-tags in place: a row written with a stale kind and
    //       upserted again by the same url moves into its tab, not beside it ──
    const staleUrl = `https://${TAG}.test/stale`;
    await prisma.source.create({
      data: {
        userId: user.id, type: "link", url: staleUrl,
        title: "Pre-tagging post", kind: "article",
        rawText: "Older run.", summary: "", status: "scanned",
      },
    });
    const beforeBlog = (await listIngestedItems(user.id, "blog")).length;
    await saveKnowledgeRecord(
      user.id,
      { url: staleUrl, title: "Pre-tagging post", kind: onboardingIngestKind("blog"), rawText: "Older run." },
      ["Older run, re-extracted."],
    );
    const afterBlog = await listIngestedItems(user.id, "blog");
    const staleRows = await prisma.source.count({ where: { userId: user.id, url: staleUrl } });
    check(
      "a re-onboard re-tags the existing row in place",
      afterBlog.length === beforeBlog + 1 && staleRows === 1,
      `blog ${beforeBlog} -> ${afterBlog.length}, ${staleRows} rows at that url`,
    );
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nPROOF PASS" : `\nPROOF FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

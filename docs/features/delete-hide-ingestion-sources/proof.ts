/**
 * Primary proof for delete-hide-ingestion-sources (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/delete-hide-ingestion-sources/proof.ts
 *
 * Local dev Postgres; zero model calls (injected extractor, splitMode
 * "single", empty embed keys). `proof-dhis-` markers, finally cleanup.
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
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";
// Entity extraction is a model call; without it dropOrigin still runs.
process.env.ANTHROPIC_API_KEY = "";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KEY = "proof-dhis-src";

async function main() {
  const { saveIngestionSource, setIngestionSourceHidden } =
    await import("@/lib/ingestionSources");
  const { ingestCustomText } = await import("@/lib/customIngest");
  const { ingestMark, deleteIngestionSourceAndData } = await import("@/lib/ingestedItems");
  const { contentTabsFromSources } = await import("@/app/admin/contentTabs");
  const { prisma } = await import("@/lib/db");

  const fakeExtract = async (text: string, title: string | null) => ({
    title, rawText: text, summary: `SUM:${title}`, tags: [] as string[],
  });

  const err = await saveIngestionSource({
    key: KEY, label: "Proof DHIS", description: "", systemPrompt: "",
    uploadMethod: "textarea", storageKinds: "text", splitMode: "single",
    outputMethod: "proof",
  });
  check("marker source saves", err === null, String(err));

  try {
    const row = await prisma.ingestionSource.findUnique({ where: { key: KEY } });
    check("marker source exists", !!row);
    if (!row) throw new Error("no marker row");

    // Ingest two texts through the custom path.
    for (const t of ["alpha", "beta"]) {
      const e = await ingestCustomText(KEY, { title: `proof-dhis-${t}`, text: `Body ${t}.` }, fakeExtract);
      check(`ingest ${t} accepted`, e === null, String(e));
    }
    const marked = await prisma.source.findMany({ where: { kind: ingestMark(KEY) } });
    check("two marked Source rows", marked.length === 2, String(marked.length));
    const ids = marked.map((s) => s.id);
    const chunksBefore = await prisma.chunk.count({
      where: { originKind: "source", originId: { in: ids } },
    });
    check("chunks written for marked rows", chunksBefore > 0, String(chunksBefore));

    // ── Hide ──
    await setIngestionSourceHidden(row.id, true);
    const hidden = await prisma.ingestionSource.findUnique({ where: { id: row.id } });
    check("hide sets enabled=false", hidden?.enabled === false);
    const tabsHidden = contentTabsFromSources(
      [{ key: KEY, label: "Proof DHIS", enabled: hidden!.enabled }],
      { [KEY]: "panel" },
    );
    check("hidden source dropped from tab strip", tabsHidden.length === 0);
    const survivedRows = await prisma.source.count({ where: { kind: ingestMark(KEY) } });
    check("hiding keeps ingested rows", survivedRows === 2, String(survivedRows));

    // ── Show ──
    await setIngestionSourceHidden(row.id, false);
    const shown = await prisma.ingestionSource.findUnique({ where: { id: row.id } });
    check("show sets enabled=true", shown?.enabled === true);
    const tabsShown = contentTabsFromSources(
      [{ key: KEY, label: "Proof DHIS", enabled: shown!.enabled }],
      { [KEY]: "panel" },
    );
    check("shown source back in tab strip", tabsShown.length === 1);

    // ── Delete: row + every marked row + their chunks ──
    await deleteIngestionSourceAndData(row.id);
    check(
      "source row deleted",
      (await prisma.ingestionSource.findUnique({ where: { id: row.id } })) === null,
    );
    const markedAfter = await prisma.source.count({ where: { kind: ingestMark(KEY) } });
    check("marked Source rows deleted", markedAfter === 0, String(markedAfter));
    const chunksAfter = await prisma.chunk.count({
      where: { originKind: "source", originId: { in: ids } },
    });
    check("their chunks deleted", chunksAfter === 0, String(chunksAfter));

    // Deleting an already-deleted id is a no-op, not a crash.
    await deleteIngestionSourceAndData(row.id);
    check("second delete is a no-op", true);
  } finally {
    await prisma.source.deleteMany({ where: { kind: ingestMark(KEY) } });
    await prisma.ingestionSource.deleteMany({ where: { key: KEY } });
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} failing`);
    process.exit(1);
  }
  console.log("\nAll green");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

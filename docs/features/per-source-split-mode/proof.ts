/**
 * Primary proof for per-source-split-mode (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/per-source-split-mode/tsconfig.json \
 *        docs/features/per-source-split-mode/proof.ts
 *
 * Local dev Postgres; zero model calls. `proof-psm-` markers, finally cleanup.
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KEY = "proof-psm-src";

const items3 = JSON.stringify([
  { title: "One", text: "1" },
  { title: "Two", text: "2" },
  { title: "Three", text: "3" },
]);

function countingSplitClient() {
  const state = { calls: 0 };
  const client = {
    messages: {
      create: async () => {
        state.calls++;
        return { content: [{ type: "text", text: items3 }] };
      },
    },
  };
  return { client, state };
}

async function main() {
  const { SPLIT_MODES, saveIngestionSource } = await import("@/lib/ingestionSources");
  const { ingestCustomFile } = await import("@/lib/customIngest");
  const { prisma } = await import("@/lib/db");

  const fakeDoc = async (_b: Buffer, filename: string) => ({
    title: filename, rawText: "many points of text", summary: `DOC:${filename}`, tags: [],
  });

  // 1. Vocabulary + default.
  check("SPLIT_MODES is split|single",
    JSON.stringify([...SPLIT_MODES]) === JSON.stringify(["split", "single"]));
  const bad = await saveIngestionSource({
    key: KEY, label: "Proof PSM", description: "", systemPrompt: "",
    uploadMethod: "file", storageKinds: "text", outputMethod: "x", splitMode: "shred",
  });
  check("unknown splitMode rejected", typeof bad === "string");
  const ok = await saveIngestionSource({
    key: KEY, label: "Proof PSM", description: "", systemPrompt: "",
    uploadMethod: "file", storageKinds: "text", outputMethod: "x",
  });
  check("omitted splitMode saves", ok === null, String(ok));
  try {
    const row = await prisma.ingestionSource.findUnique({ where: { key: KEY } });
    check("omitted splitMode defaults to split", row?.splitMode === "split");

    // 3 (order: default first). A split source splits.
    {
      const { client, state } = countingSplitClient();
      await ingestCustomFile(KEY, Buffer.from("x"), "proof-psm-a.pdf", fakeDoc, client);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("split-mode source splits into 3 rows", rows.length === 3 && state.calls === 1,
        `rows=${rows.length} calls=${state.calls}`);
      await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } });
    }

    // 2 & 4. Flip to single via the same lib the edit page uses.
    const flip = await saveIngestionSource({
      id: row!.id, key: KEY, label: "Proof PSM", description: "", systemPrompt: "",
      uploadMethod: "file", storageKinds: "text", outputMethod: "x",
      splitMode: "single", order: row!.order,
    });
    check("flip to single saves", flip === null, String(flip));
    {
      const { client, state } = countingSplitClient();
      await ingestCustomFile(KEY, Buffer.from("x"), "proof-psm-b.pdf", fakeDoc, client);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("single-mode source keeps one row and never calls the splitter",
        rows.length === 1 && rows[0].summary === "DOC:proof-psm-b.pdf" && state.calls === 0,
        `rows=${rows.length} calls=${state.calls}`);
    }
  } finally {
    await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } }).catch(() => {});
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-psm" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 5. Builder draft carries the mode.
  const { draftIngestionSource } = await import("@/lib/ingestionBuilder");
  const fakeClient = (text: string) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
  const single = await draftIngestionSource([{ role: "user", content: "x" }], null, {
    client: fakeClient(JSON.stringify({ reply: "ok", draft: { label: "Docs", splitMode: "single" } })),
  });
  check("draft keeps a valid splitMode", !("error" in single) && single.draft?.splitMode === "single");
  const junk = await draftIngestionSource([{ role: "user", content: "x" }], null, {
    client: fakeClient(JSON.stringify({ reply: "ok", draft: { label: "Docs", splitMode: "confetti" } })),
  });
  check("junk splitMode coerces to split", !("error" in junk) && junk.draft?.splitMode === "split");
  const builder = readFileSync(path.join(root, "lib/ingestionBuilder.ts"), "utf8");
  check("builder prompt teaches single mode", builder.includes('"single"'));

  // 6. UI wiring.
  const editPage = readFileSync(path.join(root, "app/admin/sources/[key]/page.tsx"), "utf8");
  const newPage = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
  check("edit + create forms post splitMode",
    editPage.includes('name="splitMode"') && newPage.includes('name="splitMode"'));
  const actions = readFileSync(path.join(root, "app/admin/actions.ts"), "utf8");
  check("create/update actions forward splitMode",
    /createIngestionSourceAction[\s\S]{0,900}splitMode/.test(actions) &&
      /updateIngestionSourceAction[\s\S]{0,900}splitMode/.test(actions));
  const sb = readFileSync(path.join(root, "app/admin/SourceBuilder.tsx"), "utf8");
  check("builder test pane shows the draft's mode", sb.includes("one item per upload"));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

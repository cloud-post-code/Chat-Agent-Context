/**
 * Primary proof for delete-ingested-items (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/delete-ingested-items/proof.ts
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const KEY = "proof-dii-src";
const OTHER = "proof-dii-other";

async function main() {
  const { deleteIngestedItem, ingestCustomText } = await import("@/lib/customIngest");
  const { saveIngestionSource } = await import("@/lib/ingestionSources");
  const { listIngestedItems } = await import("@/lib/ingestedItems");
  const { prisma } = await import("@/lib/db");

  const fakeExtract = async (text: string, title?: string | null) => ({
    title: title ?? "note", rawText: text, summary: `S:${text}`, tags: [],
  });
  const noSplit = { messages: { create: async () => ({ content: [{ type: "text", text: "[]" }] }) } };

  try {
    for (const k of [KEY, OTHER]) {
      await saveIngestionSource({
        key: k, label: `Proof DII ${k}`, description: "", systemPrompt: "",
        uploadMethod: "generic", storageKinds: "text+image", outputMethod: "x",
      });
    }
    await ingestCustomText(KEY, { title: "proof-dii note", text: "hello" }, fakeExtract, noSplit);
    const srcRow = await prisma.source.findFirst({ where: { kind: `ingest:${KEY}` } });
    const photo = await prisma.photo.create({
      data: { filename: "00000000-0000-0000-0000-00000000d1a0.png", caption: "proof-dii pic", kind: `ingest:${KEY}` },
    });
    const builtinRow = await prisma.source.create({
      data: { type: "text", title: "proof-dii-builtin", rawText: "b", status: "scanned" },
    });

    // 3. Ownership refusals first (rows must survive them).
    check("cross-source delete refused",
      typeof (await deleteIngestedItem(OTHER, `source:${srcRow!.id}`)) === "string");
    check("builtin row delete refused",
      typeof (await deleteIngestedItem(KEY, `source:${builtinRow.id}`)) === "string");
    check("unknown id shape refused",
      typeof (await deleteIngestedItem(KEY, `experience:0`)) === "string");
    check("rows survived the refusals",
      (await prisma.source.count({ where: { id: { in: [srcRow!.id, builtinRow.id] } } })) === 2);

    // 1. Text item delete removes row + chunks.
    const chunksBefore = await prisma.chunk.count({ where: { sourceId: srcRow!.id } });
    check("item had chunks to retract", chunksBefore > 0, String(chunksBefore));
    const e1 = await deleteIngestedItem(KEY, `source:${srcRow!.id}`);
    check("text item delete succeeds", e1 === null, String(e1));
    check("source row gone", (await prisma.source.count({ where: { id: srcRow!.id } })) === 0);
    check("its chunks gone", (await prisma.chunk.count({ where: { sourceId: srcRow!.id } })) === 0);

    // 2. Image item delete removes the photo row.
    const e2 = await deleteIngestedItem(KEY, `photo:${photo.id}`);
    check("image item delete succeeds", e2 === null, String(e2));
    check("photo row gone", (await prisma.photo.count({ where: { id: photo.id } })) === 0);

    check("list is empty after deletes",
      (await listIngestedItems(KEY)).length === 0);

    // 4. Panel renders a Delete button per item.
    const { GenericIngestPanel } = await import("../../../app/admin/GenericIngestPanel");
    const row = {
      id: "x", key: KEY, label: "Proof DII", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text+image", outputMethod: "",
      builtin: false, enabled: true, order: 0, classification: "public",
      splitMode: "split", panelHtml: "", createdAt: new Date(0), updatedAt: new Date(0),
    };
    const items = [
      { kind: "text" as const, id: "source:a", sourceKey: KEY, title: "T1", text: "x", imageUrl: null, createdAt: new Date(0) },
      { kind: "image" as const, id: "photo:b", sourceKey: KEY, title: "P1", text: "", imageUrl: "/api/uploads/x.png", createdAt: new Date(0) },
    ];
    const html = renderToStaticMarkup(h(GenericIngestPanel, { row, items }));
    check("one Delete button per item", (html.match(/>Delete</g) ?? []).length === 2, html.slice(0, 200));
    check("delete form posts itemId + sourceKey",
      html.includes('name="itemId"') && html.includes('value="source:a"') && html.includes('value="photo:b"'));
  } finally {
    await prisma.source.deleteMany({ where: { OR: [{ kind: { startsWith: "ingest:proof-dii" } }, { title: { startsWith: "proof-dii" } }] } }).catch(() => {});
    await prisma.photo.deleteMany({ where: { kind: { startsWith: "ingest:proof-dii" } } }).catch(() => {});
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-dii" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 5. Wiring.
  const dash = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
  check("dashboard passes deleteItemAction", dash.includes("deleteItemAction="));
  const actions = readFileSync(path.join(root, "app/admin/actions/ingestion.ts"), "utf8");
  check("action wraps deleteIngestedItem behind admin auth",
    /deleteIngestedItemAction[\s\S]{0,300}requireAuth[\s\S]{0,300}deleteIngestedItem\(/.test(actions));
  const lib = readFileSync(path.join(root, "lib/customIngest.ts"), "utf8");
  check("lib retracts via dropOrigin on item delete",
    /deleteIngestedItem[\s\S]{0,1200}dropOrigin/.test(lib));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

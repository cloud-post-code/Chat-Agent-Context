/**
 * Primary proof for create-ingestion-source (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/create-ingestion-source/proof.ts
 *
 * Local dev Postgres; zero model calls (fakes injected, embedding keys unset
 * so the local hashed embedder runs). Everything seeded is `proof-cis-`
 * marked and removed in the finally, including the upload file.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
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
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KEY = "proof-cis-src";
const TEXTONLY = "proof-cis-textonly";
let uploadFile: string | null = null;

async function main() {
  const { ingestCustomText, ingestCustomImage } = await import("@/lib/customIngest");
  const { listIngestedItems } = await import("@/lib/ingestedItems");
  const { saveIngestionSource } = await import("@/lib/ingestionSources");
  const { galleryBlock } = await import("@/lib/cards");
  const { prisma } = await import("@/lib/db");
  const { GenericIngestPanel } = await import("../../../app/admin/GenericIngestPanel");

  const fakeExtract = async (text: string, title?: string | null) => ({
    title: title ?? "note",
    rawText: text,
    summary: `SUMMARY:${text}`,
    tags: ["proof"],
  });
  const fakeDescribe = async () => "proof-cis image description";
  // Split pass declines (split-ingest-items) → plain single-row behavior,
  // which is exactly what this proof asserts.
  const noSplit = { messages: { create: async () => ({ content: [{ type: "text", text: "[]" }] }) } };

  try {
    await saveIngestionSource({
      key: KEY, label: "Proof CIS", description: "d", systemPrompt: "sp",
      uploadMethod: "generic", storageKinds: "text+image", outputMethod: "unified items",
    });
    await saveIngestionSource({
      key: TEXTONLY, label: "Proof CIS text-only", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "unified items",
    });

    // 1. The uniform rule is enforced at the write.
    const e1 = await ingestCustomText(TEXTONLY, { title: "t", text: "ok" }, fakeExtract, noSplit);
    check("text into text-only source allowed", e1 === null, String(e1));
    const e2 = await ingestCustomImage(
      TEXTONLY, Buffer.from([1]), "image/png", "cap", fakeDescribe,
    );
    check("image into text-only source refused", typeof e2 === "string");
    // (image-only refusal of text)
    await saveIngestionSource({
      key: "proof-cis-imgonly", label: "Proof CIS img", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "image", outputMethod: "unified items",
    });
    const e3 = await ingestCustomText("proof-cis-imgonly", { title: "t", text: "no" }, fakeExtract, noSplit);
    check("text into image-only source refused", typeof e3 === "string");

    // 2. Text write lands marked and listed.
    const e4 = await ingestCustomText(KEY, { title: "proof-cis note", text: "hello world" }, fakeExtract, noSplit);
    check("custom text ingest succeeds", e4 === null, String(e4));
    const srcRow = await prisma.source.findFirst({ where: { kind: `ingest:${KEY}`, title: "proof-cis note" } });
    check("Source row marked ingest:<key> with extracted summary",
      !!srcRow && srcRow.summary === "SUMMARY:hello world" && srcRow.status === "scanned");
    const items1 = await listIngestedItems(KEY);
    check("text item listed uniformly", items1.some((i) => i.kind === "text" && i.title === "proof-cis note"));

    // 3. Image write lands marked and listed.
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fac fbf9e010006840281ffffe8330000000049454e44ae426082".replace(/\s/g, ""), "hex");
    const e5 = await ingestCustomImage(KEY, png, "image/png", "proof-cis pic", fakeDescribe);
    check("custom image ingest succeeds", e5 === null, String(e5));
    const photoRow = await prisma.photo.findFirst({ where: { kind: `ingest:${KEY}` } });
    check("Photo row marked ingest:<key> with injected description",
      !!photoRow && photoRow.description === "proof-cis image description");
    uploadFile = photoRow?.filename ?? null;
    const uploadDir = process.env.UPLOAD_DIR || path.join(root, "data/uploads");
    check("bytes written to the upload dir",
      !!uploadFile && existsSync(path.join(uploadDir, uploadFile)));
    const items2 = await listIngestedItems(KEY);
    check("image item listed uniformly",
      items2.some((i) => i.kind === "image" && i.imageUrl?.startsWith("/api/uploads/")));

    // 4. No leaks into built-in surfaces.
    const gallery = await galleryBlock("carousel");
    check("public gallery omits the custom photo",
      gallery.type === "gallery" && !gallery.items.some((g) => g.id === photoRow?.id));
    check("builtin text tab omits custom rows",
      !(await listIngestedItems("text")).some((i) => i.title === "proof-cis note"));
    check("builtin photos tab omits custom rows",
      !(await listIngestedItems("photos")).some((i) => i.id === `photo:${photoRow?.id}`));

    // 5–6. GenericIngestPanel rendering.
    const row = {
      id: "x", key: KEY, label: "Proof CIS", description: "the-description",
      systemPrompt: "the-system-prompt", uploadMethod: "generic",
      storageKinds: "text+image", outputMethod: "unified items",
      builtin: false, enabled: true, order: 99, classification: "public", splitMode: "split", panelHtml: "",
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const both = renderToStaticMarkup(h(GenericIngestPanel, { row, items: items2 }));
    check("panel with text+image shows both ingest forms",
      both.includes('name="text"') && both.includes('type="file"'));
    const textOnlyHtml = renderToStaticMarkup(
      h(GenericIngestPanel, { row: { ...row, storageKinds: "text" }, items: [] }));
    check("text-only panel hides the image form", !textOnlyHtml.includes('type="file"'));
    check("panel shows the system prompt", both.includes("the-system-prompt"));
    check("panel lists a text item's title and an image item's img",
      both.includes("proof-cis note") && /<img[^>]+\/api\/uploads\//.test(both));

    // 7. Wiring (source-level).
    const newPage = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
    check("create page posts to the create action", newPage.includes("createIngestionSourceAction"));
    const dash = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
    check("dashboard renders GenericIngestPanel for custom rows", dash.includes("GenericIngestPanel"));
    check("dashboard mounts the new-source builder sub-tab", dash.includes("NewSourcePanel"));
    const knowledge = readFileSync(path.join(root, "lib/knowledge.ts"), "utf8");
    const imageGen = readFileSync(path.join(root, "lib/imageGen.ts"), "utf8");
    check("knowledge + imageGen exclude ingest: marks",
      knowledge.includes("ingest:") && imageGen.includes("ingest:"));
  } finally {
    const { prisma } = await import("@/lib/db");
    await prisma.source.deleteMany({ where: { kind: { in: [`ingest:${KEY}`, `ingest:${TEXTONLY}`] } } }).catch(() => {});
    await prisma.photo.deleteMany({ where: { kind: { startsWith: "ingest:proof-cis" } } }).catch(() => {});
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-cis" } } }).catch(() => {});
    if (uploadFile) {
      const uploadDir = process.env.UPLOAD_DIR || path.join(root, "data/uploads");
      try { unlinkSync(path.join(uploadDir, uploadFile)); } catch {}
    }
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

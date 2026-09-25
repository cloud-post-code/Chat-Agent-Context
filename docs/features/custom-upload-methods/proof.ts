/**
 * Primary proof for custom-upload-methods (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/custom-upload-methods/proof.ts
 *
 * Local dev Postgres; zero model calls. `proof-cum-` markers, finally cleanup.
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

const KEY = "proof-cum-src";
const IMGONLY = "proof-cum-imgonly";

async function main() {
  const { ingestFormsFor, saveIngestionSource } = await import("@/lib/ingestionSources");
  const { ingestCustomUrl, ingestCustomFile } = await import("@/lib/customIngest");
  const { listIngestedItems } = await import("@/lib/ingestedItems");
  const { GenericIngestPanel } = await import("../../../app/admin/GenericIngestPanel");
  const { prisma } = await import("@/lib/db");

  // 1. The matrix.
  const F = ingestFormsFor;
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const forms = (url: boolean, docFile: boolean, textarea: boolean, image: boolean) => ({
    url, docFile, textarea, image,
  });
  check("url → url field only", eq(F("url", "text"), forms(true, false, false, false)));
  check("file → doc upload only", eq(F("file", "text"), forms(false, true, false, false)));
  check("resume behaves like file", eq(F("resume", "text"), forms(false, true, false, false)));
  check("textarea → paste form only", eq(F("textarea", "text"), forms(false, false, true, false)));
  check("form behaves like textarea", eq(F("form", "text"), forms(false, false, true, false)));
  check("image → image upload only", eq(F("image", "image"), forms(false, false, false, true)));
  check("generic → paste + image", eq(F("generic", "text+image"), forms(false, false, true, true)));
  check("unknown method behaves like generic", eq(F("mystery", "text+image"), forms(false, false, true, true)));
  check("text-only storage kills the image control", eq(F("generic", "text"), forms(false, false, true, false)));
  check("image-only storage kills text controls", eq(F("generic", "image"), forms(false, false, false, true)));
  check(
    "contradictory config yields no controls",
    eq(F("image", "text"), forms(false, false, false, false)) &&
      eq(F("url", "image"), forms(false, false, false, false)),
  );

  const fakeLink = async (url: string) => ({
    title: `Linked ${url}`, rawText: "L", summary: `SUM:${url}`, tags: ["proof"],
  });
  const noSplit = { messages: { create: async () => ({ content: [{ type: "text", text: "[]" }] }) } };
  const fakeDoc = async (_bytes: Buffer, filename: string) => ({
    title: filename, rawText: "D", summary: `DOC:${filename}`, tags: ["proof"],
  });

  try {
    await saveIngestionSource({
      key: KEY, label: "Proof CUM", description: "", systemPrompt: "",
      uploadMethod: "url", storageKinds: "text", outputMethod: "unified items",
    });
    await saveIngestionSource({
      key: IMGONLY, label: "Proof CUM img", description: "", systemPrompt: "",
      uploadMethod: "image", storageKinds: "image", outputMethod: "unified items",
    });

    // 2. URL ingestion.
    check("url into image-only refused", typeof (await ingestCustomUrl(IMGONLY, "https://example.com/proof-cum", fakeLink, noSplit)) === "string");
    const u1 = await ingestCustomUrl(KEY, "https://example.com/proof-cum", fakeLink, noSplit);
    check("url ingest succeeds", u1 === null, String(u1));
    const row = await prisma.source.findUnique({ where: { url: "https://example.com/proof-cum" } });
    check("url row marked and summarized", !!row && row.kind === `ingest:${KEY}` && row.summary === "SUM:https://example.com/proof-cum");
    const u2 = await ingestCustomUrl(KEY, "https://example.com/proof-cum", fakeLink, noSplit);
    const count = await prisma.source.count({ where: { url: "https://example.com/proof-cum" } });
    check("re-ingesting the same URL updates, not duplicates", u2 === null && count === 1);

    // 3. File ingestion.
    check("file into image-only refused", typeof (await ingestCustomFile(IMGONLY, Buffer.from("x"), "a.pdf", fakeDoc, noSplit)) === "string");
    const f1 = await ingestCustomFile(KEY, Buffer.from("pdfbytes"), "proof-cum.pdf", fakeDoc, noSplit);
    check("file ingest succeeds", f1 === null, String(f1));
    const items = await listIngestedItems(KEY);
    check(
      "file item lists uniformly as text",
      items.some((i) => i.kind === "text" && i.title === "proof-cum.pdf" && i.text === "DOC:proof-cum.pdf"),
      JSON.stringify(items.map((i) => i.title)),
    );

    // 4. The panel follows the mapping.
    const base = {
      id: "x", key: KEY, label: "Proof CUM", description: "", systemPrompt: "",
      outputMethod: "", builtin: false, enabled: true, order: 0, classification: "public", splitMode: "split", panelHtml: "",
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const urlHtml = renderToStaticMarkup(
      h(GenericIngestPanel, { row: { ...base, uploadMethod: "url", storageKinds: "text" }, items: [] }));
    check("url source shows the URL field, no textarea", urlHtml.includes('name="url"') && !urlHtml.includes("<textarea"));
    const fileHtml = renderToStaticMarkup(
      h(GenericIngestPanel, { row: { ...base, uploadMethod: "file", storageKinds: "text" }, items: [] }));
    check("file source shows a document input accepting pdf/docx", /accept="[^"]*\.pdf[^"]*"/.test(fileHtml) && fileHtml.includes(".docx"));
    const contraHtml = renderToStaticMarkup(
      h(GenericIngestPanel, { row: { ...base, uploadMethod: "image", storageKinds: "text" }, items: [] }));
    check(
      "contradictory config renders the note and no forms",
      contraHtml.includes("upload method") && !contraHtml.includes("<form"),
    );
  } finally {
    await prisma.source.deleteMany({ where: { kind: { startsWith: "ingest:proof-cum" } } }).catch(() => {});
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-cum" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 5. Builder test pane uses the same mapping, still no server actions.
  const sb = readFileSync(path.join(root, "app/admin/SourceBuilder.tsx"), "utf8");
  check("SourceBuilder imports ingestFormsFor", sb.includes("ingestFormsFor"));
  check("SourceBuilder has test url + document controls", sb.includes("Scan URL (test)") && sb.includes("Upload document (test)"));
  check(
    "test pane still touches no ingest actions",
    !sb.includes("ingestCustomTextAction") && !sb.includes("ingestCustomUrlAction") && !sb.includes("ingestCustomFileAction"),
  );

  // 6. Wiring.
  const dash = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
  check("dashboard passes urlAction and fileAction", dash.includes("urlAction=") && dash.includes("fileAction="));
  const actions = readFileSync(path.join(root, "app/admin/actions/ingestion.ts"), "utf8");
  check(
    "url/file actions wrap the lib fns",
    /ingestCustomUrlAction[\s\S]{0,300}ingestCustomUrl\(/.test(actions) &&
      /ingestCustomFileAction[\s\S]{0,400}ingestCustomFile\(/.test(actions),
  );
  const builder = readFileSync(path.join(root, "lib/ingestionBuilder.ts"), "utf8");
  check(
    "builder prompt teaches per-method choices",
    builder.includes('"url"') && builder.includes('"file"') && builder.includes('"textarea"'),
  );

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

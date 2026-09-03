/**
 * Primary proof for custom-panel-code (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/custom-panel-code/tsconfig.json \
 *        docs/features/custom-panel-code/proof.ts
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

const KEY = "proof-cpc-src";
const GOOD_HTML = '<div style="display:grid;gap:8px"><h1>Clippings Board</h1>{{items}}</div>';

async function main() {
  const { saveIngestionSource } = await import("@/lib/ingestionSources");
  const { prisma } = await import("@/lib/db");
  const { GenericIngestPanel } = await import("../../../app/admin/GenericIngestPanel");

  try {
    // 1. Save validation.
    const base = {
      key: KEY, label: "Proof CPC", description: "", systemPrompt: "the-prompt",
      uploadMethod: "textarea", storageKinds: "text", outputMethod: "x",
    };
    check("safe page code saves", (await saveIngestionSource({ ...base, panelHtml: GOOD_HTML })) === null);
    const stored = await prisma.ingestionSource.findUnique({ where: { key: KEY } });
    check("page code stored", stored?.panelHtml === GOOD_HTML);
    check("script rejected",
      typeof (await saveIngestionSource({ ...base, id: stored!.id, panelHtml: "<div><script>x</script></div>" })) === "string");
    check("form rejected",
      typeof (await saveIngestionSource({ ...base, id: stored!.id, panelHtml: "<form action='/x'></form>" })) === "string");
    check("oversize rejected",
      typeof (await saveIngestionSource({ ...base, id: stored!.id, panelHtml: "<div>" + "a".repeat(41_000) + "</div>" })) === "string");
    const after = await prisma.ingestionSource.findUnique({ where: { key: KEY } });
    check("rejected code never stored", after?.panelHtml === GOOD_HTML);

    // 2. Builder validation.
    const { draftIngestionSource } = await import("@/lib/ingestionBuilder");
    const fakeClient = (text: string) => ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } });
    const good = await draftIngestionSource([{ role: "user", content: "x" }], null, {
      client: fakeClient(JSON.stringify({ reply: "ok", draft: { label: "L", panelHtml: GOOD_HTML } })),
    });
    check("draft keeps safe panelHtml", !("error" in good) && good.draft?.panelHtml === GOOD_HTML);
    const bad = await draftIngestionSource([{ role: "user", content: "x" }], null, {
      client: fakeClient(JSON.stringify({ reply: "ok", draft: { label: "L", panelHtml: "<script>evil()</script>" } })),
    });
    check("unsafe generated code drops to empty", !("error" in bad) && bad.draft?.panelHtml === "");

    // 3. Custom render.
    const row = {
      id: "x", key: KEY, label: "Proof CPC", description: "the-description",
      systemPrompt: "the-prompt", uploadMethod: "textarea", storageKinds: "text",
      outputMethod: "", builtin: false, enabled: true, order: 0,
      classification: "public", splitMode: "split", panelHtml: GOOD_HTML,
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const items = [{
      kind: "text" as const, id: "source:a", sourceKey: KEY,
      title: "Sneaky <script>alert(1)</script>", text: "body text", imageUrl: null, createdAt: new Date(0),
    }];
    const html = renderToStaticMarkup(h(GenericIngestPanel, { row, items }));
    check("sandboxed iframe renders", html.includes("sandbox=") && html.includes("Content-Security-Policy"));
    check("custom markup present with items substituted",
      html.includes("Clippings Board") && html.includes("body text") && !html.includes("{{items}}"));
    // The raw tag must never survive into the iframe document; the escaped
    // entity form must be what carries the title text.
    check("item title arrives escaped",
      !/<script>alert\(1\)<\/script>/.test(html) && /lt;script/.test(html), html.slice(0, 300));
    check("default prompt block replaced", !html.includes(">the-prompt<"));
    check("ingest form still native", html.includes('name="text"'));
    check("Manage items with Delete still native", html.includes("Manage items") && html.includes(">Delete<"));

    // 4. Default unchanged.
    const plain = renderToStaticMarkup(h(GenericIngestPanel, { row: { ...row, panelHtml: "" }, items }));
    check("no iframe without page code", !plain.includes("sandbox="));
    check("default layout shows the prompt", plain.includes("the-prompt"));
  } finally {
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-cpc" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 5. Builder wiring.
  const builder = readFileSync(path.join(root, "lib/ingestionBuilder.ts"), "utf8");
  check("builder prompt teaches panelHtml + {{items}}",
    builder.includes("panelHtml") && builder.includes("{{items}}"));
  const sb = readFileSync(path.join(root, "app/admin/SourceBuilder.tsx"), "utf8");
  check("test pane previews via PanelHtml", sb.includes("PanelHtml"));
  check("edit-mode carries existing page code", /SourceBuilderInitial[\s\S]{0,600}panelHtml/.test(sb));

  // 6. Form wiring.
  const editPage = readFileSync(path.join(root, "app/admin/sources/[key]/page.tsx"), "utf8");
  const newPage = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
  check("edit + create forms post panelHtml",
    editPage.includes('name="panelHtml"') && newPage.includes('name="panelHtml"'));
  const actions = readFileSync(path.join(root, "app/admin/actions.ts"), "utf8");
  check("create/update/built-save actions forward panelHtml",
    /createIngestionSourceAction[\s\S]{0,1200}panelHtml/.test(actions) &&
      /updateIngestionSourceAction[\s\S]{0,1200}panelHtml/.test(actions) &&
      /saveBuiltSourceAction[\s\S]{0,1200}panelHtml/.test(actions));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

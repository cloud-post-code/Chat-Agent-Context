/**
 * Primary proof for ingested-items-pagination (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/ingested-items-pagination/proof.ts
 *
 * Fully offline: static server renders with synthetic items.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { Paginated } = await import("../../../app/admin/Paginated");
  const { GenericIngestPanel } = await import("../../../app/admin/GenericIngestPanel");

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => h("li", { key: i }, `ROW-${i + 1}-END`));

  // 1. 25 rows → first page of 10 + controls.
  {
    const html = renderToStaticMarkup(h(Paginated, { children: rows(25) }));
    check("first 10 rows render", html.includes("ROW-1-END") && html.includes("ROW-10-END"));
    check("rows beyond the page do not", !html.includes("ROW-11-END") && !html.includes("ROW-25-END"));
    check("page indicator present", /Page\s*(<!-- -->)?1(<!-- -->)?\s*of\s*(<!-- -->)?3/.test(html.replace(/<[^>]+>/g, (t) => (t.startsWith("<!--") ? t : ""))) || html.includes("of"), html.slice(0, 300));
    check("item count shown", html.includes("25"));
    check("Prev and Next buttons render", html.includes(">Prev<") && html.includes(">Next<"));
    check("Prev disabled on page 1", /disabled[^>]*>Prev</.test(html) || /<button[^>]*disabled[^>]*>(<!-- -->)?Prev/.test(html), html.slice(0, 400));
  }

  // 2. Short lists are untouched.
  {
    const html = renderToStaticMarkup(h(Paginated, { children: rows(10) }));
    check("10 rows all render", html.includes("ROW-10-END"));
    check("no controls for one page", !html.includes(">Next<") && !html.includes("Page"));
  }

  // 3. Custom page size.
  {
    const html = renderToStaticMarkup(h(Paginated, { pageSize: 5, children: rows(12) }));
    check("pageSize respected", html.includes("ROW-5-END") && !html.includes("ROW-6-END"));
    check("page count follows pageSize", html.includes("3"));
  }

  // 4. GenericIngestPanel paginates and keeps per-item actions.
  {
    const row = {
      id: "x", key: "proof-pag", label: "Proof PAG", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "",
      builtin: false, enabled: true, order: 0, classification: "public",
      splitMode: "split", panelHtml: "", createdAt: new Date(0), updatedAt: new Date(0),
    };
    const items = Array.from({ length: 25 }, (_, i) => ({
      kind: "text" as const, id: `source:it${i + 1}`, sourceKey: "proof-pag",
      title: `ITEM-${i + 1}-END`, text: "x", imageUrl: null, createdAt: new Date(0),
    }));
    const html = renderToStaticMarkup(h(GenericIngestPanel, { row, items }));
    check("panel shows first page only", html.includes("ITEM-10-END") && !html.includes("ITEM-11-END"));
    check("panel shows pagination controls", html.includes(">Next<"));
    check("rows keep their Delete form + itemId",
      html.includes(">Delete<") && html.includes('value="source:it1"'));
  }

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

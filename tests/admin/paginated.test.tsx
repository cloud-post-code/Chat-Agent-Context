import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Paginated } from "@/app/admin/Paginated";
import { GenericIngestPanel } from "@/app/admin/GenericIngestPanel";

// Converted from docs/features/ingested-items-pagination/proof.ts.
const rows = (n: number) => Array.from({ length: n }, (_, i) => <li key={i}>{`ROW-${i + 1}-END`}</li>);

describe("Paginated", () => {
  it("shows the first page of 10 with controls", () => {
    const html = renderToStaticMarkup(<Paginated>{rows(25)}</Paginated>);
    expect(html).toContain("ROW-1-END");
    expect(html).toContain("ROW-10-END");
    expect(html).not.toContain("ROW-11-END");
    expect(html).toContain(">Prev<");
    expect(html).toContain(">Next<");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(<!-- -->)?Prev/);
  });
  it("leaves a single page alone", () => {
    const html = renderToStaticMarkup(<Paginated>{rows(10)}</Paginated>);
    expect(html).toContain("ROW-10-END");
    expect(html).not.toContain(">Next<");
  });
  it("respects pageSize", () => {
    const html = renderToStaticMarkup(<Paginated pageSize={5}>{rows(12)}</Paginated>);
    expect(html).toContain("ROW-5-END");
    expect(html).not.toContain("ROW-6-END");
  });
});

describe("GenericIngestPanel", () => {
  it("paginates items and keeps the per-item delete form", () => {
    const row = {
      id: "x", userId: "u1", key: "proof-pag", label: "Proof PAG", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "",
      builtin: false, enabled: true, order: 0, classification: "public",
      splitMode: "split", panelHtml: "", createdAt: new Date(0), updatedAt: new Date(0),
    };
    const items = Array.from({ length: 25 }, (_, i) => ({
      kind: "text" as const, id: `source:it${i + 1}`, sourceKey: "proof-pag",
      title: `ITEM-${i + 1}-END`, text: "x", imageUrl: null, createdAt: new Date(0),
    }));
    const html = renderToStaticMarkup(<GenericIngestPanel row={row} items={items} />);
    expect(html).toContain("ITEM-10-END");
    expect(html).not.toContain("ITEM-11-END");
    expect(html).toContain(">Next<");
    expect(html).toContain(">Delete<");
    expect(html).toContain('value="source:it1"');
  });
});

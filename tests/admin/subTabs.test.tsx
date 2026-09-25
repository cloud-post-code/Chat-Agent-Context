import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SubTabs } from "@/app/admin/SubTabs";

// Converted from docs/features/{admin-content-tabs,admin-graph-tabs,new-source-subtab}/proof.ts.
const tabs = [
  { key: "projects", label: "Projects", content: <p>PROJECTS-PANEL</p> },
  { key: "knowledge", label: "Knowledge", content: <p>KNOWLEDGE-PANEL</p> },
  { key: "photos", label: "Photos", content: <p>PHOTOS-PANEL</p> },
];
const render = (initial?: string, ariaLabel?: string) =>
  renderToStaticMarkup(<SubTabs tabs={tabs} initial={initial} ariaLabel={ariaLabel} />);

describe("SubTabs", () => {
  it("renders every tab button and only the first panel by default", () => {
    const html = render();
    for (const l of ["Projects", "Knowledge", "Photos"]) expect(html).toContain(`>${l}</button>`);
    expect(html).toContain("PROJECTS-PANEL");
    expect(html).not.toContain("KNOWLEDGE-PANEL");
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
  });

  it("opens on `initial`, falling back to the first tab for an unknown key", () => {
    expect(render("photos")).toContain("PHOTOS-PANEL");
    expect(render("photos")).not.toContain("PROJECTS-PANEL");
    expect(render("bogus")).toContain("PROJECTS-PANEL");
  });

  it("selects the opened tab in the strip", () => {
    expect(render("photos")).toMatch(/aria-selected="true"[^>]*>Photos/);
  });

  it("labels the tablist, overridable, and accepts React-node labels", () => {
    expect(render()).toContain('aria-label="Content sections"');
    expect(render(undefined, "Graph sections")).toContain('aria-label="Graph sections"');
    const html = renderToStaticMarkup(
      <SubTabs tabs={[{ key: "entities", label: <>Entities <span>116</span></>, content: <p>E</p> }]} />,
    );
    expect(html).toContain("Entities ");
    expect(html).toContain("<span>116</span>");
  });
});

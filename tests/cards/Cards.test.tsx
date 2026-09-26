import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Cards, type UiBlock } from "@/app/cards/Cards";

// Tripwire for the card renderer: every server-emitted UiBlock kind renders
// to static markup with its content present. Content assertions, not HTML
// snapshots, so a style refactor doesn't trip it but a broken card does.
const render = (block: UiBlock) => renderToStaticMarkup(<Cards block={block} slug="demo" />);
const project = { id: "p1", name: "Orrery", blurb: "A planetarium", detail: null, githubUrl: "https://github.com/x/orrery", liveUrl: null, imageUrl: null, tags: ["ts"] };
const photo = (id: string) => ({ id, src: `/api/uploads/${id}.jpg`, description: "red gel nails", caption: `Photo ${id}` });

describe("Cards", () => {
  it("projects and a single project", () => {
    expect(render({ type: "projects", title: "Work", items: [project] })).toContain("Orrery");
    expect(render({ type: "projects", items: [] })).toContain("No projects yet");
    expect(render({ type: "project", item: project })).toContain("github.com/x/orrery");
  });
  it("gallery: three photos render three images and no carousel controls", () => {
    const html = render({ type: "gallery", layout: "carousel", items: [photo("a"), photo("b"), photo("c")] });
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).not.toMatch(/aria-label="(Next|Previous)/);
  });
  it("services: focus items first, then a Similar label", () => {
    const html = render({
      type: "services",
      focusIds: ["gel"],
      items: [{ id: "gel", name: "Gel manicure", description: "", priceLabel: "$45" }, { id: "acrylic", name: "Acrylic set", description: "" }],
      booking: null,
    });
    expect(html.indexOf("Gel manicure")).toBeLessThan(html.indexOf("Acrylic set"));
    expect(html).toContain("Similar");
  });
  it("contact and social", () => {
    expect(render({ type: "contact" })).toContain("Leave your details");
    expect(render({ type: "social", items: [{ platform: "instagram", url: "https://instagram.com/x" }] })).toContain("https://instagram.com/x");
  });
});

import { describe, expect, it } from "vitest";
import { parseSampleBlock } from "@/lib/uiCards";

// lib/uiCards imports the database client but parseSampleBlock is pure;
// tests/setup.ts makes any accidental query throw.
describe("parseSampleBlock", () => {
  it("accepts a stored gallery sample", () => {
    const block = parseSampleBlock(JSON.stringify({ type: "gallery", layout: "carousel", items: [{ id: "p1", src: "/api/uploads/a.jpg", description: "", caption: null }] }));
    expect(block?.type).toBe("gallery");
  });
  it("accepts a social block", () => {
    expect(parseSampleBlock(JSON.stringify({ type: "social", items: [{ platform: "instagram", url: "https://instagram.com/x" }] }))?.type).toBe("social");
  });
  it("rejects the retired services, menu and cart kinds", () => {
    expect(parseSampleBlock(JSON.stringify({ type: "services", items: [], booking: null }))).toBeNull();
    expect(parseSampleBlock(JSON.stringify({ type: "menu", items: [] }))).toBeNull();
    expect(parseSampleBlock(JSON.stringify({ type: "cart" }))).toBeNull();
  });
  it("rejects garbage and unknown types", () => {
    expect(parseSampleBlock("{not json")).toBeNull();
    expect(parseSampleBlock(JSON.stringify({ type: "nope" }))).toBeNull();
    expect(parseSampleBlock(JSON.stringify({ hello: 1 }))).toBeNull();
  });
});

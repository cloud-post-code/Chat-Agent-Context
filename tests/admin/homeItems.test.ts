import { describe, expect, it } from "vitest";
import { attentionItems, checklistItems } from "@/app/admin/homeItems";

// Converted from docs/features/admin-nav-groups/proof.ts §3.
describe("attentionItems", () => {
  const attention = attentionItems({
    flaggedDown: 2,
    unreviewed: 3,
    topQuestions: [{ label: "Do you do walk-ins?", count: 4 }],
  });
  const byTab = Object.fromEntries(attention.map((a) => [a.tab, a]));

  it("routes flagged answers to activity with the count", () => {
    const flagged = attention.find((a) => a.label.includes("flagged"));
    expect(flagged?.tab).toBe("activity");
    expect(flagged?.count).toBe(2);
  });
  it("counts presets waiting for review", () => {
    expect(byTab.answers?.count).toBe(3);
  });
  it("carries the most-asked question", () => {
    expect(attention.some((a) => a.detail?.includes("walk-ins"))).toBe(true);
  });
  it("drops empty rows", () => {
    expect(attentionItems({ flaggedDown: 0, unreviewed: 0, topQuestions: [] })).toEqual([]);
  });
});

describe("checklistItems", () => {
  it("marks each incomplete area not done", () => {
    const todo = Object.fromEntries(
      checklistItems({
        profile: { company_name: "Salon", owner_name: "", company_phone_number: "", company_email: "x@y", company_hours: "" },
        taglineSource: "suggested",
        cardCount: 0,
        sources: [
          { key: "blog", label: "Blog", count: 0 },
          { key: "services", label: "Services", count: 4 },
        ],
      }).map((c) => [c.tab, c.done]),
    );
    expect(todo).toMatchObject({ profile: false, theme: false, a2ui: false, blog: false, services: true });
  });
  it("is all done for a fully set-up account", () => {
    const all = checklistItems({
      profile: { company_name: "S", owner_name: "O", company_phone_number: "1", company_email: "e", company_hours: "h" },
      taglineSource: "extracted",
      cardCount: 2,
      sources: [{ key: "blog", label: "Blog", count: 1 }],
    });
    expect(all.every((c) => c.done)).toBe(true);
  });
});

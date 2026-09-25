import { describe, expect, it } from "vitest";
import {
  CONTENT_TAB_KEYS,
  NAV_GROUPS,
  NEW_SOURCE_TAB_KEY,
  contentTabsFromSources,
  fixedPanelEntries,
  labelsFromNav,
  resolveAdminTab,
} from "@/app/admin/contentTabs";

// Converted from docs/features/{admin-content-tabs,admin-nav-groups,
// ingestion-driven-dashboard,new-source-subtab}/proof.ts — the behavioural
// checks only. The source-grep "wiring" checks those proofs also made stay
// in the proof scripts (npm run crosscheck).

describe("nav registry", () => {
  it("lists the four starter content tabs", () => {
    expect([...CONTENT_TAB_KEYS]).toEqual(["blog", "testimonials", "about-team", "services"]);
  });

  it("has seven nav groups in order with unique sub keys", () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(["home", "inbox", "knowledge", "agent", "cards", "booking", "settings"]);
    const subKeys = NAV_GROUPS.flatMap((g) => g.subs.map((s) => s.key));
    expect(new Set(subKeys).size).toBe(subKeys.length);
  });

  it("fixed panels: no home, users only for operators, booking section present", () => {
    const owner = fixedPanelEntries(false).map((e) => e.key);
    const operator = fixedPanelEntries(true).map((e) => e.key);
    expect(owner).not.toContain("home");
    expect(owner).not.toContain("users");
    expect(operator).toContain("users");
    for (const k of ["appointments", "orders", "booking", "activity", "graph", "a2ui", "booking-services"]) {
      expect(owner).toContain(k);
    }
  });

  it("labels come from the nav config", () => {
    const labels = labelsFromNav();
    expect(labels.graph).toBe("Health");
    expect(labels.a2ui).toBe("Cards");
    expect(labels["booking-services"]).toBe("Services");
  });
});

describe("resolveAdminTab", () => {
  it.each([
    ["activity", "inbox", "activity"],
    ["calendar", "inbox", "appointments"],
    ["orders", "inbox", "orders"],
    ["booking", "booking", "booking"],
    ["booking-services", "booking", "booking-services"],
    ["graph", "knowledge", "graph"],
    ["a2ui", "cards", "a2ui"],
    ["contacts", "settings", "contacts"],
    ["answers", "agent", "answers"],
    ["goals", "agent", "goals"],
    ["profile", "settings", "profile"],
    ["theme", "settings", "theme"],
    ["me", "settings", "profile"],
    ["users", "settings", "users"],
    [NEW_SOURCE_TAB_KEY, "knowledge", NEW_SOURCE_TAB_KEY],
  ])("%s → %s/%s", (key, nav, sub) => {
    expect(resolveAdminTab(key)).toEqual({ nav, sub });
  });

  it("opens each starter content key under Knowledge", () => {
    for (const key of CONTENT_TAB_KEYS) expect(resolveAdminTab(key)).toEqual({ nav: "knowledge", sub: key });
  });

  it("resolves live source keys, 'content', 'knowledge' and unknowns", () => {
    expect(resolveAdminTab("custom-x", ["blog", "custom-x"])).toEqual({ nav: "knowledge", sub: "custom-x" });
    expect(resolveAdminTab("content", ["blog", "custom-x"])).toEqual({ nav: "knowledge", sub: "blog" });
    expect(resolveAdminTab("content", [])).toEqual({ nav: "knowledge", sub: undefined });
    expect(resolveAdminTab("knowledge")).toEqual({ nav: "knowledge", sub: undefined });
    expect(resolveAdminTab("bogus")).toEqual({ nav: "bogus", sub: undefined });
    expect(resolveAdminTab(undefined)).toEqual({ nav: undefined, sub: undefined });
  });
});

describe("contentTabsFromSources", () => {
  it("maps enabled rows with a panel, in row order, dropping the rest", () => {
    const rows = [
      { key: "photos", label: "Photos", enabled: true },
      { key: "links", label: "Links", enabled: true },
      { key: "drafts", label: "Drafts", enabled: false },
      { key: "custom-notes", label: "Notes", enabled: true },
    ];
    const tabs = contentTabsFromSources(rows, { photos: "PHOTOS", links: "LINKS", drafts: "DRAFTS" });
    expect(tabs.map((t) => [t.key, t.label, t.content])).toEqual([
      ["photos", "Photos", "PHOTOS"],
      ["links", "Links", "LINKS"],
    ]);
  });
});

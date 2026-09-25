import { describe, expect, it } from "vitest";
import * as T from "@/lib/booking/types";
import * as Q from "@/lib/appointmentTypes";

// Converted from docs/features/booking-flow/proof.ts §A (the pure contract).
// §B–D of that proof need Postgres and stay in the crosscheck.

describe("pricingFromText / pricingLabel", () => {
  it.each([
    ["$35", { kind: "fixed", amount: 35 }],
    ["$40+", { kind: "starting_at", amount: 40 }],
    ["from £25", { kind: "starting_at" }],
    ["$30–$45", { kind: "range", amount: 30, maxAmount: 45 }],
    ["$60/hr", { kind: "hourly" }],
    ["$12 per person", { kind: "per_person" }],
    ["Free", { kind: "free" }],
    ["Call for a quote", { kind: "quote" }],
    ["", { kind: "variable" }],
  ])("%j", (text, expected) => {
    expect(T.pricingFromText(text)).toMatchObject(expected);
  });
  it("labels every pricing kind", () => {
    expect(T.pricingLabel({ kind: "fixed", amount: 45 })).toBe("$45");
    expect(T.pricingLabel({ kind: "starting_at", amount: 45 })).toBe("From $45");
    expect(T.pricingLabel({ kind: "range", amount: 45, maxAmount: 80 })).toBe("$45–$80");
    expect(T.pricingLabel({ kind: "hourly", amount: 45 })).toBe("$45/hr");
    expect(T.pricingLabel({ kind: "per_person", amount: 12 })).toBe("$12/person");
    expect(T.pricingLabel({ kind: "per_unit", amount: 40, unitLabel: "room" })).toBe("$40/room");
    expect(T.pricingLabel({ kind: "quote" })).toBe("Quote");
    expect(T.pricingLabel({ kind: "free" })).toBe("Free");
    expect(T.pricingLabel({ kind: "variable" })).toBe("Varies");
    expect(T.pricingLabel({ kind: "fixed", amount: 25 }, "GBP")).toBe("£25");
  });
  it("formats durations", () => {
    expect(T.formatDuration(45)).toBe("45 min");
    expect(T.formatDuration(90)).toBe("1 hr 30 min");
    expect(T.formatDuration(120)).toBe("2 hr");
  });
});

describe("sanitizers", () => {
  it("sanitizePricing", () => {
    const p = T.sanitizePricing({ kind: "range", amount: "30", maxAmount: 20 });
    expect(p.kind).toBe("range");
    expect(p.maxAmount).toBeUndefined();
    expect(T.sanitizePricing({ kind: "fixed" }).kind).toBe("variable");
    expect(T.sanitizePricing({ kind: "nonsense", amount: 5 }).kind).toBe("fixed");
  });
  it("sanitizeServiceConfig", () => {
    const cfg = T.sanitizeServiceConfig({
      addons: [{ name: "Beard trim", price: "10", durationMinutes: 15 }, { name: "Beard trim" }, { name: "" }],
      variants: [{ name: "Long hair", pricing: { kind: "fixed", amount: 65 }, durationMinutes: 60 }],
      deposit: { kind: "percent", amount: 20 },
      modes: ["in_person", "mobile", "teleport"],
      images: ["/api/uploads/abc.jpg", "javascript:alert(1)", "https://example.com/x.jpg"],
      bufferAfterMinutes: 10000,
    });
    expect(cfg.addons).toHaveLength(1);
    expect(cfg.addons[0]).toMatchObject({ id: "beard-trim", price: 10 });
    expect(cfg.variants[0]).toMatchObject({ pricing: { amount: 65 }, durationMinutes: 60 });
    expect(cfg.deposit).toMatchObject({ kind: "percent", amount: 20 });
    expect(cfg.modes).toEqual(["in_person", "mobile"]);
    expect(cfg.images).toHaveLength(2);
    expect(cfg.bufferAfterMinutes).toBe(480);
    expect(T.sanitizeDeposit({ kind: "percent", amount: 150 }).kind).toBe("none");
  });
  it("sanitizeStaffConfig", () => {
    const staff = T.sanitizeStaffConfig({
      specialties: ["Fades", "Fades", " Color "],
      hours: { mon: [{ start: "10:00", end: "18:00" }], tue: [{ start: "18:00", end: "10:00" }] },
      timeOff: [{ start: "2026-12-24", end: "2026-12-26", label: "Holiday" }, { start: "x", end: "y" }],
      priceOverrides: { svc1: 55, bad: -5 },
      durationOverrides: { svc1: 45.6 },
    });
    expect(staff.specialties).toEqual(["Fades", "Color"]);
    expect(staff.hours?.mon).toHaveLength(1);
    expect(staff.hours?.tue).toHaveLength(0);
    expect(staff.timeOff).toHaveLength(1);
    expect(staff.timeOff[0]).toMatchObject({ label: "Holiday" });
    expect(staff.timeOff[0].start).toMatch(/^2026-12-24/);
    expect(staff.priceOverrides).toEqual({ svc1: 55 });
    expect(staff.durationOverrides.svc1).toBe(46);
    expect(T.sanitizeStaffConfig({ hours: { mon: [] } }).hours).toBeNull();
  });
  it("sanitizeLocationConfig", () => {
    const loc = T.sanitizeLocationConfig({
      serviceArea: { postalCodes: ["78701", " 78702 ", "78701"], radiusMiles: "12.34", travelFee: 25 },
      meetingLink: "http://insecure.example",
      capacity: 3,
      priceOverrides: { svc1: 50 },
    });
    expect(loc.serviceArea).toMatchObject({ postalCodes: ["78701", "78702"], radiusMiles: 12.3, travelFee: 25 });
    expect(loc.meetingLink).toBe("");
    expect(loc.capacity).toBe(3);
    expect(loc.priceOverrides.svc1).toBe(50);
    expect(T.sanitizeLocationConfig({}).capacity).toBe(1);
  });
  it("sanitizeBookingSettings", () => {
    const s = T.sanitizeBookingSettings({
      timezone: "Mars/Olympus",
      slotIntervalMinutes: 17,
      leadTimeMinutes: -5,
      maxAdvanceDays: 9999,
      promoCodes: [{ code: " welcome10 ", kind: "percent", amount: 10 }, { code: "BAD", kind: "percent", amount: 500 }],
      memberships: [{ name: "Gold", discountPercent: 15 }],
      tips: { enabled: true, presets: [10, 20, 500] },
      flow: [{ kind: "questions", screen: 2, title: " Your details " }, { kind: "bogus" }, { kind: "questions" }, { kind: "time" }],
    });
    expect(s.timezone).toBe(T.DEFAULT_TIMEZONE);
    expect(s.slotIntervalMinutes).toBe(30);
    expect(s.leadTimeMinutes).toBe(0);
    expect(s.maxAdvanceDays).toBe(730);
    expect(s.flow).toEqual([{ kind: "questions", title: "Your details", screen: 2 }, { kind: "time" }]);
    expect(s.promoCodes).toHaveLength(1);
    expect(s.promoCodes[0].code).toBe("WELCOME10");
    expect(s.memberships[0].id).toBe("gold");
    expect(s.tips.presets).toEqual([10, 20]);
    expect("promoCodes" in T.publicRules(s)).toBe(false);
    expect(T.publicRules(s).hasPromoCodes).toBe(true);
    const defaults = T.sanitizeBookingSettings({});
    expect(defaults.hours.mon[0].start).toBe("09:00");
    expect(defaults.hours.sat).toHaveLength(0);
    expect(defaults.confirmation).toBe("instant");
    const ch = T.sanitizeBookingSettings({ channels: ["phone", "fax", "phone", "walk_in"], confirmation: "request", confirmationOwner: "yes" });
    expect(ch.channels).toEqual(["phone", "walk_in"]);
    expect(ch.confirmation).toBe("request");
    expect(ch.confirmationOwner).toBe(false);
  });
  it("sanitizeSelection", () => {
    const sel = T.sanitizeSelection({
      serviceId: "svc", addonIds: ["a", "a", "b"], quantity: "3", staffId: "", mode: "mobile",
      customer: { firstName: " Ada ", email: "ada@example.com", smsConsent: "yes", hacker: "x" },
      recurrence: { frequency: "weekly", count: 99 }, promoCode: " welcome10 ", tipPercent: 20, tipAmount: 5,
      answers: { q1: "yes" },
    });
    expect(sel).toMatchObject({ addonIds: ["a", "b"], quantity: 3, staffId: null, mode: "mobile", promoCode: "WELCOME10", answers: { q1: "yes" } });
    expect(sel.customer.firstName).toBe("Ada");
    expect("hacker" in sel.customer).toBe(false);
    expect(sel.recurrence?.count).toBe(26);
  });
});

describe("customer from answers", () => {
  it("reads the customer out of role-tagged fields", () => {
    expect(Q.customerFromAnswers([{ key: "fn", role: "first_name" }], {})).toEqual({});
    expect(Q.customerFromAnswers([{ key: "fn", role: "first_name" }], { fn: "Ada" }).firstName).toBe("Ada");
    expect(
      Q.customerFromAnswers([{ key: "n", role: "name" }, { key: "n2", role: "name" }, { key: "e", role: "email" }], { n: "Ada Lovelace", n2: "Bob", e: "ada@example.invalid" }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace", email: "ada@example.invalid" });
  });
});

describe("intake rules", () => {
  const field = (type: string, config: Record<string, unknown> = {}) => ({ label: "F", type, config } as never);
  it("resolves date, upload, signature and waiver answers", () => {
    expect(Q.resolveAnswer(field("date"), "2026-10-05")).toMatchObject({ ok: true, value: "2026-10-05" });
    expect(Q.resolveAnswer(field("date"), "next tuesday").ok).toBe(false);
    expect(Q.resolveAnswer(field("photo"), "/api/uploads/0f1e2d3c-1111-2222-3333-444455556666.jpg").ok).toBe(true);
    expect(Q.resolveAnswer(field("photo"), "https://evil.example/x.jpg").ok).toBe(false);
    expect(Q.isUploadType("signature")).toBe(true);
    expect(Q.resolveAnswer(field("waiver", { text: "I agree" }), "yes")).toMatchObject({ ok: true, value: "Agreed" });
    expect(Q.resolveAnswer(field("waiver"), "")).toMatchObject({ ok: true, value: "" });
    expect(Q.sanitizeFieldConfig("waiver", { text: " Rules\r\nhere ", options: [] })).toEqual({ text: "Rules\nhere" });
  });
  it("shows a conditional field only when its condition matches", () => {
    const cond = Q.sanitizeFieldConfig("short_text", { showIf: { key: "allergies", values: ["Yes", ""] } });
    expect(cond.showIf).toEqual({ key: "allergies", values: ["Yes"] });
    const q = { key: "which", config: cond };
    const keys = ["allergies", "which"];
    expect(Q.isFieldShown(q, {}, keys)).toBe(false);
    expect(Q.isFieldShown(q, { allergies: "No" }, keys)).toBe(false);
    expect(Q.isFieldShown(q, { allergies: "yes" }, keys)).toBe(true);
    expect(Q.isFieldShown(q, {}, ["which"])).toBe(true);
    expect(Q.isFieldShown({ key: "b", config: { showIf: { key: "a", values: [] } } }, { a: "anything" })).toBe(true);
    expect(Q.isFieldShown(q, { allergies: ["Nuts", "Yes"] })).toBe(true);
    expect(Q.sanitizeFieldConfig("short_text", { showIf: { key: "Bad Key", values: [] } }).showIf).toBeUndefined();
  });
});

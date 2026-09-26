import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceStep } from "@/app/cards/booking/ServiceStep";
import { emptySelection } from "@/lib/booking/session";
import type { BookingFlow, ServiceRow } from "@/lib/booking/types";

// The service step draws photos only when every listed service has its own,
// so a picture always points at one service and never at a gap; and when
// the services carry categories, the step offers them as one dropdown.

const svc = (over: Partial<ServiceRow>): ServiceRow => ({
  id: "s", name: "Haircut", category: "", description: "", imageUrl: null, images: [], pricing: { kind: "fixed", amount: 45 }, durationMinutes: 45,
  addons: [], variants: [], deposit: { kind: "none" }, modes: [], staffIds: [], locationIds: [], eligibility: "", preparation: "", cancellationPolicy: "",
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, order: 0, enabled: true, ...over,
});

const flowWith = (services: ServiceRow[]): BookingFlow => ({
  business: { name: "Salon", timezone: "America/New_York", currency: "USD", phone: "" },
  services,
  categories: [...new Set(services.map((s) => s.category).filter(Boolean))],
  staff: [],
  locations: [],
  rules: { flow: [] } as unknown as BookingFlow["rules"],
  preselect: { serviceId: null },
});

const render = (flow: BookingFlow) =>
  renderToStaticMarkup(<ServiceStep flow={flow} selection={emptySelection(null, "America/New_York")} onPick={() => {}} />);

describe("ServiceStep images", () => {
  it("draws a photo on every tile when every service has one", () => {
    const html = render(flowWith([svc({ id: "a", imageUrl: "/api/uploads/a.jpg" }), svc({ id: "b", name: "Color", imageUrl: "/api/uploads/b.jpg" })]));
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).not.toContain("placeholder-image");
  });
  it("draws no image at all when even one service lacks a photo", () => {
    const html = render(flowWith([svc({ id: "a", imageUrl: "/api/uploads/a.jpg" }), svc({ id: "b", name: "Color" })]));
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("placeholder-image");
  });
  it("ignores a disabled service's missing photo", () => {
    const html = render(flowWith([svc({ id: "a", imageUrl: "/api/uploads/a.jpg" }), svc({ id: "b", name: "Old", enabled: false })]));
    expect(html.match(/<img /g)).toHaveLength(1);
  });
});

describe("ServiceStep categories", () => {
  it("offers the services' categories as one dropdown, all shown by default", () => {
    const html = render(flowWith([svc({ id: "a", category: "Hair" }), svc({ id: "b", name: "Balayage", category: "Color" })]));
    expect(html).toMatch(/<select[^>]*aria-label="Category"/);
    expect(html.match(/<option /g)).toHaveLength(3);
    expect(html).toContain("Hair");
    expect(html).toContain("Balayage");
  });
  it("draws no category control when no service has a category", () => {
    const html = render(flowWith([svc({ id: "a" }), svc({ id: "b", name: "Color" })]));
    expect(html).not.toContain("<select");
  });
});

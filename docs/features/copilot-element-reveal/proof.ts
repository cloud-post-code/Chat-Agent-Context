/**
 * Primary proof for copilot-element-reveal (see PROOF.md).
 * Run: npx tsx docs/features/copilot-element-reveal/proof.ts
 *
 * Seeds a throwaway tenant with real rows (two bookings on a Friday and a
 * Saturday, three priced services, an enabled and a disabled provider, a
 * location, a goal, a rule, two presets), drives the admin brain's tool loop
 * with a scripted model client (the only doubled boundary), and asserts the
 * `elements` events, the index the prompt carries, the pure selector, and the
 * element nodes the panel side builds from the same rows.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";

// The panels' JSX compiles to React.createElement under tsx (jsx: preserve);
// Next provides the global at build time, so the proof provides it here.
(globalThis as { React?: typeof React }).React = React;

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const src = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** One scripted model turn: optional streamed text, then tool calls (or none = done). */
type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };

/** A ModelClient whose stream() pops the next scripted turn and records `system` + tools. */
function scriptedClient(
  turns: Turn[],
  seen: { system: string[]; calls: number; results: string[]; toolNames: string[] },
) {
  let i = 0;
  return {
    messages: {
      stream(params: { system?: unknown; messages?: unknown[]; tools?: { name: string }[] }) {
        seen.calls++;
        seen.system.push(String(params.system ?? ""));
        seen.toolNames = (params.tools ?? []).map((t) => t.name);
        // Capture tool_result texts the loop fed back on this turn.
        const last = (params.messages ?? []).slice(-1)[0] as { content?: unknown } | undefined;
        if (last && Array.isArray(last.content)) {
          for (const b of last.content as { type?: string; content?: unknown }[]) {
            if (b.type === "tool_result") seen.results.push(String(b.content ?? ""));
          }
        }
        const turn = turns[Math.min(i++, turns.length - 1)] ?? {};
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text: turn.text } };
            }
          },
          async finalMessage() {
            const content: unknown[] = [];
            if (turn.text) content.push({ type: "text", text: turn.text });
            for (const [j, t] of (turn.tools ?? []).entries()) {
              content.push({ type: "tool_use", id: `tu_${i}_${j}`, name: t.name, input: t.input });
            }
            return { content };
          },
        };
      },
    },
  };
}

type Ev = { t: string; v: unknown };
type ElementsEvent = { panel: string; ids: string[]; title?: string };

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { adminAnswer } = await import("../../../lib/adminBrain");
  const { saveBookingSettings, saveService, saveStaff, saveLocation } = await import(
    "../../../lib/booking/store"
  );
  const { saveDirective } = await import("../../../lib/directives");
  const { saveCannedAnswer } = await import("../../../lib/canned");

  // The modules under proof — imported lazily so a red run reports the
  // missing module as a FAIL instead of crashing before any check prints.
  let elements: typeof import("../../../lib/adminElements") | null = null;
  let load: typeof import("../../../lib/adminElementsLoad") | null = null;
  let nodes: typeof import("../../../app/admin/elements") | null = null;
  try {
    elements = await import("../../../lib/adminElements");
  } catch {
    /* red */
  }
  try {
    load = await import("../../../lib/adminElementsLoad");
  } catch {
    /* red */
  }
  try {
    nodes = await import("../../../app/admin/elements");
  } catch {
    /* red */
  }
  check("lib/adminElements.ts exists", elements !== null);
  check("lib/adminElementsLoad.ts exists", load !== null);
  check("app/admin/elements.tsx exists", nodes !== null);

  const user = await prisma.user.create({
    data: {
      email: "proof-copilot-element-reveal@example.invalid",
      name: "Proof Element Reveal",
      slug: `proof-element-reveal-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });

  const run = async (turns: Turn[], operator = false) => {
    const seen = { system: [] as string[], calls: 0, results: [] as string[], toolNames: [] as string[] };
    const events: Ev[] = [];
    for await (const e of adminAnswer(
      { userId: user.id, message: "scripted", operator },
      { client: scriptedClient(turns, seen) as never },
    )) {
      events.push(e);
    }
    return { events, seen };
  };
  const elementEvents = (events: Ev[]) =>
    events.filter((e) => e.t === "elements").map((e) => e.v as ElementsEvent);
  const show = (input: Record<string, unknown>): Turn[] => [
    { tools: [{ name: "show_elements", input }] },
    { text: "Here you go." },
  ];

  try {
    // ── Seed: the screen recording's situation, in a fixed zone ──
    await saveBookingSettings(user.id, { timezone: "America/New_York" });
    // Fri Sep 25 2026 13:00 ET = 17:00Z; Sat Sep 26 2026 09:30 ET = 13:30Z.
    const fri = await prisma.appointment.create({
      data: {
        userId: user.id,
        startsAt: new Date("2026-09-25T17:00:00Z"),
        endsAt: new Date("2026-09-25T17:30:00Z"),
        durationMinutes: 30,
        serviceName: "Rebalance (Fill-In)",
        customer: JSON.stringify({
          firstName: "Christopher",
          lastName: "Mauri",
          email: "christopher@example.invalid",
          phone: "7819605419",
        }),
        pricing: JSON.stringify({ currency: "USD", lines: [], subtotal: 55, total: 55, estimate: false, quoteRequired: false, deposit: null, balance: null, durationMinutes: 30, display: "$55" }),
        answers: JSON.stringify({ services: "Rebalance (Fill-In) ($55)" }),
      },
    });
    const sat = await prisma.appointment.create({
      data: {
        userId: user.id,
        startsAt: new Date("2026-09-26T13:30:00Z"),
        endsAt: new Date("2026-09-26T14:00:00Z"),
        durationMinutes: 30,
        customer: JSON.stringify({ firstName: "Blake", email: "blake@example.invalid" }),
        answers: JSON.stringify({ services: "Basic Manicure, Gel Manicure, French" }),
      },
    });
    const svc = async (name: string, amount: number) => {
      const r = await saveService(user.id, { name, pricing: { kind: "fixed", amount }, durationMinutes: 30, enabled: true });
      if (!r.ok) throw new Error(r.error);
      return r.id;
    };
    const basic = await svc("Basic Manicure", 35);
    const gel = await svc("Gel Manicure", 55);
    const french = await svc("French", 80);
    const ava = await saveStaff(user.id, { name: "Ava", role: "Nail tech", enabled: true });
    const ben = await saveStaff(user.id, { name: "Ben", role: "Nail tech", enabled: false });
    if (!ava.ok || !ben.ok) throw new Error("staff seed failed");
    const loc = await saveLocation(user.id, { name: "Main Street", kind: "business", address: "1 Main St", enabled: true });
    if (!loc.ok) throw new Error("location seed failed");
    await saveDirective(user.id, { kind: "goal", text: "Get interested visitors to book.", enabled: true });
    await saveDirective(user.id, { kind: "rule", text: "Never share my phone number.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Do you take walk-ins?", answer: "Yes, before 4pm.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Where do I park?", answer: "Behind the shop.", enabled: true });
    const walkIns = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Do you take walk-ins?" } });
    const parking = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Where do I park?" } });
    if (walkIns) await prisma.cannedAnswer.update({ where: { id: walkIns.id }, data: { hits: 3 } });
    const rule = await prisma.agentDirective.findFirst({ where: { userId: user.id, kind: "rule" } });

    // ── 1. The recording's question: only the Friday card ──
    const friday = await run(show({ panel: "appointments", where: [{ facet: "weekday", op: "is", value: "friday" }] }));
    const fe = elementEvents(friday.events);
    check("friday filter yields exactly one elements event", fe.length === 1, JSON.stringify(friday.events));
    check("elements event names the appointments panel", fe[0]?.panel === "appointments");
    check("elements event ids are exactly the Friday booking", JSON.stringify(fe[0]?.ids) === JSON.stringify([fri.id]), JSON.stringify(fe[0]?.ids));
    check("no full panel is shown for an element reveal", !friday.events.some((e) => e.t === "panel"));
    check("loop terminates after the reveal", friday.seen.calls === 2, String(friday.seen.calls));
    check("show_elements is offered as a tool", friday.seen.toolNames.includes("show_elements"), friday.seen.toolNames.join(","));

    // ── 2. Other facets and ops ──
    const byName = await run(show({ panel: "appointments", where: [{ facet: "customer", op: "contains", value: "christopher" }] }));
    check("customer contains selects the same booking", JSON.stringify(elementEvents(byName.events)[0]?.ids) === JSON.stringify([fri.id]));
    const both = await run(show({ panel: "appointments", where: [{ facet: "date", op: "after", value: "2026-09-24" }] }));
    check("date after selects both bookings in index order", JSON.stringify(elementEvents(both.events)[0]?.ids) === JSON.stringify([fri.id, sat.id]), JSON.stringify(elementEvents(both.events)));
    const cheap = await run(show({ panel: "booking-services", where: [{ facet: "price", op: "lte", value: "50" }] }));
    check("price lte 50 selects only the cheapest service", JSON.stringify(elementEvents(cheap.events)[0]?.ids) === JSON.stringify([basic]), JSON.stringify(elementEvents(cheap.events)));
    const pricey = await run(show({ panel: "booking-services", where: [{ facet: "price", op: "gte", value: "55" }] }));
    check("price gte 55 selects the two dearer services", JSON.stringify(elementEvents(pricey.events)[0]?.ids) === JSON.stringify([gel, french]));
    const disabled = await run(show({ panel: "booking-providers", where: [{ facet: "enabled", op: "is", value: "no" }] }));
    check("enabled is no selects only the disabled provider", JSON.stringify(elementEvents(disabled.events)[0]?.ids) === JSON.stringify([ben.id]));
    const phoneRule = await run(show({ panel: "rules", where: [{ facet: "text", op: "contains", value: "phone" }] }));
    check("rule text contains phone finds the rule", JSON.stringify(elementEvents(phoneRule.events)[0]?.ids) === JSON.stringify([rule?.id]));
    const unserved = await run(show({ panel: "answers", where: [{ facet: "served", op: "is", value: "0" }] }));
    check("served is 0 finds the never-served preset", JSON.stringify(elementEvents(unserved.events)[0]?.ids) === JSON.stringify([parking?.id]));
    const location = await run(show({ panel: "booking-locations", where: [{ facet: "kind", op: "is", value: "business" }] }));
    check("location kind selects the branch", JSON.stringify(elementEvents(location.events)[0]?.ids) === JSON.stringify([loc.id]));
    const anded = await run(show({ panel: "appointments", where: [{ facet: "weekday", op: "is", value: "friday" }, { facet: "customer", op: "contains", value: "blake" }] }));
    check("filters AND together (friday + blake = nothing)", elementEvents(anded.events).length === 0);

    // ── 3. Explicit ids, in index order, unknown dropped, limit honoured ──
    const byIds = await run(show({ panel: "appointments", ids: [sat.id, "nope", fri.id] }));
    check("ids select exactly those, in index order, unknown dropped", JSON.stringify(elementEvents(byIds.events)[0]?.ids) === JSON.stringify([fri.id, sat.id]), JSON.stringify(elementEvents(byIds.events)));
    const limited = await run(show({ panel: "booking-services", limit: 1 }));
    check("limit caps the selection", JSON.stringify(elementEvents(limited.events)[0]?.ids) === JSON.stringify([basic]));

    // ── 4. Nothing matches / bad panels: no event, loop terminates, tool told why ──
    const sunday = await run(show({ panel: "appointments", where: [{ facet: "weekday", op: "is", value: "sunday" }] }));
    check("no match yields no elements event", elementEvents(sunday.events).length === 0);
    check("no match tells the model nothing matched", sunday.seen.results.some((r) => /no .*match/i.test(r)), sunday.seen.results.join(" | "));
    check("no match still terminates", sunday.seen.calls === 2);
    const noPanel = await run(show({ panel: "sparkle" }));
    check("unknown panel yields no event", elementEvents(noPanel.events).length === 0 && noPanel.seen.calls === 2);
    const noElements = await run(show({ panel: "theme" }));
    check("a panel without elements yields no event", elementEvents(noElements.events).length === 0 && noElements.seen.calls === 2);

    // ── 5. show_panel unchanged ──
    const full = await run([{ tools: [{ name: "show_panel", input: { key: "appointments" } }] }, { text: "ok" }]);
    check("show_panel still reveals the full appointments panel", full.events.some((e) => e.t === "panel" && e.v === "appointments"));

    // ── 6. The prompt: TODAY and the element index ──
    const system = friday.seen.system[0] ?? "";
    const todayNY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const weekdayNY = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" }).toLowerCase();
    check("system prompt states today's date in the business zone", system.includes(todayNY) && system.toLowerCase().includes(weekdayNY), `${todayNY} ${weekdayNY}`);
    check("system prompt names the timezone", system.includes("America/New_York"));
    check("system prompt has an ELEMENTS section", /ELEMENTS/.test(system));
    for (const [what, id] of [["friday booking", fri.id], ["saturday booking", sat.id], ["cheapest service", basic], ["disabled provider", ben.id], ["location", loc.id], ["rule", rule?.id ?? ""], ["preset", parking?.id ?? ""]]) {
      check(`index lists the ${what} by id`, system.includes(id));
    }
    check("index carries the friday facets", /weekday=friday/.test(system) && /date=2026-09-25/.test(system) && /time=13:00/.test(system));
    check("index carries the customer facet", /customer=christopher mauri/.test(system));
    check("index carries service prices as numbers", /price=35/.test(system) && /price=80/.test(system));

    // ── 7. Pure selector contract ──
    if (elements) {
      const { selectElements } = elements;
      const idx = [
        { id: "a", panel: "p", label: "A", facets: { date: "2026-09-25", n: 5, s: "Hello World" } },
        { id: "b", panel: "p", label: "B", facets: { date: "2026-09-26", n: 10, s: "other" } },
        { id: "c", panel: "q", label: "C", facets: { date: "2026-09-27", n: 1, s: "hello" } },
      ];
      const ids = (sel: Parameters<typeof selectElements>[1]) => selectElements(idx, sel).map((e) => e.id).join(",");
      check("selectElements: panel scopes", ids({ panel: "p" }) === "a,b");
      check("selectElements: is is case-insensitive", ids({ panel: "q", where: [{ facet: "s", op: "is", value: "HELLO" }] }) === "c");
      check("selectElements: contains is case-insensitive", ids({ panel: "p", where: [{ facet: "s", op: "contains", value: "world" }] }) === "a");
      check("selectElements: before/after on dates", ids({ panel: "p", where: [{ facet: "date", op: "before", value: "2026-09-26" }] }) === "a" && ids({ panel: "p", where: [{ facet: "date", op: "after", value: "2026-09-25" }] }) === "b");
      check("selectElements: gte/lte on numbers", ids({ panel: "p", where: [{ facet: "n", op: "gte", value: "10" }] }) === "b" && ids({ panel: "p", where: [{ facet: "n", op: "lte", value: "5" }] }) === "a");
      check("selectElements: unknown facet matches nothing", ids({ panel: "p", where: [{ facet: "zz", op: "is", value: "x" }] }) === "");
      check("selectElements: ids + where intersect", ids({ panel: "p", ids: ["b", "a"], where: [{ facet: "n", op: "gte", value: "6" }] }) === "b");
      check("selectElements: limit", ids({ panel: "p", limit: 1 }) === "a");
    }

    // ── 8. Panel side: nodes for every indexed element, built from the same rows ──
    if (load && nodes) {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { AppointmentsPanel } = await import("../../../app/admin/CalendarPanel");
      const loaded = await load.loadElementIndex(user.id);
      const built = await nodes.buildElementNodesForUser(user.id, { cancelAction: async () => {}, confirmAction: async () => {}, deleteOrderAction: async () => {} });
      check("panel-side index equals brain-side index", JSON.stringify(built.index) === JSON.stringify(loaded.index), JSON.stringify(built.index).slice(0, 300));
      const missing = loaded.index.filter((e) => !built.nodes[e.panel]?.[e.id]);
      check("a node exists for every indexed element", missing.length === 0, missing.map((m) => `${m.panel}/${m.id}`).join(","));
      const friHtml = renderToStaticMarkup(h("div", null, built.nodes.appointments?.[fri.id]));
      check("friday node renders the customer", friHtml.includes("Christopher Mauri"));
      check("friday node has a Cancel control", /Cancel/.test(friHtml));
      check("friday node does not render saturday's customer", !friHtml.includes("Blake"));
      // The same markup the full panel draws: the element's card is a substring
      // of the panel's markup (no forked row component).
      const rows = built.appointmentRows;
      const panelHtml = renderToStaticMarkup(
        h(AppointmentsPanel, { rows, fieldLabels: built.fieldLabels, cancelAction: async () => {}, confirmAction: async () => {}, bookingEnabled: true }),
      );
      // React appends its form-action bootstrap <script> after the last form it
      // rendered; that trailer is placement, not markup, so it is stripped.
      const noScript = (html: string) => html.replace(/<script>[\s\S]*?<\/script>/g, "");
      const cardHtml = noScript(renderToStaticMarkup(built.nodes.appointments?.[fri.id] as never));
      check("element card markup is the panel's own row markup", noScript(panelHtml).includes(cardHtml), `${cardHtml.slice(0, 120)}…`);
      const svcHtml = renderToStaticMarkup(h("div", null, built.nodes["booking-services"]?.[basic]));
      check("service node renders the service name and price", svcHtml.includes("Basic Manicure") && svcHtml.includes("$35"));
      const ruleHtml = renderToStaticMarkup(h("div", null, built.nodes.rules?.[rule?.id ?? ""]));
      check("rule node renders its text in an editable form", ruleHtml.includes("Never share my phone number") && /<form/.test(ruleHtml));
    }

    // ── 9. The chat client's element item: ids → the panel's own nodes ──
    if (nodes) {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { ElementList } = await import("../../../app/admin/chat/AdminChat");
      const built = await nodes.buildElementNodesForUser(user.id, { cancelAction: async () => {}, confirmAction: async () => {}, deleteOrderAction: async () => {} });
      const html = renderToStaticMarkup(
        h(ElementList, { reveal: { panel: "appointments", ids: [fri.id, "nope"], title: "t" }, elements: built.nodes }),
      );
      check("ElementList renders the revealed booking's card", html.includes("Christopher Mauri") && html.includes(`data-element="${fri.id}"`));
      check("ElementList skips unknown ids and other rows", !html.includes("Blake") && !html.includes("nope"));
      const gone = renderToStaticMarkup(
        h(ElementList, { reveal: { panel: "appointments", ids: ["nope"], title: "t" }, elements: built.nodes }),
      );
      check("ElementList explains when nothing is renderable", /aren(&#x27;|&apos;|')t available/.test(gone));
    }

    // ── 10. Wiring guards ──
    const chat = src("app/admin/chat/AdminChat.tsx");
    check("AdminChat handles the elements event", /obj\.t === "elements"/.test(chat) && /kind: "elements"/.test(chat));
    const page = src("app/admin/chat/page.tsx");
    check("chat page passes elements to AdminChat", /elements=\{/.test(page));
    check("agent.md documents show_elements", src("agent.md").includes("show_elements"));
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`failures: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

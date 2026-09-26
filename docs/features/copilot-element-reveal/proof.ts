/**
 * Primary proof for copilot-element-reveal (see PROOF.md).
 * Run: npx tsx docs/features/copilot-element-reveal/proof.ts
 *
 * Seeds a throwaway tenant with real rows (a live and a disabled goal, a
 * rule, two presets — one served three times), drives the admin brain's tool
 * loop with a scripted model client (the only doubled boundary), and asserts
 * the `elements` events, the index the prompt carries, the pure selector, and
 * the element nodes the panel side builds from the same rows.
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
  const { saveDirective, listDirectives } = await import("../../../lib/directives");
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
  const idsOf = (events: Ev[]) => JSON.stringify(elementEvents(events)[0]?.ids);
  const show = (input: Record<string, unknown>): Turn[] => [
    { tools: [{ name: "show_elements", input }] },
    { text: "Here you go." },
  ];

  try {
    // ── Seed: a live and a disabled goal, a rule, two presets (one served) ──
    await saveDirective(user.id, { kind: "goal", text: "Get interested visitors to leave their details.", enabled: true });
    await saveDirective(user.id, { kind: "goal", text: "Mention the loyalty card.", enabled: false });
    await saveDirective(user.id, { kind: "rule", text: "Never share my phone number.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Do you take walk-ins?", answer: "Yes, before 4pm.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Where do I park?", answer: "Behind the shop.", enabled: true });
    const walkIns = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Do you take walk-ins?" } });
    const parking = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Where do I park?" } });
    if (walkIns) await prisma.cannedAnswer.update({ where: { id: walkIns.id }, data: { hits: 3 } });
    const rules = await listDirectives(user.id, "rule");
    const goals = await listDirectives(user.id, "goal");
    const rule = rules[0];
    const liveGoal = goals.find((g) => g.enabled);
    const offGoal = goals.find((g) => !g.enabled);
    if (!rule || !liveGoal || !offGoal || !walkIns || !parking) throw new Error("seed failed");

    // ── 1. The recording's question: only the matching rule ──
    const phoneRule = await run(show({ panel: "rules", where: [{ facet: "text", op: "contains", value: "phone" }] }));
    const re = elementEvents(phoneRule.events);
    check("text filter yields exactly one elements event", re.length === 1, JSON.stringify(phoneRule.events));
    check("elements event names the rules panel", re[0]?.panel === "rules");
    check("elements event ids are exactly the phone rule", JSON.stringify(re[0]?.ids) === JSON.stringify([rule.id]), JSON.stringify(re[0]?.ids));
    check("no full panel is shown for an element reveal", !phoneRule.events.some((e) => e.t === "panel"));
    check("loop terminates after the reveal", phoneRule.seen.calls === 2, String(phoneRule.seen.calls));
    check("show_elements is offered as a tool", phoneRule.seen.toolNames.includes("show_elements"), phoneRule.seen.toolNames.join(","));

    // ── 2. Other facets and ops ──
    const unserved = await run(show({ panel: "answers", where: [{ facet: "served", op: "is", value: "0" }] }));
    check("served is 0 finds the never-served preset", idsOf(unserved.events) === JSON.stringify([parking.id]), idsOf(unserved.events));
    const served = await run(show({ panel: "answers", where: [{ facet: "served", op: "gte", value: "3" }] }));
    check("served gte 3 finds the preset served three times", idsOf(served.events) === JSON.stringify([walkIns.id]), idsOf(served.events));
    const offGoals = await run(show({ panel: "goals", where: [{ facet: "live", op: "is", value: "no" }] }));
    check("live is no selects only the disabled goal", idsOf(offGoals.events) === JSON.stringify([offGoal.id]), idsOf(offGoals.events));
    const loyalty = await run(show({ panel: "goals", where: [{ facet: "text", op: "contains", value: "LOYALTY" }] }));
    check("contains is case-insensitive", idsOf(loyalty.events) === JSON.stringify([offGoal.id]));
    const anded = await run(show({ panel: "goals", where: [{ facet: "live", op: "is", value: "yes" }, { facet: "text", op: "contains", value: "loyalty" }] }));
    check("filters AND together (live + loyalty = nothing)", elementEvents(anded.events).length === 0);

    // ── 3. Explicit ids, in index order, unknown dropped, limit honoured ──
    const allAnswers = elementEvents((await run(show({ panel: "answers" }))).events)[0]?.ids ?? [];
    check("an unfiltered selection lists every preset", allAnswers.length === 2, JSON.stringify(allAnswers));
    const byIds = await run(show({ panel: "answers", ids: [parking.id, "nope", walkIns.id] }));
    check("ids select exactly those, in index order, unknown dropped", idsOf(byIds.events) === JSON.stringify(allAnswers), idsOf(byIds.events));
    const limited = await run(show({ panel: "goals", limit: 1 }));
    check("limit caps the selection", (elementEvents(limited.events)[0]?.ids ?? []).length === 1, idsOf(limited.events));

    // ── 4. Nothing matches / bad panels: no event, loop terminates, tool told why ──
    const none = await run(show({ panel: "answers", where: [{ facet: "served", op: "gte", value: "99" }] }));
    check("no match yields no elements event", elementEvents(none.events).length === 0);
    check("no match tells the model nothing matched", none.seen.results.some((r) => /no .*match/i.test(r)), none.seen.results.join(" | "));
    check("no match still terminates", none.seen.calls === 2);
    const noPanel = await run(show({ panel: "sparkle" }));
    check("unknown panel yields no event", elementEvents(noPanel.events).length === 0 && noPanel.seen.calls === 2);
    const noElements = await run(show({ panel: "theme" }));
    check("a panel without elements yields no event", elementEvents(noElements.events).length === 0 && noElements.seen.calls === 2);

    // ── 5. show_panel unchanged ──
    const full = await run([{ tools: [{ name: "show_panel", input: { key: "goals" } }] }, { text: "ok" }]);
    check("show_panel still reveals the full goals panel", full.events.some((e) => e.t === "panel" && e.v === "goals"));

    // ── 6. The prompt: the element index ──
    const system = phoneRule.seen.system[0] ?? "";
    check("system prompt has an ELEMENTS section", /ELEMENTS/.test(system));
    for (const [what, id] of [["live goal", liveGoal.id], ["disabled goal", offGoal.id], ["rule", rule.id], ["served preset", walkIns.id], ["unserved preset", parking.id]]) {
      check(`index lists the ${what} by id`, system.includes(id));
    }
    check("index carries the live facet both ways", /live=yes/.test(system) && /live=no/.test(system));
    check("index carries served counts as numbers", /served=3/.test(system) && /served=0/.test(system));

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
      const { DirectivesPanel } = await import("../../../app/admin/DirectivesPanel");
      const loaded = await load.loadElementIndex(user.id);
      const built = await nodes.buildElementNodesForUser(user.id);
      check("panel-side index equals brain-side index", JSON.stringify(built.index) === JSON.stringify(loaded.index), JSON.stringify(built.index).slice(0, 300));
      const missing = loaded.index.filter((e) => !built.nodes[e.panel]?.[e.id]);
      check("a node exists for every indexed element", missing.length === 0, missing.map((m) => `${m.panel}/${m.id}`).join(","));
      const ruleHtml = renderToStaticMarkup(h("div", null, built.nodes.rules?.[rule.id]));
      check("rule node renders its text in an editable form", ruleHtml.includes("Never share my phone number") && /<form/.test(ruleHtml));
      check("rule node does not render the goals", !ruleHtml.includes("loyalty card"));
      // The same markup the full panel draws: the element's form is a substring
      // of the panel's markup (no forked row component).
      const panelHtml = renderToStaticMarkup(h(DirectivesPanel, { kind: "rule", rows: rules }));
      // React appends its form-action bootstrap <script> after the last form it
      // rendered; that trailer is placement, not markup, so it is stripped.
      const noScript = (html: string) => html.replace(/<script>[\s\S]*?<\/script>/g, "");
      const rowHtml = noScript(renderToStaticMarkup(built.nodes.rules?.[rule.id] as never));
      check("element markup is the panel's own row markup", noScript(panelHtml).includes(rowHtml), `${rowHtml.slice(0, 120)}…`);
      const presetHtml = renderToStaticMarkup(h("div", null, built.nodes.answers?.[parking.id]));
      check("preset node renders its question", presetHtml.includes("Where do I park?"));
      check("preset node does not render the other preset", !presetHtml.includes("walk-ins"));
    }

    // ── 9. The chat client's element item: ids → the panel's own nodes ──
    if (nodes) {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const { ElementList } = await import("../../../app/admin/chat/AdminChat");
      const built = await nodes.buildElementNodesForUser(user.id);
      const html = renderToStaticMarkup(
        h(ElementList, { reveal: { panel: "rules", ids: [rule.id, "nope"], title: "t" }, elements: built.nodes }),
      );
      check("ElementList renders the revealed rule's form", html.includes("Never share my phone number") && html.includes(`data-element="${rule.id}"`));
      check("ElementList skips unknown ids and other rows", !html.includes("loyalty card") && !html.includes("nope"));
      const gone = renderToStaticMarkup(
        h(ElementList, { reveal: { panel: "rules", ids: ["nope"], title: "t" }, elements: built.nodes }),
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

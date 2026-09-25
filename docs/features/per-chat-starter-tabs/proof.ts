/**
 * Primary proof for per-chat-starter-tabs (see PROOF.md).
 * Run: npx tsx docs/features/per-chat-starter-tabs/proof.ts
 *
 * The picker is proven pure; generation, saving and the pool read run for real
 * against the database (the model is the only thing faked, through the
 * module's own injectable client); the home screen and the Presets tab are the
 * real components rendered on the server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

// The app components are compiled by Next with the automatic JSX runtime;
// tsx compiles them with the classic one, which expects `React` in scope.
(globalThis as { React?: typeof React }).React = React;

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PREFIX = "perchattabsproof";
const COMPANY = "Kestrel Ridge Bike Fitting";
const GOALS = [
  "Book a fitting session before the visitor leaves",
  "Get the visitor onto the winter tune-up waitlist",
];

/** A pool as the picker sees it: nine questions, three goals' worth, three general. */
type Opt = { q: string; label?: string; goal?: string };
const pool = (goals: string[], perGoal: number, general: number): Opt[] => {
  const out: Opt[] = [];
  for (const g of goals) for (let i = 0; i < perGoal; i++) out.push({ q: `${g} q${i}`, goal: g });
  for (let i = 0; i < general; i++) out.push({ q: `general q${i}` });
  return out;
};
const SEEDS = Array.from({ length: 40 }, (_, i) => `chat-${i}-${(i * 7919) % 101}`);

/** The model's reply: nine items, goals by number, one written out, one unknown. */
const GENERATED = [
  { label: "Fitting sessions", question: "What does a bike fitting session involve?", goal: 1 },
  { label: "Book a fitting", question: "How do I book a fitting session?", goal: 1 },
  { label: "Winter tune-up", question: "How do I get on the winter tune-up waitlist?", goal: 2 },
  { label: "Tune-up pricing", question: "What does a winter tune-up cost?", goal: "2" },
  { label: "Hours and location", question: "Where are you and when are you open?", goal: 0 },
  { label: "Bike types", question: "Do you fit road bikes and mountain bikes?", goal: "Get the visitor onto the winter tune-up waitlist" },
  { label: "Pricing", question: "How much does a fitting cost?" },
  { label: "Bring my bike", question: "Do I bring my own bike to the fitting?", goal: 9 },
  { label: "Why a fit", question: "Why should I get a professional bike fit?", goal: "sell more socks" },
];
const EXPECTED_GOALS = [GOALS[0], GOALS[0], GOALS[1], GOALS[1], "", GOALS[1], "", "", ""];

function fakeClient(reply: unknown) {
  const spy = { calls: 0, system: "", user: "" };
  const client = {
    messages: {
      async create(params: { system: string; messages: { content: string }[] }) {
        spy.calls++;
        spy.system = params.system;
        spy.user = params.messages.map((m) => m.content).join("\n");
        return { content: [{ type: "text", text: JSON.stringify(reply) }] };
      },
    },
  };
  return { client, spy };
}

/** The tab buttons inside one rendered tab row. */
function tabsIn(html: string, where: "home" | "dock") {
  const row = html.match(new RegExp(`<div[^>]*data-starter-tabs="${where}"[^>]*>(.*?)</div>`, "s"));
  if (!row) return null;
  const buttons = [...row[1].matchAll(/<button[^>]*title="([^"]*)"[^>]*>(.*?)<\/button>/gs)];
  return buttons.map((b) => ({ title: b[1], text: b[2] }));
}

async function main() {
  const { pickStarters, hashSeed } = await import("../../../lib/starterPick");
  const { CHIP_COUNT } = await import("../../../lib/chipLabel");

  // ── 1. The picker, offline ──────────────────────────────────────────────
  const nine = pool(["A", "B", "C"], 2, 3);
  check("a pool no larger than the row comes back whole, in order",
    pickStarters(nine.slice(0, 3), "any").map((o) => o.q).join("|") === nine.slice(0, 3).map((o) => o.q).join("|"));
  check("count 0 picks nothing", pickStarters(nine, "any", 0).length === 0);
  check("hashSeed is stable", hashSeed("chat-1") === hashSeed("chat-1") && hashSeed("chat-1") !== hashSeed("chat-2"));
  const once = pickStarters(nine, "chat-1").map((o) => o.q);
  const again = pickStarters(nine, "chat-1").map((o) => o.q);
  check("the same chat id always picks the same tabs", once.join("|") === again.join("|") && once.length === CHIP_COUNT);
  const sets = new Set(SEEDS.map((s) => pickStarters(nine, s).map((o) => o.q).join("|")));
  const seen = new Set(SEEDS.flatMap((s) => pickStarters(nine, s).map((o) => o.q)));
  check("different chats get different tabs", sets.size > 1, `distinct sets=${sets.size}`);
  check("over many chats every goal's question is shown", ["A", "B", "C"].every((g) => [0, 1].every((i) => seen.has(`${g} q${i}`))),
    JSON.stringify([...seen]));
  check("three goals: every chat's three tabs come from three distinct goals, none general",
    SEEDS.every((s) => {
      const picked = pickStarters(nine, s);
      return picked.length === 3 && new Set(picked.map((o) => o.goal)).size === 3 && picked.every((o) => o.goal);
    }));

  const two = pool(["A", "B"], 2, 3);
  const leads = new Set(SEEDS.map((s) => pickStarters(two, s)[0].goal));
  check("two goals: one question from each goal, then one general",
    SEEDS.every((s) => {
      const picked = pickStarters(two, s);
      const goals = picked.map((o) => o.goal ?? "");
      return picked.length === 3 && goals.filter((g) => g === "A").length === 1 &&
        goals.filter((g) => g === "B").length === 1 && goals[2] === "";
    }));
  check("which goal leads rotates from chat to chat", leads.has("A") && leads.has("B"), JSON.stringify([...leads]));
  check("one goal: that goal gets two tabs, the general pool one",
    SEEDS.every((s) => {
      const goals = pickStarters(pool(["A"], 3, 3), s).map((o) => o.goal ?? "");
      return goals.filter((g) => g === "A").length === 2 && goals.filter((g) => g === "").length === 1;
    }));
  const plain = pool([], 0, 6);
  const plainSets = new Set(SEEDS.map((s) => pickStarters(plain, s).map((o) => o.q).join("|")));
  check("no goals: the three rotate over the general pool",
    plainSets.size > 1 && SEEDS.every((s) => pickStarters(plain, s).length === 3), `sets=${plainSets.size}`);
  const messy = [{ q: " " }, { q: "Same?" }, { q: "same?" }, { q: "Other" }, { q: "Third" }, { q: "Fourth" }];
  const cleaned = pickStarters(messy, "chat-3");
  check("blank and repeated questions are dropped before picking",
    cleaned.length === 3 && new Set(cleaned.map((o) => o.q.toLowerCase())).size === 3 && !cleaned.some((o) => !o.q.trim()),
    JSON.stringify(cleaned));

  // ── 2. Generation writes the goal-tagged pool ───────────────────────────
  const { prisma } = await import("../../../lib/db");
  const { personalizeStarterQuestions, starterChipsFor, STARTER_POOL_COUNT } = await import(
    "../../../lib/starterQuestions"
  );
  const { saveCannedAnswer, normalizeQuestion } = await import("../../../lib/canned");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Chat = (await import("../../../app/Chat")).default as React.ComponentType<Record<string, unknown>>;
  const { AnswersPanel } = await import("../../../app/admin/AnswersPanel");

  const baseUsers = await prisma.user.count();
  const baseCanned = await prisma.cannedAnswer.count();

  async function makeUser(tag: string) {
    const id = `${PREFIX}-${tag}`;
    await prisma.user.create({
      data: { id, email: `${id}@example.test`, name: `Proof ${tag}`, slug: id, passwordHash: "x" },
    });
    await prisma.profile.create({ data: { userId: id, company_name: COMPANY } });
    await prisma.agentDirective.createMany({
      data: GOALS.map((text, order) => ({ userId: id, kind: "goal", text, enabled: true, order })),
    });
    return id;
  }
  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    const owner = await makeUser("owner");
    const gen = fakeClient(GENERATED);
    const written = await personalizeStarterQuestions(owner, { client: gen.client });
    const rows = await prisma.cannedAnswer.findMany({ where: { userId: owner }, orderBy: { order: "asc" } });
    check("nine offered items become nine rows in one call",
      written === 9 && rows.length === 9 && gen.spy.calls === 1 && STARTER_POOL_COUNT === 9,
      `written=${written} rows=${rows.length}`);
    check("the brief asks for the pool with a goal per item",
      new RegExp(`exactly ${STARTER_POOL_COUNT} questions`).test(gen.spy.system) && /"goal": 0/.test(gen.spy.system));
    check("the goals are shown numbered, as the reply refers to them",
      gen.spy.user.includes(`1. ${GOALS[0]}`) && gen.spy.user.includes(`2. ${GOALS[1]}`), gen.spy.user);
    check("a goal number, a numeric string or the goal's text resolve to the goal; 0, unknown or missing to general",
      rows.every((r, i) => r.goal === EXPECTED_GOALS[i]), JSON.stringify(rows.map((r) => r.goal)));

    const chips = await starterChipsFor(owner);
    check("the pool read returns every live row with its goal, in order",
      chips.length === 9 && chips.every((c, i) => c.q === GENERATED[i].question && c.goal === EXPECTED_GOALS[i]),
      JSON.stringify(chips));

    // ── 3. The owner's goal on a row, and the Presets tab ───────────────────
    const seventh = rows[6];
    await saveCannedAnswer(owner, {
      id: seventh.id,
      question: seventh.question,
      label: seventh.label,
      goal: `  ${GOALS[0]}  `,
      answer: "A fitting starts at $150.",
      enabled: true,
      order: seventh.order,
    });
    const saved = await prisma.cannedAnswer.findUniqueOrThrow({ where: { id: seventh.id } });
    check("a saved goal is stored trimmed", saved.goal === GOALS[0], saved.goal);
    const panelRows = (await prisma.cannedAnswer.findMany({ where: { userId: owner }, orderBy: { order: "asc" } }))
      .map((r) => ({ ...r, goal: r.goal }));
    const panel = renderToStaticMarkup(React.createElement(AnswersPanel, { rows: panelRows, goals: GOALS }));
    check("the Presets tab offers each goal in a Goal select and explains the pool",
      /<select[^>]*name="goal"/.test(panel) && GOALS.every((g) => panel.includes(g)) &&
        /different chats open on/.test(panel) && !/tab 1 of/.test(panel));
    check("a row's own goal is selected", new RegExp(`<option[^>]*selected[^>]*value="${GOALS[0]}"|<option[^>]*value="${GOALS[0]}"[^>]*selected`).test(panel));

    // ── 4. The rendered home screen: three tabs, varying by chat id ─────────
    const starters = chips.map((c) => ({ q: c.q, label: c.label, goal: c.goal }));
    const render = (initialChatId: string) =>
      renderToStaticMarkup(React.createElement(Chat, { name: COMPANY, tagline: "", starters, initialChatId, slug: "x" }));
    const rendered = SEEDS.slice(0, 8).map((id) => tabsIn(render(id), "home"));
    check("each chat's home screen shows exactly three tabs",
      rendered.every((t) => t?.length === CHIP_COUNT), JSON.stringify(rendered.map((t) => t?.length)));
    check("each tab is a whole question from the pool with its short label",
      rendered.every((t) => t!.every((b) => starters.some((s) => s.q === b.title && s.label === b.text))));
    check("different chat ids show different tabs",
      new Set(rendered.map((t) => t!.map((b) => b.title).join("|"))).size > 1);
    check("every chat opens with one tab per goal before any general question",
      rendered.every((t) => {
        const goals = t!.map((b) => starters.find((s) => s.q === b.title)?.goal);
        return goals[0] && goals[1] && goals[0] !== goals[1] && goals[2] === "";
      }), JSON.stringify(rendered.map((t) => t!.map((b) => starters.find((s) => s.q === b.title)?.goal))));
    check("the same chat id renders the same tabs twice — server and client agree",
      render("chat-x") === render("chat-x"));
    // The dock row only renders once a message exists, which a static render
    // cannot reach; both rows read the same `tabs` in app/Chat.tsx.
    check("before a message there is no dock row, only the home row",
      tabsIn(render("chat-x"), "dock") === null && tabsIn(render("chat-x"), "home")!.length === CHIP_COUNT);

    const page = readFileSync(path.join(root, "app/a/[slug]/page.tsx"), "utf8");
    check("the public page mints the first chat id on the server",
      /initialChatId=\{randomUUID\(\)\}/.test(page) && /from "node:crypto"/.test(page));
  } finally {
    await cleanup();
  }

  check("users cleaned up", (await prisma.user.count()) === baseUsers);
  check("canned answers cleaned up", (await prisma.cannedAnswer.count()) === baseCanned);

  await prisma.$disconnect();
  if (failures) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

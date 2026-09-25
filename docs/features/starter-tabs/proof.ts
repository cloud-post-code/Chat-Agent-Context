/**
 * Primary proof for starter-tabs (see PROOF.md).
 * Run: npx tsx docs/features/starter-tabs/proof.ts
 *
 * Generation, saving and reading run for real against the database (the model
 * is the only thing faked, through the module's own injectable client), and
 * the home screen is the real app/Chat.tsx rendered on the server.
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PREFIX = "startertabsproof";
const COMPANY = "Gullwing Harbor Sailmakers";

// More than three, with one label far too long, so the caps have work to do.
const GENERATED = [
  { label: "Sail repair services", question: "What kinds of sails do you repair?" },
  { label: "Quotes and pricing for every job", question: "Can I get a quote before committing?" },
  { label: "Loft hours", question: "Where is your loft and when are you open?" },
  { label: "Turnaround", question: "How long does a typical sail repair take?" },
  { label: "Racing sails", question: "Do you work on racing sails or just cruising sails?" },
];

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

function fakeClient(reply: unknown) {
  const spy = { calls: 0, system: "" };
  const client = {
    messages: {
      async create(params: { system: string }) {
        spy.calls++;
        spy.system = params.system;
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
  return { open: row[0], buttons: buttons.map((b) => ({ title: b[1], text: b[2] })) };
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { CHIP_COUNT, CHIP_WORDS, chipLabel, clampLabel, deriveLabel } = await import(
    "../../../lib/chipLabel"
  );
  const { personalizeStarterQuestions, starterChipsFor, STARTER_POOL_COUNT } = await import(
    "../../../lib/starterQuestions"
  );
  const { pickStarters } = await import("../../../lib/starterPick");
  const { saveCannedAnswer, normalizeQuestion } = await import("../../../lib/canned");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Chat = (await import("../../../app/Chat")).default as React.ComponentType<
    Record<string, unknown>
  >;

  const baseUsers = await prisma.user.count();
  const baseCanned = await prisma.cannedAnswer.count();

  async function makeUser(tag: string) {
    const id = `${PREFIX}-${tag}`;
    await prisma.user.create({
      data: { id, email: `${id}@example.test`, name: `Proof ${tag}`, slug: id, passwordHash: "x" },
    });
    await prisma.profile.create({ data: { userId: id, company_name: COMPANY } });
    return id;
  }
  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    // ── 1. Labels: three words, written beats derived, no cut-off sentences ──
    check("three tabs, three words", CHIP_COUNT === 3 && CHIP_WORDS === 3);
    const derived: [string, string][] = [
      ["What nail services do you offer?", "Nail services"],
      ["How can I book an appointment with you?", "Book an appointment"],
      ["What are your hours and location?", "Hours and location"],
      ["Do you have any current coupons or special offers?", "Current coupons"],
    ];
    for (const [q, want] of derived) {
      check(`derives "${want}"`, deriveLabel(q) === want, `got="${deriveLabel(q)}"`);
    }
    check(
      "a written label wins, clamped to three words",
      chipLabel({ label: "Book a visit right now", question: derived[0][0] }) === "Book a visit",
    );
    check(
      "a clamp never leaves a connector hanging",
      clampLabel("Services, pricing & quotes") === "Services pricing",
      clampLabel("Services, pricing & quotes"),
    );
    check("a label someone wrote may end on a pronoun", clampLabel("About us") === "About us");

    // ── 2. Generation writes three labelled questions ───────────────────────
    const owner = await makeUser("owner");
    const gen = fakeClient(GENERATED);
    const written = await personalizeStarterQuestions(owner, { client: gen.client });
    const rows = await prisma.cannedAnswer.findMany({
      where: { userId: owner },
      orderBy: { order: "asc" },
    });
    // Generation now writes a pool (docs/features/per-chat-starter-tabs): all
    // five are kept, and the page picks three of them per chat.
    check(
      "five generated items become five rows of the pool",
      written === 5 && rows.length === 5 && gen.spy.calls === 1 && STARTER_POOL_COUNT >= 5,
      `written=${written} rows=${rows.length}`,
    );
    check(
      "rows keep the whole question",
      rows.every((r, i) => r.question === GENERATED[i].question),
    );
    check(
      "labels are stored, clamped to three words",
      rows[0].label === "Sail repair services" &&
        rows[1].label === "Quotes and pricing" &&
        rows[2].label === "Loft hours",
      JSON.stringify(rows.map((r) => r.label)),
    );
    check(
      "the brief asks for a labelled pool of questions and three tabs",
      new RegExp(`exactly ${STARTER_POOL_COUNT} questions`, "i").test(gen.spy.system) &&
        /row of 3 small tabs/.test(gen.spy.system) &&
        /"label"/.test(gen.spy.system),
    );

    // A reply of bare strings (the old shape) still yields three usable rows.
    const plain = await makeUser("plain");
    await personalizeStarterQuestions(plain, {
      client: fakeClient(GENERATED.map((g) => g.question)).client,
    });
    const plainChips = await starterChipsFor(plain);
    check(
      "a bare-string reply writes rows whose tabs derive their labels",
      plainChips.length === 5 && plainChips.every((c) => c.label && wordCount(c.label) <= 3),
      JSON.stringify(plainChips),
    );

    // ── 3. The page's pool: every enabled row in order, short labels ────────
    const crowded = await makeUser("crowded");
    const long = [
      "What safety and cleanliness standards do you follow?",
      "What nail services do you offer?",
      "How can I book an appointment with you?",
      "What are your hours and location?",
      "Do you have any current coupons or special offers?",
    ];
    await prisma.cannedAnswer.createMany({
      data: long.map((q, i) => ({
        userId: crowded,
        question: q,
        matchKey: normalizeQuestion(q),
        order: i,
        enabled: i !== 0, // the first row is off: it must not take a tab
      })),
    });
    const chips = await starterChipsFor(crowded);
    check(
      "five live-or-not rows give the four enabled rows as the pool, in order",
      chips.length === 4 && chips.every((c, i) => c.q === long[i + 1]),
      JSON.stringify(chips.map((c) => c.q)),
    );
    check(
      "every chip label is three words at most",
      chips.every((c) => wordCount(c.label) >= 1 && wordCount(c.label) <= 3),
      JSON.stringify(chips.map((c) => c.label)),
    );

    // ── 4. The Presets form clamps what the owner types ─────────────────────
    const first = await prisma.cannedAnswer.findFirstOrThrow({
      where: { userId: crowded, question: long[1] },
    });
    await saveCannedAnswer(crowded, {
      id: first.id,
      question: long[1],
      label: "Manicures, pedicures and much more",
      answer: "",
      enabled: true,
      order: first.order,
    });
    const saved = await prisma.cannedAnswer.findUniqueOrThrow({ where: { id: first.id } });
    check("a saved label is clamped", saved.label === "Manicures pedicures", saved.label);
    check(
      "the page shows the owner's label",
      (await starterChipsFor(crowded))[0]?.label === "Manicures pedicures",
    );

    // ── 5. The rendered home screen ────────────────────────────────────────
    // Handed all five whole questions with no labels — the worst a caller can do.
    // The chat id decides which three of the five this chat shows
    // (docs/features/per-chat-starter-tabs); the layout rules hold for any.
    const chatId = "startertabsproof-chat";
    const expected = pickStarters(long.map((q) => ({ q })), chatId).map((s) => s.q);
    const html = renderToStaticMarkup(
      React.createElement(Chat, {
        name: COMPANY,
        tagline: "",
        starters: long.map((q) => ({ q })),
        initialChatId: chatId,
        slug: "x",
      }),
    );
    const home = tabsIn(html, "home");
    check("the home screen renders one tab row", !!home);
    check(
      "exactly three tabs",
      home?.buttons.length === 3,
      `buttons=${home?.buttons.length}`,
    );
    check(
      "the row is a three-column grid, so it cannot wrap",
      !!home && /display:grid/.test(home.open) && /repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(home.open),
      home?.open,
    );
    check(
      "each tab says three words at most",
      !!home && home.buttons.every((b) => wordCount(b.text) >= 1 && wordCount(b.text) <= 3),
      JSON.stringify(home?.buttons.map((b) => b.text)),
    );
    check(
      "each tab's title is the whole question it sends — this chat's pick",
      !!home && expected.length === 3 && home.buttons.every((b, i) => b.title === expected[i]),
      JSON.stringify({ shown: home?.buttons.map((b) => b.title), expected }),
    );
    check(
      "no whole question is printed on a tab",
      !!home && home.buttons.every((b) => !long.includes(b.text)),
    );

    const bare = renderToStaticMarkup(
      React.createElement(Chat, { name: COMPANY, tagline: "", starters: [], slug: "x" }),
    );
    check("no questions renders no tab row", !bare.includes("data-starter-tabs"));
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

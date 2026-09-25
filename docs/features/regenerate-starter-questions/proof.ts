/**
 * Primary proof for regenerate-starter-questions (see PROOF.md).
 * Run: npx tsx docs/features/regenerate-starter-questions/proof.ts
 *
 * The Anthropic client is doubled at the outermost provider boundary ONLY —
 * the keep/replace guard, dedup, persistence, and the AnswersPanel render all
 * run for real. Grounding is read off the prompt the double received, so a
 * hardcoded question list cannot pass.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

// The admin components are compiled by Next with the automatic JSX runtime;
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

const PREFIX = "regenproof";
const COMPANY = "Foxglove Fen Apiaries";
const GOAL = "Get the visitor onto the honey subscription waitlist";
const KEPT_Q = "Do you ship honey nationwide?";
const KEPT_A = "We ship anywhere in the country, twice a week.";
const KEPT_DISABLED_Q = "Can I visit the fen?";
const GENERATED = [
  "What honey varieties do you produce?",
  "do you ship honey nationwide", // duplicate of a kept row — must be dropped
  "How do I join the subscription waitlist?",
  "Where can I buy your honey locally?",
];

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

function requestText(params?: CreateParams): string {
  const system = !params?.system
    ? ""
    : typeof params.system === "string"
      ? params.system
      : JSON.stringify(params.system);
  return system + JSON.stringify(params?.messages ?? []);
}

function fakeClient(questions: string[]) {
  const spy = { calls: 0, params: [] as CreateParams[] };
  const client = {
    messages: {
      async create(params: CreateParams) {
        spy.calls++;
        spy.params.push(params);
        return { content: [{ type: "text", text: JSON.stringify(questions) }] };
      },
    },
  };
  return { client, spy };
}

function brokenClient() {
  const spy = { calls: 0 };
  const client = {
    messages: {
      async create() {
        spy.calls++;
        throw new Error("provider unavailable");
      },
    },
  };
  return { client, spy };
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { normalizeQuestion } = await import("../../../lib/canned");
  const { starterQuestions } = await import("../../../lib/theme");
  const { regenerateStarterQuestions } = await import("../../../lib/starterQuestions");

  const baseUsers = await prisma.user.count();
  const baseCanned = await prisma.cannedAnswer.count();

  /**
   * The blank placeholder rows a fresh account used to arrive with. Signup no
   * longer creates them (docs/features/remove-default-starter-questions), so
   * the fixture writes them here — regenerate must still replace exactly this
   * kind of untouched row.
   */
  async function seedRows(userId: string) {
    await prisma.cannedAnswer.createMany({
      data: starterQuestions.map((s, i) => ({
        userId,
        question: s.q,
        matchKey: normalizeQuestion(s.q),
        order: i,
      })),
    });
  }

  async function makeUser(tag: string) {
    const id = `${PREFIX}-${tag}`;
    await prisma.user.create({
      data: {
        id,
        email: `${id}@example.test`,
        name: `Proof ${tag}`,
        slug: id,
        passwordHash: "x",
      },
    });
    await prisma.profile.create({ data: { userId: id, company_name: COMPANY } });
    await prisma.agentDirective.create({
      data: { userId: id, kind: "goal", text: GOAL, enabled: true },
    });
    return id;
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    // ── Mixed rows: two owner-authored (one disabled), plus generic seeds ──
    const mixed = await makeUser("mixed");
    await seedRows(mixed);
    const kept = await prisma.cannedAnswer.create({
      data: {
        userId: mixed,
        question: KEPT_Q,
        matchKey: normalizeQuestion(KEPT_Q),
        answer: KEPT_A,
        enabled: true,
        order: 0,
      },
    });
    const keptDisabled = await prisma.cannedAnswer.create({
      data: {
        userId: mixed,
        question: KEPT_DISABLED_Q,
        matchKey: normalizeQuestion(KEPT_DISABLED_Q),
        answer: "Tours run the first Saturday of each month.",
        enabled: false,
        order: 1,
      },
    });
    // One unreviewed AI draft among the seeds — replaceable like a blank.
    const seedRow = await prisma.cannedAnswer.findFirst({
      where: { userId: mixed, answer: "" },
    });
    await prisma.cannedAnswer.update({
      where: { id: seedRow!.id },
      data: { answer: "[an unreviewed draft]", aiDraft: true, draftedAt: new Date() },
    });

    const bystander = await makeUser("bystander");
    await seedRows(bystander);

    const first = fakeClient(GENERATED);
    const written = await regenerateStarterQuestions(mixed, { client: first.client });

    const rows = await prisma.cannedAnswer.findMany({
      where: { userId: mixed },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    // Generation keeps up to STARTER_POOL_COUNT it is offered (a pool the page
    // picks each chat's tabs from — docs/features/per-chat-starter-tabs); the
    // duplicate of a kept row is dropped.
    const expectedNew = [GENERATED[0], GENERATED[2], GENERATED[3]];
    check(
      "drafts and blanks are replaced in exactly one call",
      first.spy.calls === 1 && written === expectedNew.length,
      `calls=${first.spy.calls} written=${written}`,
    );
    const req = requestText(first.spy.params[0]);
    check(
      "the call is grounded in the real profile and goals",
      req.includes(COMPANY) && req.includes(GOAL),
      `company=${req.includes(COMPANY)} goal=${req.includes(GOAL)}`,
    );

    const keptAfter = rows.find((r) => r.id === kept.id);
    const keptDisabledAfter = rows.find((r) => r.id === keptDisabled.id);
    check(
      "owner-authored rows survive byte-identical, enabled or not",
      !!keptAfter &&
        keptAfter.answer === KEPT_A &&
        keptAfter.enabled &&
        !!keptDisabledAfter &&
        !keptDisabledAfter.enabled,
      JSON.stringify(rows.map((r) => r.question)),
    );
    check(
      "a generated duplicate of a kept question is dropped",
      rows.length === 2 + expectedNew.length &&
        rows.filter((r) => r.matchKey === normalizeQuestion(KEPT_Q)).length === 1,
      `rows=${rows.length}`,
    );

    const newRows = rows.filter((r) => r.id !== kept.id && r.id !== keptDisabled.id);
    check(
      "replacements are blank, enabled, never-drafted, and follow the kept rows",
      newRows.length === expectedNew.length &&
        newRows.every(
          (r, i) =>
            r.question === expectedNew[i] &&
            r.answer === "" &&
            r.enabled &&
            r.draftedAt === null &&
            r.order > Math.max(keptAfter!.order, keptDisabledAfter!.order),
        ),
      JSON.stringify(newRows.map((r) => ({ q: r.question, o: r.order }))),
    );

    // ── Failure leaves everything untouched ───────────────────────────────
    const before = await prisma.cannedAnswer.findMany({
      where: { userId: mixed },
      orderBy: { id: "asc" },
    });
    const broken = brokenClient();
    let threw = false;
    await regenerateStarterQuestions(mixed, { client: broken.client }).catch(() => {
      threw = true;
    });
    const after = await prisma.cannedAnswer.findMany({
      where: { userId: mixed },
      orderBy: { id: "asc" },
    });
    check(
      "a model failure never propagates and changes nothing",
      !threw && broken.spy.calls === 1 && JSON.stringify(after) === JSON.stringify(before),
      `threw=${threw} calls=${broken.spy.calls}`,
    );

    // ── Tenant isolation ──────────────────────────────────────────────────
    const other = await prisma.cannedAnswer.findMany({ where: { userId: bystander } });
    check(
      "another tenant's rows were never touched",
      other.length === 5 && other.every((r) => r.answer === ""),
      `rows=${other.length}`,
    );

    // ── The tab renders the control ───────────────────────────────────────
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { AnswersPanel } = await import("../../../app/admin/AnswersPanel");
    const html = renderToStaticMarkup(React.createElement(AnswersPanel, { rows: [] }));
    check(
      "the Presets tab offers a tab-level regenerate control",
      /regenerate/i.test(html),
      "no regenerate control rendered",
    );
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

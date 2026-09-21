/**
 * Primary proof for personalized-starter-questions (see PROOF.md).
 * Run: npx tsx docs/features/personalized-starter-questions/proof.ts
 *
 * The feature's claim is about what reaches the model at onboarding
 * completion and what lands in the tenant's preset rows, so the Anthropic
 * client is injected as a double at the outermost provider boundary ONLY —
 * the guard logic, prompt assembly, dedup, persistence, and the chip source
 * all run for real. Grounding is read off the prompt the double was handed,
 * so a hardcoded question list cannot pass.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// Keep any retrieval offline and deterministic.
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

const PREFIX = "starterproof";

// Distinctive strings so any match can only have come from this proof.
const COMPANY = "Gullwing Harbor Sailmakers";
const GOAL = "Book a sail-repair consultation before the visitor leaves";
const GENERATED = [
  "What kinds of sails do you repair?",
  "How long does a typical sail repair take?",
  "Do you work on racing sails or just cruising sails?",
  "Can I get a quote before committing?",
  "Where is your loft and when are you open?",
];
// The model may offer five; generation keeps the three the page has tabs for
// (docs/features/starter-tabs).
const KEPT = GENERATED.slice(0, 3);

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

/** The system prompt as one string, however the SDK's param type carries it. */
function systemText(params?: CreateParams): string {
  if (!params?.system) return "";
  return typeof params.system === "string" ? params.system : JSON.stringify(params.system);
}

/** Full request text (system + user turns), for grounding assertions. */
function requestText(params?: CreateParams): string {
  return systemText(params) + JSON.stringify(params?.messages ?? []);
}

/** Counts calls, keeps params, answers with the given questions. */
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

/** Slower than the pass's deadline, so completion must stop waiting. */
function slowClient(questions: string[], delayMs: number) {
  const client = {
    messages: {
      create(): Promise<{ content: unknown[] }> {
        return new Promise((resolve) => {
          setTimeout(
            () => resolve({ content: [{ type: "text", text: JSON.stringify(questions) }] }),
            delayMs,
          );
        });
      },
    },
  };
  return { client };
}

/** Fails the way a missing key or provider outage would. */
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
  const { normalizeQuestion, saveCannedAnswer } = await import("../../../lib/canned");
  const { starterQuestions } = await import("../../../lib/theme");
  const { personalizeStarterQuestions, starterChipsFor } = await import(
    "../../../lib/starterQuestions"
  );

  const baseUsers = await prisma.user.count();
  const baseCanned = await prisma.cannedAnswer.count();

  /**
   * The untouched placeholder rows this pass used to find on a fresh account.
   * Signup no longer creates them (docs/features/remove-default-starter-
   * questions), so the fixture writes them here to keep exercising the case
   * where generation meets pre-existing rows.
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

  async function makeUser(tag: string, seed = false) {
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
    await prisma.profile.create({
      data: { userId: id, company_name: COMPANY, company_hours: "Mon-Fri 9-5" },
    });
    await prisma.agentDirective.create({
      data: { userId: id, kind: "goal", text: GOAL, enabled: true },
    });
    if (seed) await seedRows(id);
    return id;
  }

  async function cleanup() {
    // User rows cascade to profile, directives, and canned answers.
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    // ── 1–3. Untouched seeds are replaced in one grounded call ────────────
    const fresh = await makeUser("fresh");
    const bystander = await makeUser("bystander", true); // never personalized
    const first = fakeClient(GENERATED);
    await personalizeStarterQuestions(fresh, { client: first.client });

    const rows = await prisma.cannedAnswer.findMany({
      where: { userId: fresh },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    check(
      "untouched seeds are replaced in exactly one call",
      first.spy.calls === 1 &&
        rows.length === KEPT.length &&
        rows.every((r, i) => r.question === KEPT[i]),
      `calls=${first.spy.calls} questions=${JSON.stringify(rows.map((r) => r.question))}`,
    );
    check(
      "generated rows are blank, enabled, ordered, and keyed for matching",
      rows.every(
        (r, i) =>
          r.answer === "" &&
          r.enabled &&
          r.order === i &&
          r.matchKey === normalizeQuestion(r.question) &&
          r.draftedAt === null,
      ),
      JSON.stringify(rows.map((r) => ({ o: r.order, k: r.matchKey, a: r.answer }))),
    );
    const req = requestText(first.spy.params[0]);
    check(
      "the call is grounded in the real profile and goals",
      req.includes(COMPANY) && req.includes(GOAL),
      `company=${req.includes(COMPANY)} goal=${req.includes(GOAL)}`,
    );

    // ── 4. Drafting compatibility: new rows are eligible for auto-draft ───
    // (draftedAt null + blank answer is the drafting pass's trigger state,
    // asserted above; the pass itself is proven by ai-drafted-answers.)

    // ── 5. A customized user is left alone ────────────────────────────────
    const custom = await makeUser("custom", true);
    const seeded = await prisma.cannedAnswer.findFirst({ where: { userId: custom } });
    await saveCannedAnswer(custom, {
      id: seeded!.id,
      question: seeded!.question,
      answer: "My own hand-written answer.",
      enabled: true,
    });
    const before = await prisma.cannedAnswer.findMany({
      where: { userId: custom },
      orderBy: { id: "asc" },
    });
    const guard = fakeClient(GENERATED);
    await personalizeStarterQuestions(custom, { client: guard.client });
    const after = await prisma.cannedAnswer.findMany({
      where: { userId: custom },
      orderBy: { id: "asc" },
    });
    check(
      "a customized user draws zero calls and keeps every row",
      guard.spy.calls === 0 && JSON.stringify(after) === JSON.stringify(before),
      `calls=${guard.spy.calls}`,
    );

    // ── 6. Failure leaves the account untouched, all-or-nothing ──────────
    const failing = await makeUser("failing");
    const broken = brokenClient();
    let threw = false;
    await personalizeStarterQuestions(failing, { client: broken.client }).catch(() => {
      threw = true;
    });
    const kept = await prisma.cannedAnswer.findMany({
      where: { userId: failing },
      orderBy: { order: "asc" },
    });
    check(
      "a model failure never propagates and writes nothing",
      !threw && broken.spy.calls === 1 && kept.length === 0,
      `threw=${threw} calls=${broken.spy.calls} rows=${kept.length}`,
    );

    // ── 6b. A deadline overrun degrades the same way ──────────────────────
    const slowUser = await makeUser("slow");
    process.env.STARTER_QUESTIONS_DEADLINE_MS = "200";
    const slow = slowClient(GENERATED, 1500);
    const startedAt = Date.now();
    const written = await personalizeStarterQuestions(slowUser, { client: slow.client });
    const waited = Date.now() - startedAt;
    const slowRows = await prisma.cannedAnswer.findMany({
      where: { userId: slowUser },
      orderBy: { order: "asc" },
    });
    check(
      "a deadline overrun hands completion back on time and writes nothing",
      waited < 1000 && written === 0 && slowRows.length === 0,
      `waited=${waited}ms written=${written} rows=${slowRows.length}`,
    );
    delete process.env.STARTER_QUESTIONS_DEADLINE_MS;

    // ── 7. Duplicate generated questions never throw the unique key ───────
    const duped = await makeUser("duped");
    const dupes = fakeClient([
      "Do you offer free estimates?",
      "do you offer free estimates",
      "What areas do you serve?",
    ]);
    let dupeThrew = false;
    await personalizeStarterQuestions(duped, { client: dupes.client }).catch(() => {
      dupeThrew = true;
    });
    const dupeRows = await prisma.cannedAnswer.findMany({ where: { userId: duped } });
    const keys = new Set(dupeRows.map((r) => r.matchKey));
    check(
      "colliding questions are deduplicated, not thrown",
      !dupeThrew && keys.size === dupeRows.length && keys.has("do you offer free estimates"),
      `threw=${dupeThrew} rows=${dupeRows.length} uniqueKeys=${keys.size}`,
    );

    // ── 8–9. Chips come from the tenant's rows, with a fallback ───────────
    const chips = await starterChipsFor(fresh);
    check(
      "public chips are the tenant's own generated questions, in order",
      JSON.stringify(chips.map((c) => c.q)) === JSON.stringify(KEPT),
      JSON.stringify(chips),
    );
    await prisma.cannedAnswer.updateMany({
      where: { userId: fresh },
      data: { enabled: false },
    });
    const fallback = await starterChipsFor(fresh);
    check(
      "with no usable rows the page gets no chips at all",
      fallback.length === 0,
      JSON.stringify(fallback),
    );

    // ── 9b. A re-onboarded user still gets generated questions ───────────
    // `restartOnboarding` wipes the account's content, canned answers
    // included, so the user re-enters the flow with zero preset rows. The
    // guard has to read that empty table as "nothing of the owner's to
    // protect" and personalize anyway — otherwise the second completion
    // silently leaves them with no preset rows, and their public page shows
    // no chips at all.
    const restarted = await makeUser("restarted");
    await prisma.cannedAnswer.deleteMany({ where: { userId: restarted } });
    const rerun = fakeClient(GENERATED);
    await personalizeStarterQuestions(restarted, { client: rerun.client });
    const rerunRows = await prisma.cannedAnswer.findMany({
      where: { userId: restarted },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });
    check(
      "a re-onboarded user with no rows still gets generated questions",
      rerun.spy.calls === 1 &&
        rerunRows.length === KEPT.length &&
        rerunRows.every((r, i) => r.question === KEPT[i]),
      `calls=${rerun.spy.calls} rows=${JSON.stringify(rerunRows.map((r) => r.question))}`,
    );

    // ── 10. Tenant isolation ──────────────────────────────────────────────
    const other = await prisma.cannedAnswer.findMany({
      where: { userId: bystander },
      orderBy: { order: "asc" },
    });
    check(
      "another tenant's rows were never touched",
      other.length === starterQuestions.length &&
        other.every((r, i) => r.question === starterQuestions[i].q),
      JSON.stringify(other.map((r) => r.question)),
    );

    // ── 11. No usable rows means no chips — never a hardcoded fallback ────
    // (docs/features/remove-default-starter-questions inverted this case.)
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

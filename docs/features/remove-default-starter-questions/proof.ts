/**
 * Primary proof for remove-default-starter-questions (see PROOF.md).
 * Run: npx tsx docs/features/remove-default-starter-questions/proof.ts
 *
 * The Anthropic client is doubled at the outermost provider boundary ONLY —
 * provisioning, the untouched-rows guard, persistence, and the public Chat
 * render all run for real. The "no generic questions leak" assertion reads
 * the five strings out of lib/theme.ts at runtime and looks for them in the
 * rendered page, so it cannot be satisfied by a hardcoded list or a row count.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

/** The five generic questions the app used to ship for every account (retired from lib/theme.ts). */
const DEFAULT_STARTER_QUESTIONS = [
  { q: "What's your background and past experience?" },
  { q: "Tell me about yourself and how you see the world." },
  { q: "How can I connect with you?" },
  { q: "What are your recent projects?" },
  { q: "Show me a bit about your life?" },
];

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

const PREFIX = "nodefaultproof";
const COMPANY = "Foxglove Fen Apiaries";
const GOAL = "Get the visitor onto the honey subscription waitlist";
const OWNER_Q = "Do you ship honey nationwide?";
const OWNER_A = "We ship anywhere in the country, twice a week.";
const GENERATED = [
  "What honey varieties do you produce?",
  "How do I join the subscription waitlist?",
  "Where can I buy your honey locally?",
  "Do you offer tours of the apiary?",
  "What does a subscription cost?",
];
// The model may offer five; generation keeps the three the page has tabs for
// (docs/features/starter-tabs).
const KEPT = GENERATED.slice(0, 3);

type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

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
  const client = {
    messages: {
      async create() {
        throw new Error("provider unavailable");
      },
    },
  };
  return { client };
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { provisionUserDefaults } = await import("../../../lib/users");
  const theme = { starterQuestions: DEFAULT_STARTER_QUESTIONS };
  const cannedModule = await import("../../../lib/canned");
  const { normalizeQuestion } = cannedModule;
  const { starterChipsFor, personalizeStarterQuestions } = await import(
    "../../../lib/starterQuestions"
  );
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Chat = (await import("../../../app/Chat")).default;

  // The generic questions this feature removes, read at runtime.
  const GENERIC = theme.starterQuestions.map((s) => s.q);

  const baseUsers = await prisma.user.count();
  const baseCanned = await prisma.cannedAnswer.count();

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
    return id;
  }

  async function withBusiness(id: string) {
    await prisma.profile.update({
      where: { userId: id },
      data: { company_name: COMPANY },
    });
    await prisma.agentDirective.create({
      data: { userId: id, kind: "goal", text: GOAL, enabled: true },
    });
  }

  function renderPage(starters: { q: string }[]) {
    return renderToStaticMarkup(
      React.createElement(Chat, {
        name: COMPANY,
        tagline: "Sweet things, slowly made.",
        starters,
        slug: "proof",
      }),
    );
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    // ── Signup provisions no canned answers, but still seeds everything else ──
    const fresh = await makeUser("fresh");
    await provisionUserDefaults(fresh);

    const freshCanned = await prisma.cannedAnswer.count({ where: { userId: fresh } });
    check("provisioning creates zero canned answers", freshCanned === 0, `rows=${freshCanned}`);

    const [profile, persona, themeRow, sources, cards] = await Promise.all([
      prisma.profile.findUnique({ where: { userId: fresh } }),
      prisma.personaConfig.findUnique({ where: { userId: fresh } }),
      prisma.themeConfig.findUnique({ where: { userId: fresh } }),
      prisma.ingestionSource.count({ where: { userId: fresh } }),
      prisma.uiCard.count({ where: { userId: fresh } }),
    ]);
    // UI cards are no longer seeded either (onboarding-a2ui-cards): the
    // catalogs that remain provisioned are profile, persona, theme and the
    // ingestion sources.
    check(
      "the other starter catalogs are still provisioned",
      !!profile && !!persona && !!themeRow && sources > 0 && cards === 0,
      `profile=${!!profile} persona=${!!persona} theme=${!!themeRow} sources=${sources} cards=${cards}`,
    );

    // ── No rows means no chips, and no generic questions anywhere on the page ──
    const emptyChips = await starterChipsFor(fresh);
    check(
      "starterChipsFor returns [] for an account with no rows",
      Array.isArray(emptyChips) && emptyChips.length === 0,
      `chips=${JSON.stringify(emptyChips)}`,
    );

    const emptyHtml = renderPage(emptyChips);
    const leaked = GENERIC.filter((q) => emptyHtml.includes(q));
    check(
      "no generic starter question reaches the rendered public page",
      leaked.length === 0,
      `leaked=${JSON.stringify(leaked)}`,
    );
    // Chips are the only buttons the hero renders before the composer, so a
    // starter-shaped button surviving an empty list means a fallback leaked.
    const chipButtons = (emptyHtml.match(/<button/g) ?? []).length;
    const withChips = (renderPage([{ q: "Sentinel chip question?" }]).match(/<button/g) ?? []).length;
    check(
      "the page renders no chip buttons when there are no starters",
      chipButtons === withChips - 1,
      `empty=${chipButtons} withOneChip=${withChips}`,
    );

    // ── Generation writes into the now-empty table ────────────────────────
    await withBusiness(fresh);
    const { client, spy } = fakeClient(GENERATED);
    const written = await personalizeStarterQuestions(fresh, { client });
    check("generation writes into an empty table", written === KEPT.length, `written=${written}`);
    check("generation made exactly one model call", spy.calls === 1, `calls=${spy.calls}`);

    const rows = await prisma.cannedAnswer.findMany({
      where: { userId: fresh },
      orderBy: { order: "asc" },
    });
    check(
      "the stored questions are exactly the generated ones, in order",
      rows.map((r) => r.question).join("|") === KEPT.join("|"),
      rows.map((r) => r.question).join("|"),
    );

    const liveChips = await starterChipsFor(fresh);
    const liveHtml = renderPage(liveChips);
    check(
      "the public page shows exactly the generated questions",
      KEPT.every((q) => liveHtml.includes(q)) && !GENERIC.some((q) => liveHtml.includes(q)),
      `chips=${liveChips.length}`,
    );

    // ── All-disabled rows still means no chips, never the generic list ────
    await prisma.cannedAnswer.updateMany({ where: { userId: fresh }, data: { enabled: false } });
    const disabledChips = await starterChipsFor(fresh);
    check(
      "starterChipsFor returns [] when every row is disabled",
      disabledChips.length === 0,
      `chips=${JSON.stringify(disabledChips)}`,
    );

    // ── The guard still protects owner-authored rows ──────────────────────
    const owned = await makeUser("owned");
    await provisionUserDefaults(owned);
    await withBusiness(owned);
    await prisma.cannedAnswer.create({
      data: {
        userId: owned,
        question: OWNER_Q,
        matchKey: normalizeQuestion(OWNER_Q),
        answer: OWNER_A,
        enabled: true,
        order: 0,
      },
    });
    const guarded = fakeClient(GENERATED);
    const overwrote = await personalizeStarterQuestions(owned, { client: guarded.client });
    const ownedRows = await prisma.cannedAnswer.findMany({ where: { userId: owned } });
    check(
      "generation still declines to overwrite an owner-authored row",
      overwrote === 0 && ownedRows.length === 1 && ownedRows[0].answer === OWNER_A,
      `wrote=${overwrote} rows=${ownedRows.length}`,
    );

    // ── A provider failure leaves zero rows and does not throw ────────────
    const failing = await makeUser("failing");
    await provisionUserDefaults(failing);
    await withBusiness(failing);
    let threw = false;
    let failWrote = -1;
    try {
      failWrote = await personalizeStarterQuestions(failing, brokenClient());
    } catch {
      threw = true;
    }
    const failRows = await prisma.cannedAnswer.count({ where: { userId: failing } });
    check(
      "a provider failure leaves zero rows and never throws",
      !threw && failWrote === 0 && failRows === 0,
      `threw=${threw} wrote=${failWrote} rows=${failRows}`,
    );
    check(
      "the page still renders for an account whose generation failed",
      renderPage(await starterChipsFor(failing)).length > 0,
      "empty render",
    );

    // The onboarding feed must not tell the owner their page kept standard
    // questions when it has none — that message is how they learn to act.
    const jobsSrc = readFileSync(path.join(root, "lib/onboarding/jobs.ts"), "utf8");
    check(
      "the onboarding feed no longer claims standard questions were kept",
      !/Kept the standard starter questions/.test(jobsSrc),
      "stale 'Kept the standard starter questions' message still in the feed",
    );
    check(
      "the failure message points the owner at Presets",
      /Couldn't write starter questions[^"]*Presets/.test(jobsSrc),
      "no failure message directing the owner to Presets",
    );

    // ── The seed function is gone; the OG constant stays ──────────────────
    check(
      "seedStarterAnswers is no longer exported from lib/canned",
      !("seedStarterAnswers" in cannedModule),
      "still exported",
    );

    let refs = "";
    try {
      refs = execFileSync(
        "grep",
        // Source trees only: build caches and stale worktrees are not the
        // codebase and would mask a real removal.
        ["-rn", "--include=*.ts", "--include=*.tsx", "seedStarterAnswers",
         "app", "lib", "scripts", "types"],
        { cwd: root, encoding: "utf8" },
      );
    } catch {
      refs = ""; // grep exits 1 on no matches — the passing case
    }
    check(
      "no source file outside docs/ references seedStarterAnswers",
      refs.trim() === "",
      refs.trim().split("\n")[0],
    );

    check(
      "lib/theme.ts still exports starterQuestions for the OG image",
      Array.isArray(theme.starterQuestions) && theme.starterQuestions.length > 0,
      "starterQuestions missing",
    );
    check(
      "app/opengraph-image.tsx still imports starterQuestions",
      /starterQuestions/.test(
        readFileSync(path.join(root, "app/opengraph-image.tsx"), "utf8"),
      ),
      "OG image no longer uses the constant",
    );

    // ── Tenant isolation ──────────────────────────────────────────────────
    const bystander = await makeUser("bystander");
    await provisionUserDefaults(bystander);
    await prisma.cannedAnswer.create({
      data: {
        userId: bystander,
        question: OWNER_Q,
        matchKey: normalizeQuestion(OWNER_Q),
        answer: OWNER_A,
        enabled: true,
        order: 0,
      },
    });
    const bystanderChips = await starterChipsFor(bystander);
    check(
      "another tenant's rows are untouched and never cross accounts",
      bystanderChips.length === 1 && bystanderChips[0].q === OWNER_Q,
      JSON.stringify(bystanderChips),
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

/**
 * Primary proof for onboarding-goal-extraction (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-goal-extraction/proof.ts
 *
 * Drives the goals extractor with fixture Pages and a scripted llm double
 * (the only doubled boundary — the injectable seam), then asserts the real
 * AgentDirective rows it writes, the zero-goals gate, tenant isolation, and
 * that derived goals reach the real buildSystemPrompt. Throwaway users are
 * deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

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

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

// Distinctive strings so a DB match can only come from this proof.
const GOAL_1 = "Get visitors needing a Quillhaven kiln retrofit to book a site survey";
const GOAL_2 = "Surface the Harrowgate certification to procurement visitors";
const OWNER_GOAL = "Owner-authored goal: keep Marchmont clients on the retainer path";

const PAGES = [
  page(
    "https://example.invalid/services",
    "<h1>Services</h1><p>Full Harrowgate-spec retrofit of aging kilns.</p>",
  ),
  page("https://example.invalid/book", "<p>Book a site survey online.</p>"),
];

const SIGNALS = { takesAppointments: true, categories: ["services", "team"] };

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { deriveGoals, sanitizeGoals } = await import("../../../lib/onboarding/goals");
  const { saveDirective, listDirectives } = await import("../../../lib/directives");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");

  const created: string[] = [];
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `proof-onboarding-goals-${tag}@example.invalid`,
        name: `Proof Goals ${tag}`,
        slug: `proof-goals-${tag}-${Date.now()}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    created.push(u.id);
    return u;
  };

  /** The scripted seam: records the user text it was handed, returns canned JSON. */
  const scriptedLlm = (result: unknown) => {
    const seen: string[] = [];
    const llm = async (_system: string, userText: string) => {
      seen.push(userText);
      return result as Record<string, unknown>;
    };
    return { llm: llm as never, seen, count: () => seen.length };
  };
  const throwingLlm = (async () => {
    throw new Error("model exploded");
  }) as never;

  const quiet = () => {};
  const EXTRACTION = { goals: [GOAL_1, GOAL_2] };

  try {
    // ── 1. Sanitizer: junk shapes are empty, never throw ──
    for (const junk of [null, "nope", 7, {}, { goals: 7 }, { goals: [null, 3, {}] }]) {
      let threw = false;
      let out: string[] = ["unset"];
      try {
        out = sanitizeGoals(junk as unknown as Record<string, unknown>);
      } catch {
        threw = true;
      }
      check(
        `junk shape ${JSON.stringify(junk)} sanitizes empty without throwing`,
        !threw && Array.isArray(out) && out.length === 0,
        `threw=${threw} out=${JSON.stringify(out)}`,
      );
    }

    // ── 2. Sanitizer: caps, trimming, blanks ──
    const many = sanitizeGoals({ goals: Array.from({ length: 9 }, (_, i) => `Goal number ${i}`) });
    check("caps at 5 goals", many.length === 5, `${many.length}`);
    const long = sanitizeGoals({ goals: ["x".repeat(400)] });
    check("caps goal length at 200", long[0]?.length === 200, `${long[0]?.length}`);
    const messy = sanitizeGoals({ goals: ["  Book a call  ", "", "   ", "Ask for the brief"] });
    check("trims and drops blanks", messy.length === 2 && messy[0] === "Book a call", JSON.stringify(messy));

    // ── 3. Sanitizer: case-insensitive dedup, first kept ──
    const dup = sanitizeGoals({ goals: ["Book a call", "  BOOK A CALL "] });
    check("dedups case-insensitively keeping the first", dup.length === 1 && dup[0] === "Book a call", JSON.stringify(dup));

    // ── 4. Round-trip into storage on an empty tenant ──
    const userA = await mkUser("a");
    const doubleA = scriptedLlm(EXTRACTION);
    const runA = await deriveGoals(PAGES, userA.id, SIGNALS, quiet, { llm: doubleA.llm });
    check("llm seam was used", doubleA.count() === 1, `${doubleA.count()}`);
    check("report counts what was written", runA.written === 2, JSON.stringify(runA));
    check("report does not claim it kept existing goals", runA.keptExisting === false);

    const rowsA = await listDirectives(userA.id, "goal");
    check("one row per goal", rowsA.length === 2, `${rowsA.length}`);
    check("texts verbatim, in model order", rowsA[0]?.text === GOAL_1 && rowsA[1]?.text === GOAL_2, JSON.stringify(rowsA.map((r) => r.text)));
    check("rows are live", rowsA.every((r) => r.enabled === true));
    check("rows are kind goal", rowsA.every((r) => r.kind === "goal"));
    check("order ascends", rowsA[0].order < rowsA[1].order, `${rowsA[0].order},${rowsA[1].order}`);
    check(
      "no rule rows were written",
      (await prisma.agentDirective.count({ where: { userId: userA.id, kind: "rule" } })) === 0,
    );

    // ── 5. Signals reach the corpus handed to the model ──
    const sent = doubleA.seen[0] ?? "";
    check("corpus carries the page urls", PAGES.every((p) => sent.includes(p.url)), sent.slice(0, 200));
    check("corpus states the booking signal", /appointment|booking|book/i.test(sent));
    check("corpus states the knowledge categories", sent.includes("services") && sent.includes("team"));

    // ── 6. Re-run is idempotent (catalog is no longer empty) ──
    const idsBefore = rowsA.map((r) => r.id).sort().join(",");
    const runA2 = await deriveGoals(PAGES, userA.id, SIGNALS, quiet, { llm: scriptedLlm(EXTRACTION).llm });
    check("re-run writes nothing", runA2.written === 0, JSON.stringify(runA2));
    check("re-run reports it kept existing goals", runA2.keptExisting === true);
    const rowsA2 = await listDirectives(userA.id, "goal");
    check("re-run leaves the same rows", rowsA2.map((r) => r.id).sort().join(",") === idsBefore, `${rowsA2.length}`);

    // ── 7. Prompt integration: real buildSystemPrompt renders them ──
    const prompt = await buildSystemPrompt(userA.id);
    check("prompt has a GOALS heading", prompt.includes("GOALS"), prompt.slice(0, 80));
    check("prompt carries goal 1 as a bullet", prompt.includes(`- ${GOAL_1}`));
    check("prompt carries goal 2 as a bullet", prompt.includes(`- ${GOAL_2}`));

    // ── 8. Existing owner goals are never touched ──
    const userB = await mkUser("b");
    await saveDirective(userB.id, { kind: "goal", text: OWNER_GOAL, enabled: false });
    const ownerRow = (await listDirectives(userB.id, "goal"))[0];
    const runB = await deriveGoals(PAGES, userB.id, SIGNALS, quiet, { llm: scriptedLlm(EXTRACTION).llm });
    check("no seeding into a non-empty catalog", runB.written === 0, JSON.stringify(runB));
    check("reports it kept existing goals", runB.keptExisting === true);
    const rowsB = await listDirectives(userB.id, "goal");
    check("owner catalog is exactly its own row", rowsB.length === 1 && rowsB[0].id === ownerRow.id, `${rowsB.length}`);
    check(
      "owner row byte-identical",
      rowsB[0].text === OWNER_GOAL && rowsB[0].enabled === false,
      JSON.stringify(rowsB[0]),
    );
    check("a disabled owner goal still blocks seeding", rowsB.length === 1);

    // ── 9. Tenant isolation ──
    check(
      "user A's goals are not visible to user B",
      (await prisma.agentDirective.count({ where: { userId: userB.id, text: GOAL_1 } })) === 0,
    );
    check(
      "user B's goal is not visible to user A",
      (await prisma.agentDirective.count({ where: { userId: userA.id, text: OWNER_GOAL } })) === 0,
    );

    // ── 10. Empty extraction persists nothing ──
    const userC = await mkUser("c");
    const runC = await deriveGoals(PAGES, userC.id, SIGNALS, quiet, { llm: scriptedLlm({ goals: [] }).llm });
    check("empty extraction reports zero written", runC.written === 0, JSON.stringify(runC));
    check(
      "empty extraction persists no rows",
      (await prisma.agentDirective.count({ where: { userId: userC.id } })) === 0,
    );
    check("empty extraction did not claim it kept a catalog", runC.keptExisting === false);
    const promptC = await buildSystemPrompt(userC.id);
    check("no goals means no GOALS heading", !promptC.includes("GOALS"), promptC.slice(0, 80));

    // ── 11. Best-effort: a throwing model does not escape ──
    const userD = await mkUser("d");
    let escaped = false;
    let runD: { written: number; failed?: boolean } | null = null;
    try {
      runD = await deriveGoals(PAGES, userD.id, SIGNALS, quiet, { llm: throwingLlm });
    } catch {
      escaped = true;
    }
    check("a throwing model does not throw out of deriveGoals", !escaped);
    check("failed run reports zero written", runD?.written === 0, JSON.stringify(runD));
    check("failed run is reported as failed", runD?.failed === true, JSON.stringify(runD));
    check(
      "failed run persists no rows",
      (await prisma.agentDirective.count({ where: { userId: userD.id } })) === 0,
    );

    // ── 12. No pages → no model call, no rows ──
    const userE = await mkUser("e");
    const doubleE = scriptedLlm(EXTRACTION);
    const runE = await deriveGoals([], userE.id, SIGNALS, quiet, { llm: doubleE.llm });
    check("no pages means no model call", doubleE.count() === 0, `${doubleE.count()}`);
    check("no pages writes nothing", runE.written === 0, JSON.stringify(runE));
  } finally {
    // ── 13. Cleanup ──
    for (const id of created) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    const leftover = await prisma.agentDirective.count({
      where: { text: { in: [GOAL_1, GOAL_2, OWNER_GOAL] } },
    });
    check("every row the proof created is gone", leftover === 0, `${leftover}`);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

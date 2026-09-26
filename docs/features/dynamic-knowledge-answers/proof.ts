/**
 * Primary proof for dynamic-knowledge-answers (see PROOF.md).
 * Run:        npx tsx docs/features/dynamic-knowledge-answers/proof.ts
 * Live eval:  npx tsx docs/features/dynamic-knowledge-answers/proof.ts --live
 *
 * Seeds a throwaway tenant through the real onboarding write path
 * (saveKnowledgeRecord: one chunk per menu item, exactly what a crawl leaves),
 * then asks the question set in questions.ts.
 *
 * Offline (default): the real buildSystemPrompt runs per question and must
 * carry the facts the question needs; the real brain.answer() runs against a
 * model double to prove the search_knowledge tool is offered and answered.
 * --live: the real model answers every question; answers must contain the
 * expected facts and must not deflect.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUSINESS, DEFLECTIONS, OTHER_SOURCES, QUESTIONS, SERVICES } from "./questions";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

const LIVE = process.argv.includes("--live");
const PREFIX = "dynknowproof";
const SESSION_KEY = `${PREFIX}-session`;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Req = { system?: string; tools?: { name: string }[]; messages?: unknown[] };
type FakeTurn = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

/** A model double at the provider boundary that records what it was sent. */
function fakeClient(script: FakeTurn[]) {
  const spy = { requests: [] as Req[] };
  let turn = 0;
  const client = {
    messages: {
      stream(req: Req) {
        const step = script[Math.min(turn, script.length - 1)];
        turn++;
        // Snapshot: the brain keeps pushing onto the same messages array.
        spy.requests.push({ ...req, messages: [...(req.messages ?? [])] });
        const content: unknown[] = [];
        if (step.text) content.push({ type: "text", text: step.text });
        if (step.tool) {
          content.push({ type: "tool_use", id: `${PREFIX}-tu-${turn}`, ...step.tool });
        }
        return {
          async *[Symbol.asyncIterator]() {
            if (step.text) {
              yield { type: "content_block_delta", delta: { type: "text_delta", text: step.text } };
            }
          },
          finalMessage: async () => ({ content }),
        };
      },
    },
  };
  return { client, spy };
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { answer } = await import("../../../lib/brain");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");
  const { saveKnowledgeRecord } = await import("../../../lib/onboarding/knowledge");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");

  const email = `${PREFIX}@example.test`;

  async function cleanup() {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) return;
    await prisma.chatSession.deleteMany({ where: { userId: u.id } });
    await prisma.chunk.deleteMany({ where: { userId: u.id } });
    await prisma.source.deleteMany({ where: { userId: u.id } });
    await prisma.personaConfig.deleteMany({ where: { userId: u.id } });
    await prisma.themeConfig.deleteMany({ where: { userId: u.id } });
    await prisma.profile.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }

  await cleanup();
  const user = await prisma.user.create({
    data: { email, name: BUSINESS.company, slug: `${PREFIX}-slug`, passwordHash: "x" },
  });

  try {
    await prisma.profile.create({
      data: {
        userId: user.id,
        company_name: BUSINESS.company,
        company_phone_number: BUSINESS.phone,
        company_hours: BUSINESS.hours,
        company_address: BUSINESS.address,
      },
    });
    await saveKnowledgeRecord(
      user.id,
      {
        url: "https://proofline.example/service",
        title: "Services",
        kind: onboardingIngestKind("services"),
        rawText: SERVICES.join("\n\n"),
      },
      SERVICES,
    );
    for (const s of OTHER_SOURCES) {
      await saveKnowledgeRecord(
        user.id,
        { url: s.url, title: s.title, kind: "link", rawText: s.pieces.join("\n\n") },
        s.pieces,
      );
    }

    // ── 1. Every question's facts reach the model's prompt ────────────────
    console.log("\nQuestion set — facts present in the system prompt:");
    for (const t of QUESTIONS) {
      const prompt = await buildSystemPrompt(user.id, t.q);
      const missing = t.context.filter((f) => !prompt.includes(f));
      check(`"${t.q}"`, missing.length === 0, `missing ${JSON.stringify(missing)} (${t.guards})`);
    }

    // ── 2. The prompt does not drown: a narrow question stays narrow ──────
    const narrow = await buildSystemPrompt(user.id, "is there parking");
    check(
      "the knowledge block stays under its budget",
      narrow.length < 16000,
      `prompt is ${narrow.length} chars`,
    );

    // ── 3. The model can look again, in its own words ─────────────────────
    console.log("\nsearch_knowledge tool:");
    const { client, spy } = fakeClient([
      { tool: { name: "search_knowledge", input: { query: "eyebrow wax" } } },
      { text: "Eyebrow wax is $12." },
    ]);
    const out = { text: "", cards: 0 };
    for await (const ev of answer(
      { userId: user.id, message: "anything for my face?", sessionId: SESSION_KEY },
      { client },
    )) {
      if (ev.t === "text") out.text += ev.v;
      else out.cards++;
    }
    const offered = spy.requests[0]?.tools?.map((t) => t.name) ?? [];
    check("search_knowledge is offered to the model", offered.includes("search_knowledge"), `${offered}`);
    const secondTurn = JSON.stringify(spy.requests[1]?.messages ?? []);
    check(
      "a search returns the matching knowledge as the tool result",
      secondTurn.includes("Eyebrow Wax. $12"),
      secondTurn.slice(-300),
    );
    check("a search draws no card", out.cards === 0, `cards=${out.cards}`);
    check("the model's closing words still reach the visitor", out.text.includes("$12"), out.text);
    const system = spy.requests[0]?.system ?? "";
    check(
      "the prompt tells the model to search before saying it doesn't know",
      /search_knowledge/.test(system) && /before/i.test(system),
    );
    check(
      "and to share related facts instead of only deflecting",
      /closest|related/i.test(system),
    );

    // ── 4. Live: the real model answers the set ───────────────────────────
    if (LIVE) {
      console.log("\nLive answers:");
      for (const t of QUESTIONS) {
        let text = "";
        for await (const ev of answer({
          userId: user.id,
          message: t.q,
          sessionId: SESSION_KEY,
        })) {
          if (ev.t === "text") text += ev.v;
        }
        const missing = t.answer.filter((f) => !text.includes(f));
        const dodge = DEFLECTIONS.find((d) => d.test(text));
        check(
          `"${t.q}"`,
          missing.length === 0 && !dodge,
          `missing ${JSON.stringify(missing)}${dodge ? `, deflected (${dodge})` : ""} :: ` +
            text.replace(/\s+/g, " ").slice(0, 240),
        );
      }
    }
  } finally {
    await cleanup();
    const left = await prisma.user.findUnique({ where: { email } });
    check("every row the proof created is gone", left === null);
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} proof assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

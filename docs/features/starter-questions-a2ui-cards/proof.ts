/**
 * Primary proof for starter-questions-a2ui-cards (see PROOF.md).
 * Run: npx tsx docs/features/starter-questions-a2ui-cards/proof.ts
 *
 * A starter question IS a CannedAnswer row, and the brain used to serve any
 * such row by returning its prose and stopping — the model, its tool list and
 * the whole A2UI catalog were never reached. So a visitor clicking a starter
 * chip could never be shown a card, however well one fit.
 *
 * This drives the real lib/brain.answer() over seeded rows. The Anthropic
 * client is injected as a double at the outermost provider boundary ONLY —
 * retrieval, prompt assembly, the tool loop and hydrate() all run for real —
 * so "the model was reached" is proven by counting calls on the double, and
 * "the owner's wording survives" by reading the emitted text.
 */
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PREFIX = "starteruiproof";
const SESSION_KEY = `${PREFIX}-session`;

// Distinctive strings so any match can only have come from this proof.
const Q_STARTER = "What nail services does Lacquer Lane offer?";
const A_STARTER = "We do gel, acrylic and a signature chrome finish.";
const Q_WITH_CARD = "How do I reach Lacquer Lane?";
const A_WITH_CARD = "Easiest is the form right here.";
const MODEL_TEXT = "[model wandered off script]";

type FakeTurn = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

function fakeClient(script: FakeTurn[] = [{ text: MODEL_TEXT }]) {
  const spy = { calls: 0, systems: [] as string[] };
  let turn = 0;
  const client = {
    messages: {
      stream(req: { system?: string }) {
        const step = script[Math.min(turn, script.length - 1)];
        turn++;
        spy.calls++;
        if (typeof req?.system === "string") spy.systems.push(req.system);
        const content: unknown[] = [];
        if (step.text) content.push({ type: "text", text: step.text });
        if (step.tool) {
          content.push({
            type: "tool_use",
            id: `${PREFIX}-tu-${turn}`,
            name: step.tool.name,
            input: step.tool.input,
          });
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
  const { normalizeQuestion } = await import("../../../lib/canned");

  async function ask(message: string, userId: string, script?: FakeTurn[], channel = "web") {
    const { client, spy } = fakeClient(script);
    const out = { text: "", cards: [] as { type: string }[] };
    for await (const ev of answer(
      { userId, message, history: [], sessionId: SESSION_KEY, channel },
      { client },
    )) {
      if (ev.t === "text") out.text += ev.v;
      else if (ev.t === "card") out.cards.push(ev.v as { type: string });
    }
    return { ...out, calls: spy.calls, systems: spy.systems };
  }

  const email = `${PREFIX}@example.test`;

  async function cleanup() {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) return;
    await prisma.chatSession.deleteMany({ where: { visitorKey: SESSION_KEY } });
    await prisma.cannedAnswer.deleteMany({ where: { userId: u.id } });
    await prisma.uiCard.deleteMany({ where: { userId: u.id } });
    await prisma.chunk.deleteMany({ where: { userId: u.id } });
    await prisma.entity.deleteMany({ where: { userId: u.id } });
    await prisma.source.deleteMany({ where: { userId: u.id } });
    await prisma.personaConfig.deleteMany({ where: { userId: u.id } });
    await prisma.themeConfig.deleteMany({ where: { userId: u.id } });
    await prisma.profile.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }

  await cleanup();

  const user = await prisma.user.create({
    data: { email, name: "Lacquer Lane", slug: `${PREFIX}-slug`, passwordHash: "x" },
  });

  try {
    // ── Seed: one starter row with NO card, one row WITH a card ───────────
    await prisma.cannedAnswer.createMany({
      data: [
        {
          userId: user.id,
          question: Q_STARTER,
          matchKey: normalizeQuestion(Q_STARTER),
          answer: A_STARTER,
          order: 0,
        },
        {
          userId: user.id,
          question: Q_WITH_CARD,
          matchKey: normalizeQuestion(Q_WITH_CARD),
          answer: A_WITH_CARD,
          cardTool: "show_contact_form",
          order: 1,
        },
      ],
    });
    // A catalog with a contact card, so the tool is on offer at all.
    await prisma.uiCard.create({
      data: {
        userId: user.id,
        key: "contact",
        label: "Contact",
        tool: "show_contact_form",
        description: "A contact form.",
        reason: "Show when the visitor wants to get in touch.",
        note: "",
        sampleBlock: "",
        order: 0,
      },
    });

    // ── The regression this feature fixes ─────────────────────────────────
    const plain = await ask(Q_STARTER, user.id, [
      { text: A_STARTER, tool: { name: "show_contact_form", input: {} } },
    ]);
    check(
      "a starter question with no attached card reaches the model",
      plain.calls > 0,
      `calls=${plain.calls}`,
    );
    check(
      "and can therefore render an A2UI card",
      plain.cards.some((c) => c.type === "contact"),
      `cards=${JSON.stringify(plain.cards)}`,
    );
    check(
      "the owner's approved wording is handed to the model verbatim",
      plain.systems.some((s) => s.includes(A_STARTER)),
    );
    check(
      "the model is told to speak it as written, not reword it",
      plain.systems.some((s) => s.includes("APPROVED ANSWER")),
    );

    // ── What must NOT change ──────────────────────────────────────────────
    const withCard = await ask(Q_WITH_CARD, user.id);
    check(
      "a row that already carries its own card still costs zero model calls",
      withCard.calls === 0,
      `calls=${withCard.calls}`,
    );
    check(
      "and still serves the owner's exact answer",
      withCard.text.includes(A_WITH_CARD),
      withCard.text,
    );
    check(
      "and still renders that card",
      withCard.cards.some((c) => c.type === "contact"),
      `cards=${JSON.stringify(withCard.cards)}`,
    );

    // A cardless channel can't show a card, so there is nothing to gain from
    // the model — the canned row must still short-circuit it.
    const voice = await ask(Q_STARTER, user.id, undefined, "voice");
    check(
      "on a channel that cannot draw cards the row still short-circuits",
      voice.calls === 0 && voice.text.includes(A_STARTER),
      `calls=${voice.calls} text=${voice.text}`,
    );

    // The hit counter is what tells the owner a preset is earning its keep;
    // routing through the model must not stop counting it.
    const row = await prisma.cannedAnswer.findFirst({
      where: { userId: user.id, matchKey: normalizeQuestion(Q_STARTER) },
    });
    check("the canned hit is still recorded", (row?.hits ?? 0) >= 2, `hits=${row?.hits}`);
  } finally {
    await cleanup();
    const left = await prisma.user.findUnique({ where: { email } });
    check("every row the proof created is gone", left === null);
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error("Proof run errored:", e);
  process.exit(1);
});

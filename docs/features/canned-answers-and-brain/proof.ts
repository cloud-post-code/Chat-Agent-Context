/**
 * Primary proof for canned-answers-and-brain (see PROOF.md).
 * Run: npx tsx docs/features/canned-answers-and-brain/proof.ts
 *
 * Drives the real lib/brain.answer() over seeded CannedAnswer rows. The
 * Anthropic client is injected as a double at the outermost provider boundary
 * ONLY — retrieval, prompt assembly, the tool loop, hydrate() and recordTurn
 * all run for real — so "served without an API call" is proven by counting
 * calls on the double rather than by reading source.
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

const PREFIX = "cannedproof";
const SESSION_KEY = `${PREFIX}-session`;

// Distinctive strings so any match can only have come from this proof.
const Q_PLAIN = "What did Blake do at Zephyrwind?";
const A_PLAIN = "He ran the kiln at Zephyrwind for four winters.";
const Q_CARDS = "Which Harrowgate projects are live?";
const A_CARDS = "Here are the Harrowgate builds worth your time.";
const Q_OFF = "Why is the Quiet Tinkerer archetype useful?";
const A_OFF = "Because it explains the long silences before a rewrite.";
const Q_BLANK = "What does Blake think about kiln telemetry?";
const MODEL_TEXT = "[model-generated answer]";
const CLOSING_TEXT = "[model closing words]";

/** One scripted assistant turn for the Anthropic double. */
type FakeTurn = { text?: string; tool?: { name: string; input: Record<string, unknown> } };

/**
 * Minimal stand-in for the Anthropic client: supports the two things the brain
 * uses (async iteration for text deltas, finalMessage() for tool calls) and
 * counts how many times a request was made.
 */
function fakeClient(script: FakeTurn[] = [{ text: MODEL_TEXT }]) {
  const spy = { calls: 0 };
  let turn = 0;
  const client = {
    messages: {
      stream() {
        const step = script[Math.min(turn, script.length - 1)];
        turn++;
        spy.calls++;
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
  const { normalizeQuestion, saveCannedAnswer } = await import(
    "../../../lib/canned"
  );

  /** Drain the brain's event stream into plain text + cards. */
  async function ask(message: string, script?: FakeTurn[], channel = "web") {
    const { client, spy } = fakeClient(script);
    const out = { text: "", cards: [] as { type: string; items?: { id: string }[] }[] };
    for await (const ev of answer(
      { message, history: [], sessionId: SESSION_KEY, channel },
      { client },
    )) {
      if (ev.t === "text") out.text += ev.v;
      else if (ev.t === "card") out.cards.push(ev.v as { type: string; items?: { id: string }[] });
    }
    return { ...out, calls: spy.calls };
  }

  const baseCanned = await prisma.cannedAnswer.count();
  const baseProjects = await prisma.project.count();
  const baseSessions = await prisma.chatSession.count();
  const baseMessages = await prisma.chatMessage.count();

  async function cleanup() {
    await prisma.chatSession.deleteMany({ where: { visitorKey: SESSION_KEY } });
    await prisma.cannedAnswer.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.project.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }

  await cleanup();

  try {
    // ── Seed ──────────────────────────────────────────────────────────────
    await prisma.project.create({
      data: {
        id: `${PREFIX}-proj`,
        name: "Harrowgate Kiln Monitor",
        blurb: "Telemetry for a wood-fired kiln.",
        order: 0,
      },
    });
    await prisma.cannedAnswer.createMany({
      data: [
        {
          id: `${PREFIX}-plain`,
          question: Q_PLAIN,
          matchKey: normalizeQuestion(Q_PLAIN),
          answer: A_PLAIN,
          enabled: true,
        },
        {
          id: `${PREFIX}-cards`,
          question: Q_CARDS,
          matchKey: normalizeQuestion(Q_CARDS),
          answer: A_CARDS,
          cardTool: "show_projects",
          enabled: true,
        },
        {
          id: `${PREFIX}-off`,
          question: Q_OFF,
          matchKey: normalizeQuestion(Q_OFF),
          answer: A_OFF,
          enabled: false,
        },
        {
          id: `${PREFIX}-blank`,
          question: Q_BLANK,
          matchKey: normalizeQuestion(Q_BLANK),
          answer: "",
          enabled: true,
        },
      ],
    });

    // 1 ── Normalization.
    check(
      "normalize folds case, spacing, trailing punctuation",
      normalizeQuestion("  What ARE   your recent projects??  ") ===
        normalizeQuestion("what are your recent projects"),
      normalizeQuestion("  What ARE   your recent projects??  "),
    );
    check(
      "different questions keep different keys",
      normalizeQuestion(Q_PLAIN) !== normalizeQuestion(Q_CARDS),
    );

    // 2 ── The whole point: a canned hit costs nothing.
    const plain = await ask(Q_PLAIN);
    check("canned answer served verbatim", plain.text === A_PLAIN, plain.text);
    check("canned answer made ZERO api calls", plain.calls === 0, `${plain.calls} call(s)`);

    // 3 ── Matching tolerates case, spacing and trailing punctuation.
    const sloppy = await ask("   what did blake DO at   zephyrwind  ");
    check("sloppy phrasing still hits the canned row", sloppy.text === A_PLAIN, sloppy.text);
    check("sloppy canned hit made ZERO api calls", sloppy.calls === 0, `${sloppy.calls} call(s)`);

    // 4 ── A canned answer can still carry a real, hydrated card.
    const carded = await ask(Q_CARDS);
    check("canned answer with a card made ZERO api calls", carded.calls === 0);
    check("canned answer emitted one card", carded.cards.length === 1, `${carded.cards.length}`);
    check("card is the projects block", carded.cards[0]?.type === "projects", carded.cards[0]?.type);
    check(
      "card was hydrated from the database",
      Boolean(carded.cards[0]?.items?.some((p) => p.id === `${PREFIX}-proj`)),
    );

    // 5 ── A near-miss must reach the model, not guess.
    const near = await ask(`${Q_PLAIN} And who did he work with there?`);
    check("near-miss falls through to the model", near.text.includes(MODEL_TEXT), near.text);
    check("near-miss made exactly one api call", near.calls === 1, `${near.calls} call(s)`);
    check("near-miss did not leak the canned text", !near.text.includes(A_PLAIN));

    // 6 ── Disabled rows are inert.
    const off = await ask(Q_OFF);
    check("disabled row falls through to the model", off.text.includes(MODEL_TEXT), off.text);
    check("disabled row made exactly one api call", off.calls === 1, `${off.calls} call(s)`);

    // 7 ── An unanswered row is a to-do, not an empty reply.
    const blank = await ask(Q_BLANK);
    check("empty answer falls through to the model", blank.text.includes(MODEL_TEXT), blank.text);
    check("empty answer made exactly one api call", blank.calls === 1, `${blank.calls} call(s)`);

    // 8 ── The extracted brain still runs the real tool loop.
    const tooled = await ask("Tell me something new about the kiln work", [
      { tool: { name: "show_projects", input: {} } },
      { text: CLOSING_TEXT },
    ]);
    check("model path still emits a card", tooled.cards[0]?.type === "projects", tooled.cards[0]?.type);
    check("model path speaks after the tool", tooled.text.includes(CLOSING_TEXT), tooled.text);
    check("tool loop ran two turns", tooled.calls === 2, `${tooled.calls} call(s)`);

    // 9 ── Canned turns are still visible in Activity.
    const session = await prisma.chatSession.findUnique({
      where: { visitorKey: SESSION_KEY },
      include: { messages: true },
    });
    check("canned turn recorded a question",
      Boolean(session?.messages.some((m) => m.role === "user" && m.content === Q_PLAIN)));
    check("canned turn recorded the answer",
      Boolean(session?.messages.some((m) => m.role === "assistant" && m.content === A_PLAIN)));

    // 10 ── hits counts served answers only.
    const plainRow = await prisma.cannedAnswer.findUnique({ where: { id: `${PREFIX}-plain` } });
    check("hits counted both canned serves", plainRow?.hits === 2, `${plainRow?.hits}`);
    const offRow = await prisma.cannedAnswer.findUnique({ where: { id: `${PREFIX}-off` } });
    check("fall-through did not count a hit", offRow?.hits === 0, `${offRow?.hits}`);

    // 11 ── The answer does not depend on which channel asked.
    const viaOther = await ask(Q_PLAIN, undefined, "whatsapp");
    check("canned text is identical across channels", viaOther.text === A_PLAIN, viaOther.text);
    check("canned hit on another channel made ZERO api calls", viaOther.calls === 0);

    // 12 ── Saving a question that collides merges instead of throwing.
    // matchKey is unique, so a raw create would surface a Prisma error in the
    // admin form. Blake retyping an existing question must not be a crash.
    const beforeMerge = await prisma.cannedAnswer.count();
    await saveCannedAnswer({
      question: `  ${Q_PLAIN.toUpperCase()}  `,
      answer: "Merged answer.",
      enabled: true,
    });
    check("colliding save did not create a second row",
      (await prisma.cannedAnswer.count()) === beforeMerge, `${beforeMerge}`);
    const merged = await prisma.cannedAnswer.findUnique({ where: { id: `${PREFIX}-plain` } });
    check("colliding save merged into the owning row", merged?.answer === "Merged answer.",
      merged?.answer);

    // Editing one row's question onto another's key collapses the two.
    await saveCannedAnswer({
      id: `${PREFIX}-blank`,
      question: Q_PLAIN,
      answer: "Collapsed answer.",
      enabled: true,
    });
    check("editing onto an existing question collapses the rows",
      (await prisma.cannedAnswer.count()) === beforeMerge - 1);
    check("the edited row is gone",
      (await prisma.cannedAnswer.findUnique({ where: { id: `${PREFIX}-blank` } })) === null);

    // Secondary guard (not proof): the route kept nothing it shouldn't own.
    const route = readFileSync(path.join(root, "app/api/chat/route.ts"), "utf8");
    check("route no longer imports the Anthropic SDK", !route.includes("@anthropic-ai/sdk"));
    check("route no longer holds the tool catalogue", !route.includes("input_schema"));
    check("route delegates to the brain", route.includes("lib/brain"));
  } finally {
    // 14 ── Cleanup.
    await cleanup();
    check("canned answers cleaned up", (await prisma.cannedAnswer.count()) === baseCanned);
    check("projects cleaned up", (await prisma.project.count()) === baseProjects);
    check("sessions cleaned up", (await prisma.chatSession.count()) === baseSessions);
    check("messages cleaned up", (await prisma.chatMessage.count()) === baseMessages);
    await prisma.$disconnect();
  }

  // 15 ── The admin card fields survive the reset React runs after a save.
  // Last, and after the database work: this installs browser globals for the
  // rest of the process, which nothing above should ever see.
  await checkCardFieldsSurviveSave();

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

/**
 * Blake picks a card, saves, and the card is still on screen — the assertion
 * that would have caught the row coming back as "No card" and being wiped by
 * the next save.
 *
 * The real `CardFields` is mounted in a real DOM and driven the way React
 * drives it around a form action: the fields change, the form resets (React
 * resets a form once its action resolves), and the row re-renders with what the
 * database now holds. The second reset is the save that changes nothing — the
 * case that has no re-render to repair the fields afterwards.
 */
async function checkCardFieldsSurviveSave() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.window = dom.window;
  globals.document = dom.window.document;
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  globals.HTMLElement = dom.window.HTMLElement;
  globals.Element = dom.window.Element;
  globals.Node = dom.window.Node;
  globals.Event = dom.window.Event;
  globals.IS_REACT_ACT_ENVIRONMENT = true;

  const React = (await import("react")).default;
  // The admin components are compiled by Next with the automatic JSX runtime;
  // tsx compiles them with the classic one, which expects `React` in scope.
  (globals as { React?: unknown }).React = React;
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CardFields } = await import("../../../app/admin/CardFields");

  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const row = (tool: string, input: string) =>
    React.createElement(
      "form",
      null,
      React.createElement(CardFields, { savedTool: tool, savedInput: input }),
    );
  const select = () => container.querySelector("select[name=cardTool]") as HTMLSelectElement;
  const options = () => container.querySelector("input[name=cardInput]") as HTMLInputElement;
  const form = () => container.querySelector("form") as HTMLFormElement;

  await act(async () => {
    root.render(row("", ""));
  });

  await act(async () => {
    select().value = "show_projects";
    select().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    options().value = '{"layout":"filmstrip"}';
    options().dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  check("picking a card shows it", select().value === "show_projects", select().value);

  // Save: React resets the form, and the row re-renders as it is now stored.
  await act(async () => {
    form().reset();
    root.render(row("show_projects", '{"layout":"filmstrip"}'));
  });
  check("the saved card is still shown after saving",
    select().value === "show_projects", select().value);
  check("the saved card options are still shown after saving",
    options().value === '{"layout":"filmstrip"}', options().value);

  // Saving again changes nothing, so nothing re-renders to undo the reset.
  await act(async () => {
    form().reset();
  });
  check("saving again does not clear the card",
    select().value === "show_projects", select().value);
  check("saving again does not clear the card options",
    options().value === '{"layout":"filmstrip"}', options().value);
}

main().catch((e) => {
  console.error("Proof run errored:", e);
  process.exit(1);
});

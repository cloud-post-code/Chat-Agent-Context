/**
 * Primary proof for admin-chat-a2ui (see PROOF.md).
 * Run: npx tsx docs/features/admin-chat-a2ui/proof.ts
 *
 * Drives the admin brain's tool loop with a scripted model client (the only
 * doubled boundary, per lib/brain.ts's ModelClient seam), asserts the events
 * it emits, and asserts the real rows its tools write — a goal directive and
 * an approved ingestion — under a throwaway user that is deleted at the end.
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

/** One scripted model turn: optional streamed text, then tool calls (or none = done). */
type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };

/** A ModelClient whose stream() pops the next scripted turn. */
function scriptedClient(turns: Turn[]) {
  let i = 0;
  return {
    messages: {
      stream() {
        const turn = turns[Math.min(i++, turns.length - 1)] ?? {};
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) {
              yield {
                type: "content_block_delta",
                delta: { type: "text_delta", text: turn.text },
              };
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

const GOAL_TEXT = "Chat-proof goal: mention the Quillhaven retrospective to returning visitors.";
const INGEST_TEXT =
  "Chat-proof ingest body: the Quillhaven kiln logs from the autumn firing season.";

async function main() {
  const { prisma } = await import("../../../lib/db");
  const {
    adminAnswer,
    adminPanelKeys,
    ingestPlanFor,
    approveIngestion,
  } = await import("../../../lib/adminBrain");
  const { saveIngestionSource, seedStarterIngestionSources, setIngestionSourceHidden } =
    await import("../../../lib/ingestionSources");

  const user = await prisma.user.create({
    data: {
      email: "proof-admin-chat-a2ui@example.invalid",
      name: "Proof Admin Chat",
      slug: `proof-admin-chat-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });

  const collect = async (turns: Turn[]) => {
    const events: { t: string; v: unknown }[] = [];
    for await (const e of adminAnswer(
      { userId: user.id, message: "scripted", operator: false },
      { client: scriptedClient(turns) },
    )) {
      events.push(e);
    }
    return events;
  };

  try {
    await seedStarterIngestionSources(user.id);
    const err = await saveIngestionSource(user.id, {
      key: "field-notes",
      label: "Field notes",
      description: "Proof custom source for pasted notes",
      systemPrompt: "",
      uploadMethod: "textarea",
      storageKinds: "text",
      splitMode: "single",
      outputMethod: "knowledge",
      enabled: true,
    });
    check("custom ingestion source created", err === null, err ?? undefined);

    // ── 1. Panel keys derive from live data ──
    const keys = (await adminPanelKeys(user.id, false)).map((k) => k.key);
    for (const k of ["goals", "rules", "answers", "theme", "activity", "graph", "field-notes"]) {
      check(`panel key present: ${k}`, keys.includes(k));
    }
    check("users panel hidden from non-operators", !keys.includes("users"));
    const opKeys = (await adminPanelKeys(user.id, true)).map((k) => k.key);
    check("users panel present for operators", opKeys.includes("users"));
    const customRow = await prisma.ingestionSource.findUnique({
      where: { userId_key: { userId: user.id, key: "field-notes" } },
    });
    await setIngestionSourceHidden(user.id, customRow!.id, true);
    const hiddenKeys = (await adminPanelKeys(user.id, false)).map((k) => k.key);
    check("hidden source's panel key disappears", !hiddenKeys.includes("field-notes"));
    await setIngestionSourceHidden(user.id, customRow!.id, false);

    // ── 2. show_panel tool → panel event, loop terminates ──
    const shown = await collect([
      { tools: [{ name: "show_panel", input: { key: "goals" } }] },
      { text: "Here are your goals." },
    ]);
    check(
      "show_panel yields a panel event for goals",
      shown.some((e) => e.t === "panel" && e.v === "goals"),
      JSON.stringify(shown),
    );
    check(
      "loop closes with text after the panel",
      shown.some((e) => e.t === "text" && String(e.v).includes("goals")),
    );
    const bogus = await collect([
      { tools: [{ name: "show_panel", input: { key: "not-a-panel" } }] },
      { text: "No such page." },
    ]);
    check("unknown panel key yields no panel event", !bogus.some((e) => e.t === "panel"));

    // ── 3. save_goal tool → real AgentDirective row ──
    const saved = await collect([
      { tools: [{ name: "save_goal", input: { text: GOAL_TEXT } }] },
      { text: "Saved." },
    ]);
    const goalEvent = saved.find((e) => e.t === "goal") as
      | { t: "goal"; v: { id: string; text: string } }
      | undefined;
    check("save_goal yields a goal event", !!goalEvent, JSON.stringify(saved));
    const goalRow = await prisma.agentDirective.findFirst({
      where: { userId: user.id, kind: "goal", text: GOAL_TEXT },
    });
    check("goal persists as a real AgentDirective row", !!goalRow && goalRow.enabled);
    check("goal event carries the row id", goalEvent?.v.id === goalRow?.id);

    // ── 4. ingestPlanFor routes by the source's real form set ──
    const custom = await prisma.ingestionSource.findUnique({
      where: { userId_key: { userId: user.id, key: "field-notes" } },
    });
    // The built-in Links panel has no IngestionSource row of its own (the
    // starters are the four generic tabs), so the builtin routing is checked
    // on the row shape ingestPlanFor reads rather than a seeded row.
    const links = { key: "links", builtin: true, uploadMethod: "url", storageKinds: "text" };
    check("plan: custom textarea source accepts text", ingestPlanFor(custom!, "text").ok);
    check("plan: custom textarea source refuses url", !ingestPlanFor(custom!, "url").ok);
    check("plan: builtin links source accepts url", ingestPlanFor(links, "url").ok);
    check("plan: builtin links source refuses text", !ingestPlanFor(links, "text").ok);

    // ── 5. propose_ingestion → approval payload → approveIngestion writes ──
    const proposed = await collect([
      {
        tools: [
          {
            name: "propose_ingestion",
            input: {
              sourceKey: "field-notes",
              method: "text",
              title: "Kiln logs",
              text: INGEST_TEXT,
            },
          },
        ],
      },
      { text: "Ready to approve." },
    ]);
    const approveEvent = proposed.find((e) => e.t === "approve") as
      | { t: "approve"; v: Record<string, unknown> }
      | undefined;
    check("propose_ingestion yields an approval payload", !!approveEvent, JSON.stringify(proposed));
    check("approval names the live source", approveEvent?.v.sourceKey === "field-notes");
    check(
      "approval classification defaults from the source row",
      approveEvent?.v.classification === custom?.classification,
    );
    const badPropose = await collect([
      {
        tools: [
          {
            name: "propose_ingestion",
            input: { sourceKey: "no-such-source", method: "text", text: INGEST_TEXT },
          },
        ],
      },
      { text: "Cannot." },
    ]);
    check(
      "proposal for an unknown source yields no approval payload",
      !badPropose.some((e) => e.t === "approve"),
    );

    const fakeExtract = async (text: string, title: string | null) => ({
      title: title ?? "Kiln logs",
      rawText: text,
      summary: "Proof summary of the kiln logs.",
      tags: ["proof"],
    });
    const approveErr = await approveIngestion(
      user.id,
      approveEvent!.v as never,
      { textExtract: fakeExtract },
    );
    check("approveIngestion succeeds", approveErr === null, approveErr ?? undefined);
    const ingested = await prisma.source.findFirst({
      where: { userId: user.id, kind: "ingest:field-notes" },
    });
    check("approved item persists marked ingest:field-notes", !!ingested);
    check("approved item was scanned via the write path", ingested?.status === "scanned");
    check("approved item kept the pre-filled text", ingested?.rawText === INGEST_TEXT);
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

/**
 * Live cross-check for composable-card-elements — NOT the primary proof.
 * Run: npx tsx docs/features/composable-card-elements/live.ts [slug]
 *
 * Runs the five visitor messages from FEATURE.md's Scenarios in sequence
 * against the REAL model on an existing tenant (default slug "blake"),
 * printing the events each turn produced — card types, item counts/ids,
 * titles — so a human can judge whether the model composed the right small
 * cards. Never asserts on model prose. Needs ANTHROPIC_API_KEY; skips
 * cleanly without it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

type CardSummary = { type: string; count?: number; ids?: string[]; title?: string; focusIds?: string[]; narrowed?: boolean };

function summarizeCard(v: unknown): CardSummary {
  const c = v as { type: string; items?: { id: string }[]; title?: string; focusIds?: string[]; narrowed?: boolean };
  return {
    type: c.type,
    count: Array.isArray(c.items) ? c.items.length : undefined,
    ids: Array.isArray(c.items) ? c.items.map((i) => i.id) : undefined,
    title: c.title,
    focusIds: c.focusIds,
    narrowed: c.narrowed,
  };
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("SKIP: ANTHROPIC_API_KEY not set");
    return;
  }
  const slug = process.argv[2] || "blake";
  const { prisma } = await import("../../../lib/db");
  const { answer } = await import("../../../lib/brain");

  const user = await prisma.user.findUnique({ where: { slug } });
  if (!user) {
    console.log(`SKIP: no user with slug "${slug}" found locally`);
    return;
  }

  const messages = [
    "show me pictures of nails",
    "just the red ones",
    "book that",
    "how much is a gel manicure",
    "instagram?",
  ];

  let history: { role: "user" | "assistant"; content: string; shown?: { type: string; ids?: string[]; tags?: string[]; title?: string }[] }[] = [];

  for (const [i, message] of messages.entries()) {
    const events: { t: string; v: unknown }[] = [];
    let text = "";
    for await (const e of answer(
      { userId: user.id, message, sessionId: `live-composable-cards-${Date.now()}`, history: history as never },
      {},
    )) {
      events.push(e as { t: string; v: unknown });
      if ((e as { t: string }).t === "text") text += (e as { v: string }).v;
    }
    const cardSummaries = events.filter((e) => e.t === "card").map((e) => summarizeCard(e.v));
    console.log(`\nTurn ${i + 1}: "${message}"`);
    console.log("  model text:", JSON.stringify(text.slice(0, 160)));
    console.log("  cards:", JSON.stringify(cardSummaries));

    const shown = cardSummaries.map((c) => ({ type: c.type, ids: c.ids, title: c.title }));
    history = [
      ...history,
      { role: "user", content: message },
      { role: "assistant", content: text, shown: shown.length ? shown : undefined },
    ];
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

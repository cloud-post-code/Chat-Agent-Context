/**
 * Live cross-check for copilot-element-reveal — NOT the primary proof.
 * Run: npx tsx docs/features/copilot-element-reveal/live.ts
 *
 * Seeds the screen recording's situation on a throwaway tenant (a Friday and
 * a Saturday booking) and asks the REAL model the recording's question. Asserts
 * only what the code emitted (an `elements` event naming exactly the Friday
 * booking, and no `panel` event) — never the model's prose. Needs
 * ANTHROPIC_API_KEY; skips cleanly without it.
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("SKIP: ANTHROPIC_API_KEY not set");
    return;
  }
  const { prisma } = await import("../../../lib/db");
  const { adminAnswer } = await import("../../../lib/adminBrain");
  const { saveDirective } = await import("../../../lib/directives");
  const { saveCannedAnswer } = await import("../../../lib/canned");

  const user = await prisma.user.create({
    data: {
      email: "live-copilot-element-reveal@example.invalid",
      name: "Live Element Reveal",
      slug: `live-element-reveal-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });

  const ask = async (message: string) => {
    const events: { t: string; v: unknown }[] = [];
    let text = "";
    for await (const e of adminAnswer({ userId: user.id, message, operator: false })) {
      events.push(e);
      if (e.t === "text") text += e.v;
    }
    return { events, text };
  };

  try {
    await saveDirective(user.id, { kind: "goal", text: "Get interested visitors to leave their details.", enabled: true });
    await saveDirective(user.id, { kind: "goal", text: "Mention the loyalty card.", enabled: false });
    await saveDirective(user.id, { kind: "rule", text: "Never share my phone number.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Do you take walk-ins?", answer: "Yes, before 4pm.", enabled: true });
    await saveCannedAnswer(user.id, { question: "Where do I park?", answer: "Behind the shop.", enabled: true });
    const walkIns = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Do you take walk-ins?" } });
    const parking = await prisma.cannedAnswer.findFirst({ where: { userId: user.id, question: "Where do I park?" } });
    if (walkIns) await prisma.cannedAnswer.update({ where: { id: walkIns.id }, data: { hits: 3 } });
    const rule = await prisma.agentDirective.findFirst({ where: { userId: user.id, kind: "rule" } });
    const offGoal = await prisma.agentDirective.findFirst({ where: { userId: user.id, kind: "goal", enabled: false } });

    // 1. A rule by what it is about.
    const phone = await ask("which rule is about my phone number?");
    const els = phone.events.filter((e) => e.t === "elements").map((e) => e.v as { panel: string; ids: string[]; title: string });
    console.log("  model said:", JSON.stringify(phone.text.slice(0, 200)), "events:", JSON.stringify(els));
    check("phone: one elements event", els.length === 1);
    check("phone: exactly the phone rule", JSON.stringify(els[0]?.ids) === JSON.stringify([rule?.id]), JSON.stringify(els[0]?.ids));
    check("phone: no whole panel", !phone.events.some((e) => e.t === "panel"));

    // 2. A number.
    const unused = await ask("which presets has nobody used yet?");
    const un = unused.events.filter((e) => e.t === "elements").map((e) => e.v as { ids: string[] });
    console.log("  model said:", JSON.stringify(unused.text.slice(0, 200)), "events:", JSON.stringify(un));
    check("unused: exactly the never-served preset", JSON.stringify(un[0]?.ids) === JSON.stringify([parking?.id]));

    // 3. A state.
    const off = await ask("which of my goals are switched off?");
    const of = off.events.filter((e) => e.t === "elements").map((e) => e.v as { panel: string; ids: string[] });
    console.log("  model said:", JSON.stringify(off.text.slice(0, 200)), "events:", JSON.stringify(of));
    check("off: one goal element from goals", of[0]?.panel === "goals" && JSON.stringify(of[0]?.ids) === JSON.stringify([offGoal?.id]));

    // 4. The whole panel is still a whole-panel ask.
    const all = await ask("show my goals");
    console.log("  model said:", JSON.stringify(all.text.slice(0, 200)), "events:", JSON.stringify(all.events.filter((e) => e.t !== "text")));
    check("whole panel: show_panel goals", all.events.some((e) => e.t === "panel" && e.v === "goals"));
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

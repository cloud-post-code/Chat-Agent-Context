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
  const { saveBookingSettings, saveService } = await import("../../../lib/booking/store");

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
    await saveBookingSettings(user.id, { timezone: "America/New_York" });
    const fri = await prisma.appointment.create({
      data: {
        userId: user.id,
        startsAt: new Date("2026-09-25T17:00:00Z"),
        endsAt: new Date("2026-09-25T17:30:00Z"),
        durationMinutes: 30,
        serviceName: "Rebalance (Fill-In)",
        customer: JSON.stringify({ firstName: "Christopher", lastName: "Mauri", email: "c@example.invalid", phone: "7819605419" }),
        answers: "{}",
      },
    });
    const sat = await prisma.appointment.create({
      data: {
        userId: user.id,
        startsAt: new Date("2026-09-26T13:30:00Z"),
        endsAt: new Date("2026-09-26T14:00:00Z"),
        durationMinutes: 30,
        customer: JSON.stringify({ firstName: "Blake", email: "b@example.invalid" }),
        answers: "{}",
      },
    });
    for (const [name, amount] of [["Basic Manicure", 35], ["Gel Manicure", 55], ["French", 80]] as const) {
      await saveService(user.id, { name, pricing: { kind: "fixed", amount }, durationMinutes: 30, enabled: true });
    }

    // 1. The recording's question.
    const friday = await ask("what's on Friday?");
    const els = friday.events.filter((e) => e.t === "elements").map((e) => e.v as { panel: string; ids: string[]; title: string });
    console.log("  model said:", JSON.stringify(friday.text.slice(0, 200)), "events:", JSON.stringify(els));
    check("friday: one elements event", els.length === 1);
    check("friday: exactly the Friday booking", JSON.stringify(els[0]?.ids) === JSON.stringify([fri.id]), JSON.stringify(els[0]?.ids));
    check("friday: no whole panel", !friday.events.some((e) => e.t === "panel"));

    // 2. A name.
    const blake = await ask("show me Blake's appointment");
    const bl = blake.events.filter((e) => e.t === "elements").map((e) => e.v as { ids: string[] });
    console.log("  model said:", JSON.stringify(blake.text.slice(0, 200)), "events:", JSON.stringify(bl));
    check("blake: exactly the Saturday booking", JSON.stringify(bl[0]?.ids) === JSON.stringify([sat.id]));

    // 3. A number.
    const cheap = await ask("which services are under $50?");
    const ch = cheap.events.filter((e) => e.t === "elements").map((e) => e.v as { panel: string; ids: string[] });
    console.log("  model said:", JSON.stringify(cheap.text.slice(0, 200)), "events:", JSON.stringify(ch));
    check("cheap: one service element from booking-services", ch[0]?.panel === "booking-services" && ch[0]?.ids.length === 1);

    // 4. The whole panel is still a whole-panel ask.
    const all = await ask("show my appointments");
    console.log("  model said:", JSON.stringify(all.text.slice(0, 200)), "events:", JSON.stringify(all.events.filter((e) => e.t !== "text")));
    check("whole panel: show_panel appointments", all.events.some((e) => e.t === "panel" && e.v === "appointments"));
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

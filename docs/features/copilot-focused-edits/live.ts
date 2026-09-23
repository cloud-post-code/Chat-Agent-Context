/**
 * Live cross-check for copilot-focused-edits: the REAL model, the screenshot's
 * exact message, a throwaway user. Not the proof — it needs ANTHROPIC_API_KEY.
 * Run: npx tsx docs/features/copilot-focused-edits/live.ts
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

const COLORS = { bg: "#faf3ee", surface: "#e0b9a0", accent: "#ccc6c2", text: "#1a1209" };
const ASKS = [
  "Can you change the accent color to be the color of the name",
  "make the background #fff8f0",
  "make the accent the color of my logo",
];

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { adminAnswer } = await import("../../../lib/adminBrain");
  const user = await prisma.user.create({
    data: {
      email: "live-copilot-focused-edits@example.invalid",
      name: "Live Focused Edits",
      slug: `live-focused-edits-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });
  try {
    await prisma.themeConfig.create({
      data: { userId: user.id, themeColors: JSON.stringify(COLORS) },
    });
    for (const message of ASKS) {
      let text = "";
      const events: unknown[] = [];
      for await (const e of adminAnswer({ userId: user.id, message })) {
        if (e.t === "text") text += e.v;
        else events.push(e);
      }
      console.log(`\n> ${message}\n  events: ${JSON.stringify(events)}\n  text: ${text.trim()}`);
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

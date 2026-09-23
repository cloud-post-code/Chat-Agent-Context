/**
 * Primary proof for copilot-focused-edits (see PROOF.md).
 * Run: npx tsx docs/features/copilot-focused-edits/proof.ts
 *
 * Drives the admin brain's tool loop with a scripted model client (the only
 * doubled boundary), asserts the focused-edit event and the system prompt the
 * code built, then asserts the real ThemeConfig row: untouched by a proposal,
 * and changed in exactly one color role by applyThemeColor.
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

/** A ModelClient whose stream() pops the next scripted turn and records `system`. */
function scriptedClient(turns: Turn[], seen: { system: string[]; calls: number }) {
  let i = 0;
  return {
    messages: {
      stream(params: { system?: unknown }) {
        seen.calls++;
        seen.system.push(String(params.system ?? ""));
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

// Stored colors: `border` is left unset on purpose so its fallback must show up.
const STORED = {
  bg: "#faf3ee",
  surface: "#e0b9a0",
  accent: "#ccc6c2",
  text: "#1a1209",
  surfaceText: "#2b1d10",
  accentText: "#10131c",
};

async function main() {
  const { prisma } = await import("../../../lib/db");
  const brain = (await import("../../../lib/adminBrain")) as Record<string, unknown>;
  const adminAnswer = brain.adminAnswer as typeof import("../../../lib/adminBrain").adminAnswer;
  const applyThemeColor = brain.applyThemeColor as
    | ((userId: string, role: string, value: string) => Promise<string | null>)
    | undefined;
  const { COLOR_ROLES } = await import("../../../lib/theme");

  const user = await prisma.user.create({
    data: {
      email: "proof-copilot-focused-edits@example.invalid",
      name: "Proof Focused Edits",
      slug: `proof-focused-edits-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });

  const run = async (turns: Turn[]) => {
    const seen = { system: [] as string[], calls: 0 };
    const events: { t: string; v: unknown }[] = [];
    for await (const e of adminAnswer(
      { userId: user.id, message: "scripted", operator: false },
      { client: scriptedClient(turns, seen) as never },
    )) {
      events.push(e);
    }
    return { events, seen };
  };
  const themeRow = () => prisma.themeConfig.findUnique({ where: { userId: user.id } });

  try {
    await prisma.themeConfig.create({
      data: {
        userId: user.id,
        aesthetic: "Warm clay studio",
        themeFont: "space-grotesk",
        themeBodyFont: "inter",
        themeRadius: "sharp",
        themeFontSize: "17",
        themeHeadingWeight: "700",
        themeColors: JSON.stringify(STORED),
      },
    });
    const before = await themeRow();

    // ── 1. The exchange: accent := the color of the name (the `text` role) ──
    const { events, seen } = await run([
      { tools: [{ name: "propose_theme_color", input: { role: "accent", value: STORED.text } }] },
      { text: "Save to apply." },
    ]);
    const edits = events.filter((e) => e.t === "edit");
    check("propose_theme_color yields exactly one edit event", edits.length === 1, JSON.stringify(events));
    const v = (edits[0]?.v ?? {}) as Record<string, unknown>;
    check("edit event targets the theme panel's accent role", v.panel === "theme" && v.role === "accent");
    check("edit event carries the role's label", v.label === "Accent", String(v.label));
    check("edit event is pre-filled with the proposed value", v.value === STORED.text, String(v.value));
    check("edit event reports the current accent", v.current === STORED.accent, String(v.current));
    check("no full panel is shown for a focused edit", !events.some((e) => e.t === "panel"));
    check("loop terminates after the proposal", seen.calls === 2, String(seen.calls));

    // ── 2. The model was given the current colors to resolve references with ──
    const system = seen.system[0] ?? "";
    for (const role of COLOR_ROLES) {
      const expected = (STORED as Record<string, string>)[role.key] ?? role.fallback;
      check(
        `system prompt carries current ${role.key} (${expected})`,
        system.includes(role.key) && system.toLowerCase().includes(expected.toLowerCase()),
      );
    }
    check(
      "system prompt says the page name renders in the text role",
      /name[^\n]*\btext\b/i.test(system),
    );

    // ── 3. Proposing wrote nothing ──
    check(
      "ThemeConfig is byte-identical after a proposal",
      JSON.stringify(await themeRow()) === JSON.stringify(before),
    );

    // ── 4. Bad proposals: no edit event, loop still terminates ──
    const badRole = await run([
      { tools: [{ name: "propose_theme_color", input: { role: "sparkle", value: "#112233" } }] },
      { text: "Cannot." },
    ]);
    check("unknown role yields no edit event", !badRole.events.some((e) => e.t === "edit"));
    const badHex = await run([
      { tools: [{ name: "propose_theme_color", input: { role: "accent", value: "tomato" } }] },
      { text: "Cannot." },
    ]);
    check("non-hex value yields no edit event", !badHex.events.some((e) => e.t === "edit"));
    check("bad proposals still terminate", badRole.seen.calls === 2 && badHex.seen.calls === 2);

    // ── 5. show_panel is unchanged ──
    const shown = await run([
      { tools: [{ name: "show_panel", input: { key: "theme" } }] },
      { text: "Here is your theme." },
    ]);
    check(
      "show_panel still reveals the full theme panel",
      shown.events.some((e) => e.t === "panel" && e.v === "theme"),
    );

    // ── 6. Save: one role changes, everything else is identical ──
    check("applyThemeColor is exported", typeof applyThemeColor === "function");
    if (typeof applyThemeColor === "function") {
      const badSave = await applyThemeColor(user.id, "accent", "not-a-hex");
      check("malformed hex is refused with an error", typeof badSave === "string");
      const badSaveRole = await applyThemeColor(user.id, "sparkle", "#112233");
      check("unknown role is refused with an error", typeof badSaveRole === "string");
      check(
        "refused saves write nothing",
        JSON.stringify(await themeRow()) === JSON.stringify(before),
      );

      const err = await applyThemeColor(user.id, "accent", String(v.value ?? STORED.text));
      check("applyThemeColor succeeds", err === null, err ?? undefined);
      const after = await themeRow();
      const colors = JSON.parse(after?.themeColors ?? "{}") as Record<string, string>;
      check("accent now equals the proposed value", colors.accent === STORED.text, colors.accent);
      check(
        "every other color role is unchanged",
        JSON.stringify({ ...colors, accent: STORED.accent }) === JSON.stringify(STORED),
        JSON.stringify(colors),
      );
      const strip = (r: typeof after) =>
        JSON.stringify({ ...r, themeColors: null, updatedAt: null });
      check("every other ThemeConfig column is unchanged", strip(after) === strip(before));
    }
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

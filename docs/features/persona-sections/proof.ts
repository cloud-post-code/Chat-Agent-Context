/**
 * Primary proof for persona-sections (see PROOF.md).
 * Run: npx tsx docs/features/persona-sections/proof.ts
 *
 * Snapshots the real Profile row, writes throwaway section text through the
 * real save path (lib/persona.writePersonaSections), asserts the catalogue,
 * the round-trip, and the assembled system prompt, then restores the snapshot.
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

// Distinctive strings so a match in the prompt can only come from this proof.
const PERSONA_TEXT =
  "A Zephyrwind kiln operator who fires slowly, distrusts Harrowgate pyrometers, " +
  "and would rather rebuild a kiln than argue about one.";
const LEGACY_CORE = "Role: Zephyrwind kiln operator, archetype The Quiet Tinkerer.";
const LEGACY_STRESS = "Under pressure they shorten the firing cycle and ask Harrowgate for help.";

async function main() {
  const { prisma, getProfile, getPersonaConfig } = await import("../../../lib/db");
  const {
    PERSONA_BLURB,
    PERSONA_SECTIONS,
    personaPromptBlock,
    safePersonaSections,
    writePersonaSections,
  } = await import("../../../lib/persona");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");

  const before = await getPersonaConfig();
  const snapshot = before.personaSections;

  try {
    // 1 ── Catalogue integrity: one free-prose field, described in one paragraph.
    const keys = PERSONA_SECTIONS.map((s) => s.key);
    check("catalogue is a single field", PERSONA_SECTIONS.length === 1, keys.join(","));
    check("section keys are unique", new Set(keys).size === keys.length);
    check(
      "section keys are form-safe",
      keys.every((k) => /^[a-z0-9_]+$/.test(k)),
      keys.filter((k) => !/^[a-z0-9_]+$/.test(k)).join(","),
    );
    check(
      "every section has a label, hint, and size",
      PERSONA_SECTIONS.every((s) => !!s.label && !!s.hint && s.rows > 0),
    );
    check(
      "the blurb is one non-empty paragraph",
      PERSONA_BLURB.trim().length > 0 && !PERSONA_BLURB.includes("\n"),
    );

    // 2 ── Round-trip through the real save path.
    await writePersonaSections({ persona: PERSONA_TEXT, not_a_section: "should be dropped" });
    const stored = safePersonaSections((await getPersonaConfig()).personaSections);
    check("the persona field round-trips", stored.persona === PERSONA_TEXT);
    check("every catalogue key is present", keys.every((k) => k in stored));
    check("unknown keys are dropped", !("not_a_section" in stored));

    // 3 ── Malformed storage never throws.
    for (const bad of ["", "not json", "[1,2]", "null"]) {
      const m = safePersonaSections(bad);
      check(
        `malformed storage (${JSON.stringify(bad)}) reads all-empty`,
        Object.keys(m).length === keys.length && Object.values(m).every((v) => v === ""),
      );
    }

    // 4 ── Retired-catalogue text is a MIGRATION concern now: the deploy
    // bootstrap folds it forward once; runtime reads drop unknown keys.
    const { foldLegacySections } = await import("../../../lib/bootstrap");
    const folded = foldLegacySections({ core_profile: LEGACY_CORE, stress_response: LEGACY_STRESS });
    check(
      "bootstrap fold joins legacy sections into one block",
      folded.includes(LEGACY_CORE) && folded.includes(LEGACY_STRESS),
    );
    check("folded legacy text keeps its section labels", folded.includes("Core profile"));
    check(
      "runtime reads drop legacy keys instead of folding",
      safePersonaSections(JSON.stringify({ core_profile: LEGACY_CORE })).persona === "",
    );
    check(
      "a filled persona field reads as written",
      safePersonaSections(JSON.stringify({ persona: PERSONA_TEXT, core_profile: LEGACY_CORE }))
        .persona === PERSONA_TEXT,
    );

    // 5 ── Prompt render: the paragraph goes in as written, with no headings.
    const prompt = await buildSystemPrompt();
    check("prompt carries the persona text", prompt.includes(PERSONA_TEXT));
    check("single field renders without a section heading", !prompt.includes("### Persona"));
    check("retired group headings are gone", !prompt.includes("## Agent behaviors"));

    // 6 ── An empty persona renders as "" so the caller can fall back.
    check("empty persona renders as nothing", personaPromptBlock("{}") === "");
    check("retired VOICE & WORLDVIEW block is gone", !prompt.includes("VOICE & WORLDVIEW"));
  } finally {
    // 6 ── Restore.
    await prisma.personaConfig.update({ where: { id: 1 }, data: { personaSections: snapshot } });
    const restored = (await getPersonaConfig()).personaSections;
    check("profile restored to its pre-proof state", restored === snapshot);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

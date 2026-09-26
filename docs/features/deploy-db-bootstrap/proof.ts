/**
 * Primary proof for deploy-db-bootstrap (see PROOF.md).
 * Run: npx tsx docs/features/deploy-db-bootstrap/proof.ts
 *
 * Local dev Postgres; zero model calls. Profile fields touched are
 * snapshotted and restored in the finally.
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
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { bootstrapDatabase, foldLegacySections } = await import("@/lib/bootstrap");
  const { safePersonaSections } = await import("@/lib/persona");
  const { resolveAdminTab } = await import("../../../app/admin/contentTabs");
  const { prisma } = await import("@/lib/db");

  const before = await prisma.personaConfig.findUnique({ where: { id: 1 } });
  if (!before) throw new Error("No PersonaConfig row — seed the dev DB first.");
  const snapshot = { personaSections: before.personaSections };

  try {
    // 1. Idempotent on a populated DB.
    const counts = async () =>
      Promise.all([
        prisma.ingestionSource.count(),
        prisma.cannedAnswer.count(),
      ]);
    await bootstrapDatabase();
    const c1 = await counts();
    await bootstrapDatabase();
    const c2 = await counts();
    check("bootstrap twice changes no seeded-table counts", JSON.stringify(c1) === JSON.stringify(c2), `${c1} -> ${c2}`);

    // 2. The fold helper.
    const folded = foldLegacySections({ core_profile: "I fire kilns.", stress_response: "I slow down." });
    check(
      "legacy sections fold into labeled prose",
      folded.includes("Core profile") && folded.includes("I fire kilns.") && folded.includes("I slow down."),
      folded,
    );
    check("current-shape input folds to empty", foldLegacySections({ persona: "hi" }) === "");

    // 3. Persona migration round-trip.
    await prisma.personaConfig.update({
      where: { id: 1 },
      data: { personaSections: JSON.stringify({ core_profile: "PROOF-DDB legacy text" }) },
    });
    await bootstrapDatabase();
    const migrated = await prisma.personaConfig.findUnique({ where: { id: 1 } });
    const parsed = JSON.parse(migrated!.personaSections || "{}");
    check(
      "legacy personaSections rewritten to the single-key shape",
      typeof parsed.persona === "string" &&
        parsed.persona.includes("PROOF-DDB legacy text") &&
        !("core_profile" in parsed),
      migrated!.personaSections,
    );
    const current = JSON.stringify({ persona: "PROOF-DDB current" });
    await prisma.personaConfig.update({ where: { id: 1 }, data: { personaSections: current } });
    await bootstrapDatabase();
    const untouched = await prisma.personaConfig.findUnique({ where: { id: 1 } });
    check("current-shape personaSections left byte-identical", untouched!.personaSections === current);

    // 5. The runtime is pruned.
    const read = (f: string) => readFileSync(path.join(root, f), "utf8");
    check("contentTabs.ts has no LEGACY_CONTENT_TABS", !read("lib/admin/contentTabs.ts").includes("LEGACY_CONTENT_TABS"));
    const persona = read("lib/persona.ts");
    check("persona.ts has no fold/legacy catalogue", !persona.includes("foldLegacy") && !persona.includes("LEGACY_SECTIONS"));
    const dash = read("app/admin/dashboard/page.tsx");
    check("dashboard has no linkedin shim", !dash.includes("linkedin"));
    check("dashboard no longer seeds lazily", !dash.includes("seedStarter"));
    check("actions.ts no longer writes linkedin", !read("app/admin/actions/profile.ts").includes("linkedin"));
    check("knowledge.ts no longer formats linkedin", !read("lib/knowledge.ts").includes("linkedin"));

    // 6. Reads drop legacy keys instead of folding.
    const dropped = safePersonaSections(JSON.stringify({ core_profile: "old text" }));
    check("safePersonaSections drops legacy keys on read", dropped.persona === "");

    // 7. instrumentation wiring.
    const inst = read("instrumentation.ts");
    check(
      "instrumentation runs bootstrap on the nodejs runtime",
      inst.includes("bootstrapDatabase") && inst.includes("NEXT_RUNTIME"),
    );

    // 8. The shim really is gone at the resolver.
    const r = resolveAdminTab("knowledge");
    check('resolveAdminTab("knowledge") passes through', r.nav === "knowledge" && r.sub === undefined, JSON.stringify(r));
  } finally {
    await prisma.personaConfig.update({ where: { id: 1 }, data: snapshot }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

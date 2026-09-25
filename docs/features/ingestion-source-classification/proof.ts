/**
 * Primary proof for ingestion-source-classification (see PROOF.md).
 * Run: npx tsx docs/features/ingestion-source-classification/proof.ts
 *
 * Local dev Postgres; no model calls. DB rows are `proof-isc-` prefixed
 * and removed in the finally.
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
  const { CLASSIFICATIONS, CLASSIFICATION_LABELS, ENABLED_CLASSIFICATIONS, saveIngestionSource } =
    await import("@/lib/ingestionSources");
  const { prisma } = await import("@/lib/db");

  // 1. The catalog and the enabled subset.
  check(
    "catalog is public|contact|close-friends|personal",
    JSON.stringify(CLASSIFICATIONS) ===
      JSON.stringify(["public", "contact", "close-friends", "personal"]),
    JSON.stringify(CLASSIFICATIONS),
  );
  check(
    "every classification has a display label",
    CLASSIFICATIONS.every((c: string) => !!CLASSIFICATION_LABELS[c as never]),
  );
  // Superseded by docs/features/per-item-classification: all four tiers are
  // selectable now, and a document can override its source's default. What
  // survives from this feature is that the catalog is closed — an unknown
  // value is still refused (asserted at 5 below).
  check(
    "every catalogued classification is enabled",
    JSON.stringify(ENABLED_CLASSIFICATIONS) === JSON.stringify(CLASSIFICATIONS),
    JSON.stringify(ENABLED_CLASSIFICATIONS),
  );

  try {
    // 2. Column exists and defaults to public.
    const bare = await prisma.ingestionSource.create({
      data: {
        key: "proof-isc-default",
        label: "Proof ISC default",
        uploadMethod: "generic",
      },
    });
    check("classification defaults to public", bare.classification === "public", bare.classification);

    // 3. saveIngestionSource accepts public.
    const okErr = await saveIngestionSource({
      key: "proof-isc-src", label: "Proof ISC", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
      classification: "public",
    });
    check("save with public succeeds", okErr === null, String(okErr));
    const row = await prisma.ingestionSource.findUnique({ where: { key: "proof-isc-src" } });
    check("public persisted", row?.classification === "public", row?.classification);

    // 4. Unknown classification is rejected and writes nothing.
    const badErr = await saveIngestionSource({
      key: "proof-isc-bad", label: "Proof ISC bad", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
      classification: "top-secret",
    });
    const badRow = await prisma.ingestionSource.findUnique({ where: { key: "proof-isc-bad" } });
    check("unknown classification rejected", badErr !== null && !badRow, String(badErr));

    // 5. The catalog is closed: an out-of-catalog status is rejected
    // server-side. (In-catalog tiers are all accepted now — see the
    // per-item-classification feature.)
    const lockedErr = await saveIngestionSource({
      key: "proof-isc-locked", label: "Proof ISC locked", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
      classification: "top-secret",
    });
    const lockedRow = await prisma.ingestionSource.findUnique({ where: { key: "proof-isc-locked" } });
    check(
      "an out-of-catalog classification is rejected",
      lockedErr !== null && !lockedRow,
      String(lockedErr),
    );
    // …and every in-catalog tier now saves.
    const personalErr = await saveIngestionSource({
      key: "proof-isc-personal", label: "Proof ISC personal", description: "", systemPrompt: "",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
      classification: "personal",
    });
    const personalRow = await prisma.ingestionSource.findUnique({
      where: { key: "proof-isc-personal" },
    });
    check(
      "personal saves now that every tier is enabled",
      personalErr === null && personalRow?.classification === "personal",
      String(personalErr),
    );

    // 6. Edit round-trip keeps classification explicit.
    const editErr = await saveIngestionSource({
      id: row!.id, key: "proof-isc-src", label: "Proof ISC edited", description: "",
      systemPrompt: "", uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
      classification: "public",
    });
    const edited = await prisma.ingestionSource.findUnique({ where: { key: "proof-isc-src" } });
    check(
      "edit save keeps a valid classification",
      editErr === null && edited?.classification === "public",
      String(editErr),
    );
  } finally {
    await prisma.ingestionSource
      .deleteMany({ where: { key: { startsWith: "proof-isc" } } })
      .catch(() => {});
    await prisma.$disconnect();
  }

  // 7. The selector sits on every source config form, and actions forward it.
  const selectSrc = readFileSync(path.join(root, "app/admin/ClassificationSelect.tsx"), "utf8");
  const newPage = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
  const editPage = readFileSync(path.join(root, "app/admin/sources/[key]/page.tsx"), "utf8");
  const builder = readFileSync(path.join(root, "app/admin/SourceBuilder.tsx"), "utf8");
  const actions = readFileSync(path.join(root, "app/admin/actions/ingestion.ts"), "utf8");
  check("manual create form renders the selector", newPage.includes("ClassificationSelect"));
  check("edit form renders the selector", editPage.includes("ClassificationSelect"));
  check("builder save pane renders the selector", builder.includes("ClassificationSelect"));
  check(
    "create action forwards classification",
    /createIngestionSourceAction[\s\S]{0,700}classification/.test(actions),
  );
  check(
    "update action forwards classification",
    /updateIngestionSourceAction[\s\S]{0,900}classification/.test(actions),
  );
  check(
    "builder save action forwards classification",
    /saveBuiltSourceAction[\s\S]{0,900}classification/.test(actions),
  );

  // 8. The selector is driven by the enabled set, so anything outside it can
  // never be chosen. (With every tier enabled today nothing renders disabled;
  // the gate is the data, not the markup.)
  check(
    "selector is gated on ENABLED_CLASSIFICATIONS",
    selectSrc.includes("ENABLED_CLASSIFICATIONS"),
  );

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

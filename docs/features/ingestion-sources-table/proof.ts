/**
 * Primary proof for ingestion-sources-table (see PROOF.md).
 * Run: npx tsx docs/features/ingestion-sources-table/proof.ts
 *
 * Talks to the local dev Postgres only. No model calls. Every row created
 * here uses a `proof-ing-` key prefix and is removed in a finally.
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

const PREFIX = "proof-ing-user";

async function main() {
  const {
    STARTER_INGESTION_SOURCES,
    UPLOAD_METHODS,
    STORAGE_KINDS,
    listIngestionSources,
    saveIngestionSource,
    deleteIngestionSource,
    seedStarterIngestionSources,
  } = await import("@/lib/ingestionSources");
  const { prisma } = await import("@/lib/db");

  // Every row this proof touches belongs to a throwaway tenant, so a real
  // account's curated sources are never counted, seeded over, or deleted.
  const userId = `${PREFIX}-a`;
  const otherId = `${PREFIX}-b`;
  async function makeUser(id: string) {
    await prisma.user.create({
      data: { id, email: `${id}@example.test`, name: `Proof ${id}`, slug: id, passwordHash: "x" },
    });
  }
  async function cleanup() {
    // User rows cascade to their ingestion sources.
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    await makeUser(userId);
    await makeUser(otherId);

    // 1. Starter set is the four onboarding-extracted tabs, in display order.
    const starterKeys = STARTER_INGESTION_SOURCES.map((s) => s.key);
    check(
      "starters are the four onboarding tabs in order",
      JSON.stringify(starterKeys) ===
        JSON.stringify(["blog", "testimonials", "about-team", "services"]),
      starterKeys.join(","),
    );

    // 2. Every starter carries the full contract.
    check(
      "every starter has label, systemPrompt, valid uploadMethod/storageKinds, outputMethod",
      STARTER_INGESTION_SOURCES.every(
        (s) =>
          s.label.trim() &&
          s.systemPrompt.trim() &&
          (UPLOAD_METHODS as readonly string[]).includes(s.uploadMethod) &&
          (STORAGE_KINDS as readonly string[]).includes(s.storageKinds) &&
          s.outputMethod.trim(),
      ),
    );

    // 3a. Seeding a fresh account fills it with exactly the starters — the
    // production path, and what gives 3b substance.
    await seedStarterIngestionSources(userId);
    const seeded = await listIngestionSources(userId);
    check(
      "seeding an empty account installs the starters",
      JSON.stringify(seeded.map((r) => r.key)) === JSON.stringify(starterKeys),
      seeded.map((r) => r.key).join(","),
    );

    // 3b. Seeding a non-empty account changes nothing.
    const before = await prisma.ingestionSource.count({ where: { userId } });
    await seedStarterIngestionSources(userId);
    const after = await prisma.ingestionSource.count({ where: { userId } });
    check("re-seed is a no-op on a non-empty account", before === after, `${before} -> ${after}`);

    // 4. Vocabulary is enforced.
    const badUpload = await saveIngestionSource(userId, {
      key: "proof-ing-bad",
      label: "Proof bad upload",
      uploadMethod: "carrier-pigeon",
      storageKinds: "text",
      systemPrompt: "",
      description: "",
      outputMethod: "",
    });
    check("unknown uploadMethod rejected", typeof badUpload === "string");
    const badStorage = await saveIngestionSource(userId, {
      key: "proof-ing-bad",
      label: "Proof bad storage",
      uploadMethod: "url",
      storageKinds: "vibes",
      systemPrompt: "",
      description: "",
      outputMethod: "",
    });
    check("unknown storageKinds rejected", typeof badStorage === "string");

    // 5. Blank key derives from label; collisions suffix rather than clobber.
    const e1 = await saveIngestionSource(userId, {
      key: "",
      label: "Proof-Ing Alpha!",
      uploadMethod: "generic",
      storageKinds: "text+image",
      systemPrompt: "p",
      description: "",
      outputMethod: "IngestedItem",
    });
    check("blank-key save succeeds", e1 === null, String(e1));
    const alpha = await prisma.ingestionSource.findUnique({
      where: { userId_key: { userId, key: "proof-ing-alpha" } },
    });
    check("blank key slugified from label", alpha !== null);
    const e2 = await saveIngestionSource(userId, {
      key: "proof-ing-alpha",
      label: "Proof-Ing Alpha the Second",
      uploadMethod: "generic",
      storageKinds: "text",
      systemPrompt: "p",
      description: "",
      outputMethod: "IngestedItem",
    });
    check("colliding new key save succeeds", e2 === null, String(e2));
    const alpha2 = await prisma.ingestionSource.findUnique({
      where: { userId_key: { userId, key: "proof-ing-alpha-2" } },
    });
    check("collision got a -2 suffix, owner untouched", alpha2 !== null && alpha !== null);

    // 5b. The key is unique PER ACCOUNT: another tenant keeps the plain key.
    const e3 = await saveIngestionSource(otherId, {
      key: "proof-ing-alpha",
      label: "Proof-Ing Alpha next door",
      uploadMethod: "generic",
      storageKinds: "text",
      systemPrompt: "p",
      description: "",
      outputMethod: "IngestedItem",
    });
    check("neighbouring account save succeeds", e3 === null, String(e3));
    const neighbour = await prisma.ingestionSource.findUnique({
      where: { userId_key: { userId: otherId, key: "proof-ing-alpha" } },
    });
    check("a taken key in another account does not suffix", neighbour !== null);

    // 6. New rows append at the end; list is ordered, and scoped to the owner.
    const rows = await listIngestionSources(userId);
    const orders = rows.map((r) => r.order);
    check(
      "list ordered by order asc",
      orders.every((o, i) => i === 0 || o >= orders[i - 1]),
      orders.join(","),
    );
    check(
      "new rows appended at the end",
      rows[rows.length - 1]?.key === "proof-ing-alpha-2" &&
        rows[rows.length - 2]?.key === "proof-ing-alpha",
    );
    check(
      "list is scoped to its account",
      rows.every((r) => r.userId === userId) &&
        (await listIngestionSources(otherId)).every((r) => r.userId === otherId),
    );

    // 7. Delete removes the row, and only from its own account.
    if (alpha2) await deleteIngestionSource(userId, alpha2.id);
    const gone = await listIngestionSources(userId);
    check("deleted row no longer listed", !gone.some((r) => r.key === "proof-ing-alpha-2"));
    if (neighbour) await deleteIngestionSource(userId, neighbour.id);
    check(
      "delete cannot reach another account's row",
      (await listIngestionSources(otherId)).some((r) => r.key === "proof-ing-alpha"),
    );
  } finally {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

/**
 * Primary proof for edit-ingestion-source (see PROOF.md).
 * Run: npx tsx docs/features/edit-ingestion-source/proof.ts
 *
 * Local dev Postgres; no model calls. Password checks run against env
 * values this proof sets itself; DB rows are `proof-eis-` prefixed and
 * removed in the finally.
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
  const { checkEditPassword, editToken, verifyEditToken } = await import("@/lib/ingestionAuth");
  const { saveIngestionSource } = await import("@/lib/ingestionSources");
  const { prisma } = await import("@/lib/db");

  // 1–2. Password checks against proof-controlled env values.
  const savedEdit = process.env.INGESTION_EDIT_PASSWORD;
  const savedAdmin = process.env.ADMIN_PASSWORD;
  try {
    process.env.INGESTION_EDIT_PASSWORD = "proof-eis-edit-pw";
    process.env.ADMIN_PASSWORD = "proof-eis-admin-pw";
    check("correct edit password accepted", checkEditPassword("proof-eis-edit-pw"));
    check("wrong edit password rejected", !checkEditPassword("nope"));
    check(
      "admin password does not unlock when a dedicated edit password is set",
      !checkEditPassword("proof-eis-admin-pw"),
    );
    process.env.INGESTION_EDIT_PASSWORD = "";
    check("falls back to ADMIN_PASSWORD when unset", checkEditPassword("proof-eis-admin-pw"));
    process.env.ADMIN_PASSWORD = "";
    check("both empty accepts nothing", !checkEditPassword("") && !checkEditPassword("anything"));
  } finally {
    if (savedEdit === undefined) delete process.env.INGESTION_EDIT_PASSWORD;
    else process.env.INGESTION_EDIT_PASSWORD = savedEdit;
    if (savedAdmin === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = savedAdmin;
  }

  // 3. Edit token is its own credential, not the admin cookie value.
  const { createHmac } = await import("node:crypto");
  const adminToken = (() => {
    const mac = createHmac("sha256", process.env.AUTH_SECRET || "dev-insecure-secret-change-me")
      .update("admin")
      .digest("hex");
    return `admin.${mac}`;
  })();
  check("edit token differs from the admin token", editToken() !== adminToken);
  check("verifyEditToken accepts only the edit token",
    verifyEditToken(editToken()) && !verifyEditToken(adminToken) && !verifyEditToken(undefined));

  // 4. saveIngestionSource with an id updates in place, including order.
  try {
    await saveIngestionSource({
      key: "proof-eis-src", label: "Proof EIS", description: "", systemPrompt: "before",
      uploadMethod: "generic", storageKinds: "text", outputMethod: "x",
    });
    const row = await prisma.ingestionSource.findUnique({ where: { key: "proof-eis-src" } });
    const err = await saveIngestionSource({
      id: row!.id, key: "proof-eis-src", label: "Proof EIS edited", description: "",
      systemPrompt: "after", uploadMethod: "generic", storageKinds: "text+image",
      outputMethod: "x", enabled: false, order: 42,
    });
    check("edit save succeeds", err === null, String(err));
    const edited = await prisma.ingestionSource.findUnique({ where: { key: "proof-eis-src" } });
    check(
      "edit updated label, prompt, kinds, enabled, order in place",
      !!edited && edited.id === row!.id && edited.label === "Proof EIS edited" &&
        edited.systemPrompt === "after" && edited.storageKinds === "text+image" &&
        edited.enabled === false && edited.order === 42,
      JSON.stringify(edited),
    );
  } finally {
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-eis" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 5. Every Content tab carries the edit link.
  const dash = readFileSync(path.join(root, "app/admin/dashboard/page.tsx"), "utf8");
  check(
    "dashboard wraps content panels with an Edit ingestion link",
    dash.includes("Edit ingestion") && dash.includes("/admin/sources/${"),
  );

  // 6. The edit page is double-gated.
  const editPage = readFileSync(path.join(root, "app/admin/sources/[key]/page.tsx"), "utf8");
  check("edit page requires admin auth", editPage.includes("isAuthed"));
  check("edit page gates on the edit cookie", editPage.includes("isEditAuthed"));
  check("edit page has the unlock password form", editPage.includes("unlockIngestionEditAction"));
  const actions = readFileSync(path.join(root, "app/admin/actions/ingestion.ts"), "utf8");
  check(
    "update action re-checks edit auth server-side",
    /updateIngestionSourceAction[\s\S]{0,400}requireEditAuth/.test(actions),
  );
  check(
    "save returns to the edited source's own tab",
    /updateIngestionSourceAction[\s\S]{0,1200}dashboard\?tab=\$\{key\}/.test(actions),
  );

  // 7. Documented for local setup.
  const envExample = readFileSync(path.join(root, ".env.example"), "utf8");
  check(".env.example documents INGESTION_EDIT_PASSWORD", envExample.includes("INGESTION_EDIT_PASSWORD"));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

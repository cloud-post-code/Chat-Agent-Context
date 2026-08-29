/**
 * Behavioral proof for business-profile-restructure (see ../PROOF.md).
 * Run via run.sh, which points DATABASE_URL at a fresh migrated Postgres.
 *
 * Asserts the exact shape of the three singleton tables, the absence of the
 * Booking table and native booking code, the singleton loaders, and that the
 * persona pipeline reads/writes PersonaConfig.
 */
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

if (process.env.BPR_PROOF !== "1" || !process.env.DATABASE_URL?.includes("127.0.0.1")) {
  console.error("Run through proof/run.sh — it provisions the throwaway database.");
  process.exit(1);
}

const root = path.resolve(__dirname, "../../../..");
let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PROFILE_COLS = [
  "id",
  "company_name",
  "owner_name",
  "company_address",
  "company_phone_number",
  "company_email",
  "company_hours",
  "updatedAt",
].sort();
const PERSONA_COLS = ["id", "company_logo", "tagline", "personaSections", "updatedAt"].sort();
const THEME_COLS = [
  "id",
  "themeFont",
  "themeBodyFont",
  "themeColors",
  "themeRadius",
  "themeFontSize",
  "themeHeadingWeight",
  "aesthetic",
  "updatedAt",
].sort();

async function main() {
  const { prisma } = await import("../../../../lib/db");

  // 1 ── Table shapes, straight from the live information_schema.
  const cols: { table_name: string; column_name: string; is_nullable: string }[] =
    await prisma.$queryRawUnsafe(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('Profile','PersonaConfig','ThemeConfig','Booking')`,
    );
  const byTable = (t: string) =>
    cols.filter((c) => c.table_name === t).map((c) => c.column_name).sort();

  check("Profile has exactly the six business fields", JSON.stringify(byTable("Profile")) === JSON.stringify(PROFILE_COLS), byTable("Profile").join(","));
  check("PersonaConfig has exactly its fields", JSON.stringify(byTable("PersonaConfig")) === JSON.stringify(PERSONA_COLS), byTable("PersonaConfig").join(","));
  check("ThemeConfig has exactly its fields", JSON.stringify(byTable("ThemeConfig")) === JSON.stringify(THEME_COLS), byTable("ThemeConfig").join(","));
  check("Booking table is gone", byTable("Booking").length === 0, byTable("Booking").join(","));
  const logo = cols.find((c) => c.table_name === "PersonaConfig" && c.column_name === "company_logo");
  check("company_logo is nullable (headshot semantics)", logo?.is_nullable === "YES");

  // 2 ── Singleton loaders create their default rows on first read.
  const db = await import("../../../../lib/db");
  const profile = await (db as any).getProfile();
  check("getProfile creates/returns singleton", profile?.id === 1);
  const personaCfg = await (db as any).getPersonaConfig?.();
  check("getPersonaConfig loader exists and returns singleton", personaCfg?.id === 1);
  const themeCfg = await (db as any).getThemeConfig?.();
  check("getThemeConfig loader exists and returns singleton", themeCfg?.id === 1);

  // 3 ── Persona pipeline writes PersonaConfig, not Profile.
  const persona = await import("../../../../lib/persona");
  const MARK = "Proof-only persona text: the Zephyrwind kiln waits for no one.";
  await (persona as any).writePersonaSections({ persona: MARK });
  const after: any = await (prisma as any).personaConfig.findUnique({ where: { id: 1 } });
  check("writePersonaSections lands in PersonaConfig", (after?.personaSections ?? "").includes(MARK));

  // 4 ── Prompt build works against the new shape and never mentions removed fields.
  const { buildSystemPrompt } = await import("../../../../lib/knowledge");
  const prompt = await buildSystemPrompt("what does the company do?");
  check("buildSystemPrompt returns a prompt", typeof prompt === "string" && prompt.length > 0);
  check("prompt carries persona text from PersonaConfig", prompt.includes(MARK));

  // 5 ── Native booking feature is gone from the tree.
  for (const p of ["app/api/booking", "lib/booking"]) {
    check(`${p} removed`, !existsSync(path.join(root, p)));
  }
  check("prisma client has no booking model", !("booking" in (prisma as any)) || (prisma as any).booking === undefined);

  // 6 ── Grep guard: no app code references removed identifiers.
  const REMOVED =
    "headshot|experienceSummary|bookingEnabled|bookingTz|bookingMinutes|bookingHours|bookingLeadHours|bookingDays|bookingBufferMinutes|bookingTitle|bookingLink|prisma\\.booking";
  let hits = "";
  try {
    hits = execFileSync(
      "grep",
      ["-rInE", REMOVED, "app", "lib", "prisma/schema.prisma", "prisma/seed.ts"],
      { cwd: root, encoding: "utf8" },
    );
  } catch {
    /* exit 1 = no matches = clean */
  }
  check("grep clean of removed fields/tables", hits.trim() === "", hits.split("\n").slice(0, 5).join(" | "));

  await prisma.$disconnect();
  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

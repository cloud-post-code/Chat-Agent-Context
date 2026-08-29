/**
 * Baseline-aware `prisma migrate deploy`, run by `npm start` before the server
 * boots. Replaces the old `prisma db push --accept-data-loss`, which could
 * silently drop data on schema drift.
 *
 * Three database states are handled:
 *  - Fresh (no tables):            migrate deploy runs everything, 0_init up.
 *  - Pre-migrations deploy (app tables exist, no _prisma_migrations): the
 *    schema already matches 0_init — record it as applied (baseline), then
 *    deploy the rest. Nothing is dropped.
 *  - Already migrated:             migrate deploy applies only what's new.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1
     ) AS "exists"`,
    name,
  );
  return Boolean(rows?.[0]?.exists);
}

function run(cmd) {
  console.log(`migrate: ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

async function main() {
  const hasMigrationsTable = await tableExists("_prisma_migrations");
  const hasAppTables = await tableExists("Source");
  await prisma.$disconnect();

  if (!hasMigrationsTable && hasAppTables) {
    // A live pre-migrations database: its schema was pushed to the 0_init
    // shape by the old start script. Baseline it so deploy doesn't try to
    // re-create existing tables.
    run("npx prisma migrate resolve --applied 0_init");
  }

  run("npx prisma migrate deploy");
}

main().catch(async (e) => {
  console.error("migrate: failed:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

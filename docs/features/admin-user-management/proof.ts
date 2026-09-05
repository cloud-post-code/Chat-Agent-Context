/**
 * Primary proof for admin-user-management (see PROOF.md).
 * Run: npx tsx docs/features/admin-user-management/proof.ts
 *
 * Seeds throwaway users (emails prefixed "useradminproof-"), exercises the
 * real lib/accountAdmin.ts code path against the local dev Postgres, asserts,
 * and cleans up. No mocks; state is read back from the database.
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

const MAIL = (n: string) => `useradminproof-${n}@example.test`;

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { hashPassword, verifyPassword } = await import("../../../lib/auth");
  const {
    accountActive,
    isOperator,
    issuePassword,
    listAccounts,
    setAccountDisabled,
    updateAccount,
  } = await import("../../../lib/accountAdmin");

  // ── Clean leftovers from a previous run, then take baselines ──
  await prisma.user.deleteMany({ where: { email: { startsWith: "useradminproof-" } } });
  const baseUsers = await prisma.user.count();

  const savedOperatorEmails = process.env.OPERATOR_EMAILS;

  try {
    // ── Seed three throwaway accounts ──
    const mk = (n: string, extra: Record<string, unknown> = {}) =>
      prisma.user.create({
        data: {
          email: MAIL(n),
          name: `Proof ${n}`,
          slug: `useradminproof-${n}`,
          passwordHash: hashPassword(`initial-pw-${n}`),
          ...extra,
        },
      });
    const alice = await mk("alice", { onboardedAt: new Date() });
    const bob = await mk("bob");
    const carol = await mk("carol");

    // Owned rows for the non-destructive check.
    await prisma.source.create({
      data: {
        id: "useradminproof-src1",
        type: "text",
        title: "Bob's notes",
        rawText: "kept",
        summary: "kept",
        status: "scanned",
        userId: bob.id,
      },
    });

    // ── 1. Listing & search ──
    const all = await listAccounts({ q: "useradminproof", page: 1, pageSize: 50 });
    check("list returns all seeded users", all.total === 3 && all.rows.length === 3);
    const row = all.rows.find((r) => r.id === alice.id);
    check(
      "row carries identity + status fields",
      !!row &&
        row.email === MAIL("alice") &&
        row.slug === "useradminproof-alice" &&
        row.onboardedAt !== null &&
        row.disabledAt === null &&
        row.createdAt instanceof Date,
    );
    const byName = await listAccounts({ q: "Proof bob" });
    const byEmail = await listAccounts({ q: MAIL("carol") });
    check(
      "search matches name and email",
      byName.rows.some((r) => r.id === bob.id) && byEmail.rows.some((r) => r.id === carol.id),
    );
    const p1 = await listAccounts({ q: "useradminproof", page: 1, pageSize: 2 });
    const p2 = await listAccounts({ q: "useradminproof", page: 2, pageSize: 2 });
    const ids = new Set([...p1.rows, ...p2.rows].map((r) => r.id));
    check(
      "pagination: disjoint pages, accurate total",
      p1.rows.length === 2 && p2.rows.length === 1 && ids.size === 3 && p1.total === 3,
    );

    // ── 2. Edit with validation ──
    const renamed = await updateAccount(alice.id, { name: "Proof Alice II" });
    const aliceAfter = await prisma.user.findUnique({ where: { id: alice.id } });
    check("rename persists", "ok" in renamed && aliceAfter?.name === "Proof Alice II");

    const emailClash = await updateAccount(alice.id, { email: MAIL("bob") });
    check("duplicate email is a readable error", "error" in emailClash);
    const slugClash = await updateAccount(alice.id, { slug: "useradminproof-bob" });
    check("duplicate slug is a readable error", "error" in slugClash);

    const dirty = await updateAccount(alice.id, { slug: "  Proof Alice!! " });
    const aliceSlugged = await prisma.user.findUnique({ where: { id: alice.id } });
    check(
      "dirty slug is normalized via slugify rules",
      "ok" in dirty && aliceSlugged?.slug === "proof-alice",
    );
    const reserved = await updateAccount(alice.id, { slug: "admin" });
    check("reserved slug is refused", "error" in reserved);

    // ── 3. Disable revokes access; enable restores ──
    const disabled = await setAccountDisabled(bob.id, true, alice.id);
    const bobDisabled = await prisma.user.findUnique({ where: { id: bob.id } });
    check(
      "disable sets disabledAt",
      "ok" in disabled && bobDisabled !== null && bobDisabled.disabledAt !== null,
    );
    check("disabled account fails the shared eligibility check", !accountActive(bobDisabled));
    check("null user fails the eligibility check", !accountActive(null));
    const enabled = await setAccountDisabled(bob.id, false, alice.id);
    const bobEnabled = await prisma.user.findUnique({ where: { id: bob.id } });
    check(
      "enable clears disabledAt and restores eligibility",
      "ok" in enabled && bobEnabled?.disabledAt === null && accountActive(bobEnabled),
    );

    // ── 4. Self-disable refused ──
    const self = await setAccountDisabled(alice.id, true, alice.id);
    const aliceStill = await prisma.user.findUnique({ where: { id: alice.id } });
    check("self-disable is refused", "error" in self && aliceStill?.disabledAt === null);

    // ── 5. Replacement password ──
    const issued = await issuePassword(carol.id);
    const carolAfter = await prisma.user.findUnique({ where: { id: carol.id } });
    check(
      "issued password verifies against stored scrypt hash",
      "password" in issued &&
        issued.password.length >= 12 &&
        carolAfter !== null &&
        verifyPassword(issued.password, carolAfter.passwordHash),
    );
    check(
      "previous password no longer verifies",
      carolAfter !== null && !verifyPassword("initial-pw-carol", carolAfter.passwordHash),
    );

    // ── 6. Operator gate ──
    process.env.OPERATOR_EMAILS = `SOMEONE@ELSE.test, ${MAIL("alice").toUpperCase()}`;
    check(
      "OPERATOR_EMAILS grants listed emails, case-insensitively",
      (await isOperator({ id: alice.id, email: MAIL("alice") })) === true &&
        (await isOperator({ id: bob.id, email: MAIL("bob") })) === false,
    );
    delete process.env.OPERATOR_EMAILS;
    const founder = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
    if (founder) {
      check(
        "with OPERATOR_EMAILS unset, exactly the founding user passes",
        (await isOperator({ id: founder.id, email: founder.email })) === true &&
          (await isOperator({ id: carol.id, email: MAIL("carol") })) === false,
      );
    } else {
      check("founding-user fallback (no users found)", false, "no founding user in DB");
    }

    // ── 7. Disable is non-destructive ──
    const beforeRows = await prisma.source.count({ where: { userId: bob.id } });
    await setAccountDisabled(bob.id, true, alice.id);
    await setAccountDisabled(bob.id, false, alice.id);
    const afterRows = await prisma.source.count({ where: { userId: bob.id } });
    check("disable/enable leaves owned rows intact", beforeRows === 1 && afterRows === 1);
  } finally {
    if (savedOperatorEmails === undefined) delete process.env.OPERATOR_EMAILS;
    else process.env.OPERATOR_EMAILS = savedOperatorEmails;
    // ── 8. Cleanup ──
    await prisma.source.deleteMany({ where: { id: { startsWith: "useradminproof-" } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "useradminproof-" } } });
    const endUsers = await prisma.user.count();
    check("cleanup returns user count to baseline", endUsers === baseUsers);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

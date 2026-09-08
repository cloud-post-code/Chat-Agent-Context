/**
 * Primary proof for custom-domains (see PROOF.md).
 * Run: npx tsx docs/features/custom-domains/proof.ts
 *
 * Exercises the real lib/customDomains.ts against the real DB: hostname
 * normalization and rejection, add/list/remove scoped by userId, the
 * one-hostname-one-owner rule, and resolveHost's status gating. Then, when a
 * dev server is reachable at PROOF_BASE_URL, drives real HTTP requests carrying
 * a custom-domain Host header to prove the rewrite serves the right tenant and
 * that an unknown host is not served at all.
 *
 * Nothing is stubbed. Throwaway users and their domains are deleted at the end.
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

const BASE = process.env.PROOF_BASE_URL || "http://localhost:3100";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(name: string, why: string) {
  console.log(`  SKIP  ${name} — ${why}`);
}

// Distinctive hostnames so a DB match can only come from this proof.
const HOST_A = "proof-alpha-clinic.invalid";
const HOST_B = "proof-beta-studio.invalid";
const HOST_UNKNOWN = "proof-nobody-owns-this.invalid";

const EMAIL_A = "proof-custom-domains-a@example.invalid";
const EMAIL_B = "proof-custom-domains-b@example.invalid";

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { createUser } = await import("../../../lib/users");
  const {
    normalizeHostname,
    addDomain,
    listDomains,
    removeDomain,
    resolveHost,
  } = await import("../../../lib/customDomains");

  let userAId = "";
  let userBId = "";

  try {
    // ── Setup: two tenants, so every isolation claim has a second party ──
    const a = await createUser({
      email: EMAIL_A,
      name: "Proof Alpha Clinic",
      password: "proof-password-1",
    });
    const b = await createUser({
      email: EMAIL_B,
      name: "Proof Beta Studio",
      password: "proof-password-2",
    });
    if (!("user" in a) || !("user" in b)) throw new Error("proof users could not be created");
    userAId = a.user.id;
    userBId = b.user.id;
    const slugA = a.user.slug;

    // ── Normalization ──
    console.log("\nnormalizeHostname");
    const norm = (input: string) => normalizeHostname(input);
    const ok = (input: string, expected: string) => {
      const r = norm(input);
      check(
        `${JSON.stringify(input)} normalizes to ${expected}`,
        "hostname" in r && r.hostname === expected,
        JSON.stringify(r),
      );
    };
    const rejected = (input: string, why: string) => {
      const r = norm(input);
      check(`${JSON.stringify(input)} rejected (${why})`, "error" in r, JSON.stringify(r));
    };

    ok("smilecare.com", "smilecare.com");
    ok("HTTPS://SmileCare.com/contact?x=1", "smilecare.com");
    ok("  smilecare.com.  ", "smilecare.com");
    ok("www.smile-care.co.uk", "www.smile-care.co.uk");

    rejected("", "empty");
    rejected("localhost", "localhost");
    rejected("smilecare", "single label");
    rejected("127.0.0.1", "bare IPv4");
    rejected("[::1]", "bare IPv6");
    rejected(`${"a".repeat(64)}.com`, "label over 63 chars");
    rejected(`${"a".repeat(250)}.example.com`, "over 253 chars");
    rejected("smile care.com", "invalid character");
    rejected("under_score.com", "invalid character");

    // ── Add / list / remove, scoped by user ──
    console.log("\naddDomain / listDomains / removeDomain");
    const added = await addDomain(userAId, HOST_A);
    check("addDomain returns the created row", "domain" in added, JSON.stringify(added));

    const listA = await listDomains(userAId);
    check("listDomains shows the tenant's own domain", listA.some((d) => d.hostname === HOST_A));

    const listB = await listDomains(userBId);
    check("another tenant does not see it", !listB.some((d) => d.hostname === HOST_A));

    const dupSameUser = await addDomain(userAId, HOST_A);
    check("re-adding the same hostname is rejected", "error" in dupSameUser);

    const dupOtherUser = await addDomain(userBId, HOST_A.toUpperCase());
    check(
      "another tenant cannot claim a taken hostname (case-insensitively)",
      "error" in dupOtherUser,
      JSON.stringify(dupOtherUser),
    );
    check(
      "the rejection does not disclose the holder",
      "error" in dupOtherUser &&
        !dupOtherUser.error.includes(EMAIL_A) &&
        !dupOtherUser.error.includes(slugA),
      "error" in dupOtherUser ? dupOtherUser.error : "",
    );

    // ── resolveHost: only `live` serves ──
    console.log("\nresolveHost status gating");
    const row = await prisma.customDomain.findUnique({ where: { hostname: HOST_A } });
    check("the domain row exists in the DB", row !== null);

    for (const status of ["pending_dns", "pending_certificate", "failed"] as const) {
      await prisma.customDomain.update({ where: { hostname: HOST_A }, data: { status } });
      const resolved = await resolveHost(HOST_A);
      check(`status ${status} resolves to no tenant`, resolved === null);
    }

    await prisma.customDomain.update({ where: { hostname: HOST_A }, data: { status: "live" } });
    const liveResolved = await resolveHost(HOST_A);
    check("status live resolves to the owning tenant", liveResolved?.id === userAId);
    check("resolveHost is case-insensitive", (await resolveHost(HOST_A.toUpperCase()))?.id === userAId);
    check("a host with a port still resolves", (await resolveHost(`${HOST_A}:443`))?.id === userAId);

    check("an unknown host resolves to no tenant", (await resolveHost(HOST_UNKNOWN)) === null);
    check("garbage resolves to no tenant", (await resolveHost("!!!")) === null);
    check("an empty host resolves to no tenant", (await resolveHost("")) === null);

    // Isolation: B's own live domain must resolve to B, never to A.
    await addDomain(userBId, HOST_B);
    await prisma.customDomain.update({ where: { hostname: HOST_B }, data: { status: "live" } });
    check("each live host resolves to its own tenant", (await resolveHost(HOST_B))?.id === userBId);

    // ── HTTP: the rewrite, black-box over a real Host header ──
    console.log("\nHTTP (real server at PROOF_BASE_URL)");
    const reachable = await fetch(BASE, { redirect: "manual" })
      .then(() => true)
      .catch(() => false);

    if (!reachable) {
      skip("custom-domain rewrite", `no server at ${BASE}`);
      skip("unknown host is not served", `no server at ${BASE}`);
      skip("/admin redirects off the custom domain", `no server at ${BASE}`);
    } else {
      const get = (host: string, p = "/") =>
        fetch(`${BASE}${p}`, { headers: { Host: host }, redirect: "manual" });

      const served = await get(HOST_A);
      const html = await served.text();
      check("live custom domain serves 200", served.status === 200, `status ${served.status}`);
      check(
        "it serves that tenant's agent page",
        html.includes("Proof Alpha Clinic"),
        "tenant name not found in HTML",
      );
      check(
        "it does not serve the other tenant",
        !html.includes("Proof Beta Studio"),
        "another tenant's content leaked",
      );

      const unknown = await get(HOST_UNKNOWN);
      check(
        "an unregistered host is not served",
        unknown.status === 404,
        `expected 404, got ${unknown.status}`,
      );

      const admin = await get(HOST_A, "/admin");
      check(
        "/admin on a custom domain redirects to the platform",
        admin.status >= 300 && admin.status < 400,
        `expected a redirect, got ${admin.status}`,
      );
    }
  } finally {
    for (const id of [userAId, userBId].filter(Boolean)) {
      await prisma.customDomain.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

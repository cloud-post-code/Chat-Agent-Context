/**
 * Primary proof for custom-domain-verification (see PROOF.md).
 * Run: npx tsx docs/features/custom-domain-verification/proof.ts
 *
 * Drives the real advance() state machine over a scripted DNS resolver — the
 * only doubled boundary, injected at the seam the way lib/brain.ts doubles its
 * ModelClient. Every status assertion reads the row back from Postgres, so the
 * proof observes persistence rather than trusting a return value.
 *
 * No network. Throwaway rows are deleted at the end.
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

const HOST = "proof-verify-clinic.invalid";
const EMAIL = "proof-domain-verification@example.invalid";
const INGRESS = "ingress.platform.invalid";

/** Errors a real resolver raises, reproduced so the seam behaves like node:dns. */
class DnsError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

/**
 * The scripted resolver: the single doubled boundary. Tests set `txt`, `cname`
 * and `certificate`, and read `lookups` to prove a call was (or was not) made.
 */
function scriptedResolver() {
  const state = {
    txt: [] as string[],
    cname: [] as string[],
    addresses: [] as string[],
    certificate: false,
    throwCode: "" as string,
    lookups: 0,
  };
  return {
    state,
    resolver: {
      async resolveTxt(name: string): Promise<string[][]> {
        state.lookups++;
        if (state.throwCode) throw new DnsError(state.throwCode);
        if (state.txt.length === 0) throw new DnsError("ENODATA");
        void name;
        return state.txt.map((v) => [v]);
      },
      async resolveCname(): Promise<string[]> {
        state.lookups++;
        if (state.throwCode) throw new DnsError(state.throwCode);
        if (state.cname.length === 0) throw new DnsError("ENODATA");
        return state.cname;
      },
      async resolveAddresses(): Promise<string[]> {
        state.lookups++;
        if (state.throwCode) throw new DnsError(state.throwCode);
        return state.addresses;
      },
      async hasCertificate(): Promise<boolean> {
        state.lookups++;
        return state.certificate;
      },
    },
  };
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { createUser } = await import("../../../lib/users");
  const { addDomain } = await import("../../../lib/customDomains");
  const { advance } = await import("../../../lib/customDomains/verify");

  let userId = "";

  try {
    const created = await createUser({
      email: EMAIL,
      name: "Proof Verify Clinic",
      password: "proof-password-1",
    });
    if (!("user" in created)) throw new Error("proof user could not be created");
    userId = created.user.id;

    const added = await addDomain(userId, HOST);
    check("domain added", "domain" in added, JSON.stringify(added));

    const row = async () => {
      const r = await prisma.customDomain.findUnique({ where: { hostname: HOST } });
      if (!r) throw new Error("domain row vanished");
      return r;
    };

    const start = await row();
    const token = start.verificationToken;
    check("a verification token was generated", typeof token === "string" && token.length >= 16);
    check("a new domain starts pending_dns", start.status === "pending_dns", start.status);

    const { state, resolver } = scriptedResolver();
    const run = () => advance(HOST, { resolver, ingressHost: INGRESS });

    // ── No records at all ──
    console.log("\nno records yet");
    state.txt = [];
    await run();
    let r = await row();
    check("stays pending_dns", r.status === "pending_dns", r.status);
    check("records lastCheckedAt", r.lastCheckedAt !== null);
    const missingMsg = r.lastError ?? "";
    check("reports the record as not found yet", missingMsg.length > 0);
    check("the token did not rotate on failure", r.verificationToken === token);

    // ── NXDOMAIN is its own message ──
    console.log("\nNXDOMAIN");
    state.throwCode = "ENOTFOUND";
    await run();
    r = await row();
    const nxMsg = r.lastError ?? "";
    check("stays pending_dns", r.status === "pending_dns", r.status);
    check("NXDOMAIN reads differently from a missing record", nxMsg !== missingMsg, nxMsg);
    state.throwCode = "";

    // ── Wrong TXT value ──
    console.log("\nwrong TXT value");
    state.txt = [`${token}-not-quite`];
    await run();
    r = await row();
    const wrongMsg = r.lastError ?? "";
    check("stays pending_dns", r.status === "pending_dns", r.status);
    check("a near-miss token does not verify", r.verifiedAt === null);
    check(
      "wrong-value reads differently from missing and NXDOMAIN",
      wrongMsg !== missingMsg && wrongMsg !== nxMsg,
      wrongMsg,
    );

    // ── Ownership proved, traffic not pointed ──
    console.log("\nTXT verified, routing missing");
    state.txt = [token];
    state.cname = [];
    state.addresses = [];
    await run();
    r = await row();
    check("does not advance without routing", r.status === "pending_dns", r.status);
    check(
      "the message names routing as the missing piece",
      (r.lastError ?? "").toLowerCase().includes("cname") ||
        (r.lastError ?? "").toLowerCase().includes("point"),
      r.lastError ?? "",
    );

    // ── TXT + CNAME → pending_certificate ──
    console.log("\nTXT + routing verified");
    state.cname = [INGRESS];
    state.certificate = false;
    await run();
    r = await row();
    check("advances to pending_certificate", r.status === "pending_certificate", r.status);
    check("stamps verifiedAt", r.verifiedAt !== null);

    // ── Apex: an A record toward the ingress also routes ──
    console.log("\napex domain (A record instead of CNAME)");
    await prisma.customDomain.update({
      where: { hostname: HOST },
      data: { status: "pending_dns", verifiedAt: null },
    });
    state.cname = [];
    state.addresses = ["203.0.113.10"];
    await run();
    r = await row();
    check("a correctly pointed apex verifies", r.status === "pending_certificate", r.status);

    // ── Certificate present → live ──
    console.log("\ncertificate issued");
    state.certificate = true;
    await run();
    r = await row();
    check("advances to live", r.status === "live", r.status);

    // ── Transient failure must not demote ──
    console.log("\ntransient resolver failure");
    state.throwCode = "ETIMEOUT";
    await run();
    r = await row();
    check("a live domain stays live through a timeout", r.status === "live", r.status);
    check("the timeout is reported", (r.lastError ?? "").length > 0);
    state.throwCode = "";

    // ── Repointed away → demoted ──
    console.log("\ndomain repointed away");
    state.txt = [];
    await run();
    r = await row();
    check("a live domain whose TXT vanished stops being live", r.status !== "live", r.status);

    // ── Rate limiting ──
    console.log("\nrate limiting");
    state.txt = [token];
    state.cname = [INGRESS];
    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await run();
      if (res && typeof res === "object" && "rateLimited" in res && res.rateLimited) {
        limited = true;
        const before = state.lookups;
        await run();
        check("an over-limit check performs no lookup", state.lookups === before);
        break;
      }
    }
    check("repeated checks are rate limited", limited);
  } finally {
    if (userId) {
      await prisma.customDomain.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
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

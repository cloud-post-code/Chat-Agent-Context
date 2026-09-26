/**
 * Live crosscheck for bulk-site-builder (see PROOF.md "Environment And
 * Data"). Runs the REAL extraction pipeline (Playwright + Anthropic) against
 * real sites — not the primary proof, which injects a stub runner.
 *
 * Usage:
 *   npx tsx docs/features/bulk-site-builder/crosscheck.ts --urls a.com,b.com [--base http://localhost:3120] [--keep]
 *
 * Drives the REAL route on a running dev server (the pipeline needs the Next
 * runtime — lib/onboarding/extract.ts loads next/font), authenticated with a
 * session cookie minted for the founding user, who is the operator when
 * OPERATOR_EMAILS is unset. Requires ANTHROPIC_API_KEY on that server and
 * network access to the given sites. Without --keep, every account this run creates is deleted at the
 * end (Prisma cascade removes its rows).
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const KEEP = process.argv.includes("--keep");
const URLS = (argVal("urls") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CONCURRENCY = argVal("concurrency") ? Number(argVal("concurrency")) : undefined;
const BASE = (argVal("base") ?? "http://localhost:3120").replace(/\/$/, "");

if (URLS.length === 0) {
  console.error("Usage: npx tsx docs/features/bulk-site-builder/crosscheck.ts --urls a.com,b.com [--base http://localhost:3120] [--keep]");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required for the live crosscheck (real model calls).");
  process.exit(1);
}

type Site = {
  url: string; status: string; stage?: string; userId?: string; username?: string;
  password?: string; slug?: string; name?: string; lastLine?: string; warnings: string[];
  error?: string;
};
type Build = { id: string; finishedAt?: number; sites: Site[]; dropped: string[] };

/** The same HMAC cookie lib/auth.ts signs, minted for the founding user
 *  (the operator when OPERATOR_EMAILS is unset) so the route sees a real
 *  operator session over plain HTTP. */
function operatorCookie(userId: string): string {
  const secret = process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
  const payload = `${userId}.${Date.now() + 60 * 60 * 1000}`;
  const mac = createHmac("sha256", secret).update(payload).digest("hex");
  return `agent_session=${payload}.${mac}`;
}

async function fetchBuild(base: string, cookie: string, id: string): Promise<Build> {
  const res = await fetch(`${base}/api/admin/bulk-build?buildId=${encodeURIComponent(id)}`, {
    headers: { cookie },
  });
  if (!res.ok) throw new Error(`GET build: ${res.status} ${await res.text()}`);
  return (await res.json()) as Build;
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const founder = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!founder) throw new Error("No users in the database — sign up once first.");
  const cookie = operatorCookie(founder.id);

  console.log(`Starting live build via ${BASE} for: ${URLS.join(", ")}`);
  console.log(`Concurrency: ${CONCURRENCY ?? "server default"} (real runner: Playwright + Anthropic)\n`);
  if (CONCURRENCY) console.log("Note: set BULK_BUILD_CONCURRENCY on the server; --concurrency is informational here.");

  const started = await fetch(`${BASE}/api/admin/bulk-build`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ links: URLS.join("\n") }),
  });
  if (!started.ok) throw new Error(`POST bulk-build: ${started.status} ${await started.text()}`);
  const { buildId } = (await started.json()) as { buildId: string };
  console.log(`Build ${buildId} started`);

  const lastSeen = new Map<string, string>();
  let payload: Build = await fetchBuild(BASE, cookie, buildId);
  while (!payload.finishedAt) {
    await new Promise((r) => setTimeout(r, 3000));
    payload = await fetchBuild(BASE, cookie, buildId);
    for (const site of payload.sites) {
      const key = `${site.stage ?? ""}|${site.lastLine ?? ""}|${site.status}`;
      if (lastSeen.get(site.url) !== key) {
        lastSeen.set(site.url, key);
        console.log(`[${new Date().toISOString()}] ${site.url}: status=${site.status} stage=${site.stage ?? "-"} ${site.lastLine ?? ""}`);
      }
    }
  }


  console.log("\n=== Build result ===");
  if (payload.dropped.length) console.log(`Dropped: ${payload.dropped.join(", ")}`);

  const rows: Record<string, unknown>[] = [];
  for (const site of payload.sites) {
    let counts: Record<string, number> = {};
    let onboarded = false;
    if (site.userId) {
      const [sources, chunks, photos, menuItems, cannedAnswers, agentDirectives, user] = await Promise.all([
        prisma.source.count({ where: { userId: site.userId } }),
        prisma.chunk.count({ where: { userId: site.userId } }),
        prisma.photo.count({ where: { userId: site.userId } }),
        prisma.menuItem.count({ where: { userId: site.userId } }),
        prisma.cannedAnswer.count({ where: { userId: site.userId } }),
        prisma.agentDirective.count({ where: { userId: site.userId } }),
        prisma.user.findUnique({ where: { id: site.userId } }),
      ]);
      counts = { sources, chunks, photos, menuItems, cannedAnswers, agentDirectives };
      onboarded = !!user?.onboardedAt;
    }
    rows.push({
      url: site.url,
      status: site.status,
      name: site.name ?? "",
      username: site.username ?? "",
      password: site.password ?? "",
      slug: site.slug ?? "",
      warnings: site.warnings.join("; "),
      error: site.error ?? "",
      onboarded,
      ...counts,
    });
  }
  console.table(rows);

  if (!KEEP) {
    const ids = payload.sites.map((s) => s.userId).filter((id): id is string => !!id);
    if (ids.length) {
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
      console.log(`\nDeleted ${ids.length} built account(s) (pass --keep to retain them).`);
    }
  } else {
    console.log("\n--keep set: accounts retained. Log in with the username/password above.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

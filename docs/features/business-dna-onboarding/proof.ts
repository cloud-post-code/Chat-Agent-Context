/**
 * Proof: Business DNA onboarding — one startJob(url) call runs the WHOLE
 * pipeline autonomously (no advanceJob gating), produces the four
 * brand-identity fields grounded in the crawled pages, supports per-user
 * reattach, refuses duplicate concurrent starts, and never fabricates.
 *
 * Behavioral: serves a fixture site over local HTTP, then drives
 * lib/onboarding/jobs.ts for real (real Playwright crawl, real model calls).
 * Requires ANTHROPIC_API_KEY and the repo DATABASE_URL (knowledge stage
 * persists Source/Chunk rows). Uses a throwaway userId so tenant data is
 * untouched; created rows are removed at the end.
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ROOT = join(import.meta.dirname, "../..", "..");
const FIXTURES = join(import.meta.dirname, "proof/fixtures/site");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function serveFixtures(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = req.url === "/" ? "/index.html" : (req.url ?? "/index.html");
    try {
      const body = readFileSync(join(FIXTURES, path.replace(/^\//, "")));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() });
    });
  });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("PROOF BLOCKED: ANTHROPIC_API_KEY is required (model-only extraction).");
    process.exit(1);
  }

  const jobs = await import(join(ROOT, "lib/onboarding/jobs.ts"));
  const site = await serveFixtures();
  const userId = `proof-dna-${randomUUID()}`;

  try {
    console.log("1) single autonomous run — no advance gating");
    const job = jobs.startJob(userId, site.url);
    check("startJob returns a job", !!job?.id);

    // The old flow required advanceJob() between stages; the DNA flow must
    // reach "done" from startJob alone.
    const deadline = Date.now() + 5 * 60_000;
    let payload = jobs.jobPayload(job);
    while (payload.phase !== "done" && payload.phase !== "failed" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      payload = jobs.jobPayload(jobs.getJob(job.id, userId));
    }
    check("job reaches phase done without advanceJob", payload.phase === "done",
      `phase=${payload.phase} error=${payload.error ?? ""}`);

    console.log("2) reattach + duplicate suppression");
    check("getActiveJobForUser exports", typeof jobs.getActiveJobForUser === "function");
    if (typeof jobs.getActiveJobForUser === "function") {
      const again = jobs.getActiveJobForUser(userId);
      check("per-user lookup returns the same job", again?.id === job.id,
        `got ${again?.id}`);
    }
    const dup = jobs.startJob(userId, site.url);
    check("second start for same user does not create a parallel job",
      dup.id === job.id || jobs.getActiveJobForUser?.(userId)?.id === dup.id);

    console.log("3) Business DNA fields, grounded in the fixture site");
    const dna = payload.dna;
    check("payload carries a dna object", !!dna);
    if (dna) {
      check("summary is 2+ sentences and names the business",
        typeof dna.summary === "string" && /harbor/i.test(dna.summary) &&
        dna.summary.split(/[.!?]/).filter((s: string) => s.trim()).length >= 2,
        String(dna.summary).slice(0, 120));
      check("tagline present with extracted|suggested flag",
        typeof dna.tagline === "string" && dna.tagline.length > 0 &&
        (dna.taglineSource === "extracted" || dna.taglineSource === "suggested"));
      check("3–5 brand values",
        Array.isArray(dna.values) && dna.values.length >= 3 && dna.values.length <= 5,
        JSON.stringify(dna.values));
      check("values grounded in about-page copy (transparency/hospitality/family growers)",
        Array.isArray(dna.values) &&
        dna.values.some((v: string) => /transparen|honest|hospitalit|family|snobbery|afford/i.test(v)));
      check("tone of voice describes the writing style",
        typeof dna.tone === "string" && dna.tone.length >= 20);
    }

    console.log("4) never fabricate — fixture omits phone and street address");
    check("no phone invented", !payload.step1?.company_phone_number);
    check("email extracted verbatim",
      payload.step1?.company_email === "hello@harborandvine.example",
      String(payload.step1?.company_email));

    console.log("5) sparse tolerance — no photos on fixture, job still done");
    check("imagery empty, not failed",
      payload.phase === "done" && (payload.stepImages?.images ?? []).length === 0);

    console.log("6) theme extracted from fixture CSS");
    check("primary color found", !!payload.step2?.themeColors?.primary,
      JSON.stringify(payload.step2?.themeColors));
  } finally {
    site.close();
    // Remove rows the knowledge stage persisted for the throwaway user.
    try {
      const { prisma } = await import(join(ROOT, "lib/db.ts"));
      await prisma.chunk.deleteMany({ where: { source: { userId } } }).catch(() => {});
      await prisma.source.deleteMany({ where: { userId } });
      await prisma.$disconnect();
    } catch { /* db cleanup is best-effort */ }
  }

  if (failures) {
    console.error(`\nPROOF FAILED: ${failures} check(s)`);
    process.exit(1);
  }
  console.log("\nPROOF PASSED");
}

main().catch((err) => {
  console.error("PROOF ERRORED:", err);
  process.exit(1);
});

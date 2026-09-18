/**
 * Primary proof for the live ingestion feed (docs/features/live-ingestion-feed).
 *
 *   PROOF_BASE_URL=http://localhost:3100 DATABASE_URL=... \
 *     npx tsx docs/features/live-ingestion-feed/proof/live-feed.ts
 *
 * Against a RUNNING app server, serves the deterministic fixture site from
 * docs/features/guided-onboarding/proof/fixtures/site, signs up a fresh user,
 * and drives the real onboarding HTTP surface — same harness as that
 * feature's proof.ts, reused rather than reinvented.
 *
 * This proof is about OBSERVABILITY, not extraction: it asserts what the feed
 * shows WHILE the knowledge stage runs, and that a user who leaves onboarding
 * can still see it. It samples /status during the run rather than only
 * reading the end state, because "the feed looked frozen" is a claim about
 * intermediate states that a terminal-state assertion cannot catch.
 *
 * Expected HTTP contract (pinned here; the implementation must satisfy it):
 *   POST /api/admin/onboarding/status {}            -> the SESSION's active job,
 *                                                      no jobId supplied; 404 when
 *                                                      the user has none running
 *   GET  /api/admin/onboarding/status?jobId=...     -> unchanged, still tenant-scoped
 * The payload gains the liveness fields the feed renders:
 *   { log[], progress, phase, chunksSoFar?, startedAt?|elapsedMs? }
 * and must still omit the internal crawl state (crawler/home/extras).
 *
 * Prints PROOF PASS or exits 1.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.PROOF_BASE_URL || "http://localhost:3100";
const FIXTURE_PORT = Number(process.env.PROOF_FIXTURE_PORT || 4174);
// Reuse the guided-onboarding fixture site: same deterministic contents.
const FIXTURE_ROOT = join(
  __dirname, "..", "..", "guided-onboarding", "proof", "fixtures", "site",
);
const SITE = `http://localhost:${FIXTURE_PORT}`;
const prisma = new PrismaClient();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};
/**
 * The fixture site, served with a per-request delay. The delay is the point:
 * a fast localhost origin never reproduces the silent gaps that made the real
 * feed look frozen, so the proof needs pages that take a beat to answer.
 */
function startFixtureSite(delayMs: number): Promise<() => void> {
  const server = createServer(async (req, res) => {
    let path = (req.url || "/").split("?")[0];
    if (path === "/") path = "/index.html";
    if (path === "/feed" || path === "/rss.xml") path = "/feed.xml";
    const file = normalize(join(FIXTURE_ROOT, path));
    if (!file.startsWith(FIXTURE_ROOT)) { res.writeHead(403).end(); return; }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    try {
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "text/plain" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(FIXTURE_PORT, () => resolve(() => server.close())));
}

class Jar {
  cookies = new Map<string, string>();
  absorb(res: Response) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
}
async function get(jar: Jar, path: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: { Cookie: jar.header() } });
  jar.absorb(res);
  return { res, text: await res.text() };
}
async function postJson(jar: Jar, path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST", redirect: "manual",
    headers: { "Content-Type": "application/json", Cookie: jar.header() },
    body: JSON.stringify(body),
  });
  jar.absorb(res);
  let json: any = null;
  try { json = await res.clone().json(); } catch { /* non-JSON */ }
  return { res, json };
}
async function signupForm(jar: Jar, fields: Record<string, string>) {
  const { text } = await get(jar, "/signup");
  const action = text.match(/name="(\$ACTION_ID_[a-f0-9]+)"/)?.[1];
  if (!action) throw new Error("signup form action id not found");
  const body = new FormData();
  body.append(action, "");
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(`${BASE}/signup`, {
    method: "POST", redirect: "manual", headers: { Cookie: jar.header() }, body,
  });
  jar.absorb(res);
  return res;
}
async function status(jar: Jar, jobId: string) {
  const { json } = await postJson(jar, "/api/admin/onboarding/status", { jobId });
  return json;
}
async function pollJob(jar: Jar, jobId: string, want: string[], timeoutMs = 180_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await status(jar, jobId);
    if (want.includes(s?.phase) || s?.phase === "failed") return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`onboarding job did not reach ${want.join("/")} in time`);
}

/** One observation of the running job, as the polling UI would see it. */
type Sample = { at: number; phase: string; progress: number; log: string[]; chunksSoFar?: number; raw: any };

async function main() {
  // ~700ms/page: slow enough that the knowledge stage has real quiet gaps.
  const stop = await startFixtureSite(Number(process.env.PROOF_PAGE_DELAY_MS || 700));
  const stamp = Date.now();
  const email = `livefeed-${stamp}@proof.local`;
  const slug = `livefeed-${stamp}`;
  const jar = new Jar();

  try {
    console.log("== fresh user reaches the knowledge stage");
    await signupForm(jar, { email, password: "proof-pass-1234", name: "Live Feed Proof", slug });
    check("fresh user exists", !!(await prisma.user.findUnique({ where: { email } })));

    const start = await postJson(jar, "/api/admin/onboarding/start", { url: SITE });
    check("start returns a jobId", !!start.json?.jobId, JSON.stringify(start.json));
    const jobId = start.json.jobId;
    await pollJob(jar, jobId, ["core-done"]);

    // Straight to knowledge — this feature is about that stage only.
    const adv = await postJson(jar, "/api/admin/onboarding/advance", {
      jobId, stage: "knowledge", extractors: ["blog", "testimonials", "team", "sweep"],
    });
    check("advance to knowledge accepted", adv.res.status === 200, String(adv.res.status));

    console.log("== sampling the feed WHILE the stage runs");
    // Sample fast and continuously: the claim under test is about what the
    // user sees between events, so intermediate states are the evidence.
    const samples: Sample[] = [];
    const deadline = Date.now() + 240_000;
    let phase = "";
    while (Date.now() < deadline) {
      const s = await status(jar, jobId);
      if (!s) break;
      samples.push({
        at: Date.now(), phase: s.phase, progress: s.progress ?? 0,
        log: s.log ?? [], chunksSoFar: s.chunksSoFar, raw: s,
      });
      phase = s.phase;
      if (phase === "done" || phase === "failed") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    check("knowledge stage completed", phase === "done",
      phase === "failed" ? samples.at(-1)?.raw?.error : phase);
    check("feed was sampled during the run", samples.length > 5, `${samples.length} samples`);

    const final = samples.at(-1)!;
    const allLines: string[] = final.log;

    console.log("== per-URL lines");
    // The fixture site has 12 html pages and a 9-entry sitemap; a run that
    // reads them must say so, page by page.
    const pageLines = allLines.filter((l) => /^Reading /i.test(l));
    check("per-page activity lines appear in the feed",
      pageLines.length >= 5, `${pageLines.length} page lines`);
    const distinct = new Set(pageLines);
    check("page lines name distinct pages (not one repeated line)",
      distinct.size >= 5, `${distinct.size} distinct`);
    // Lines are user-facing prose, not raw URLs or dev log output.
    check("page lines are prose, not bare URLs",
      pageLines.every((l) => !/^https?:\/\//i.test(l)),
      pageLines.find((l) => /^https?:\/\//i.test(l)) || "");
    // Attributable to the category doing the work.
    const known = /blog|testimonial|team|about|sitemap|sweep|page|post|review|bio/i;
    check("the run's activity is attributable to categories",
      allLines.some((l) => known.test(l)));

    console.log("== per-chunk counts during the run");
    const withCounts = samples.filter((s) => typeof s.chunksSoFar === "number");
    check("status reports a running chunk total while running",
      withCounts.length > 0, `${withCounts.length}/${samples.length} samples carried chunksSoFar`);
    const counts = withCounts.map((s) => s.chunksSoFar!);
    check("the running total never decreases",
      counts.every((c, i) => i === 0 || c >= counts[i - 1]), JSON.stringify(counts.slice(0, 12)));
    // It must actually be reported BEFORE the end, or it is not "live".
    const preDone = withCounts.filter((s) => s.phase !== "done");
    check("a chunk total is visible before the stage finishes",
      preDone.some((s) => (s.chunksSoFar ?? 0) > 0),
      JSON.stringify(preDone.map((s) => s.chunksSoFar).slice(0, 12)));
    check("the running total agrees with the final chunkCount",
      (final.raw.chunkCount ?? 0) === (final.chunksSoFar ?? final.raw.chunkCount ?? 0),
      `chunkCount=${final.raw.chunkCount} chunksSoFar=${final.chunksSoFar}`);

    console.log("== no silent gaps");
    // The anti-frozen assertion at the API level: across the whole run, the
    // feed must not go long stretches with nothing new to show. Either a new
    // log line or a moved progress value counts as movement; elapsed-time
    // heartbeat is proven client-side in feed-liveness.ts.
    let worstGapMs = 0;
    let lastChange = samples[0]?.at ?? Date.now();
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const moved = b.log.length !== a.log.length || b.progress !== a.progress ||
        b.chunksSoFar !== a.chunksSoFar;
      if (moved) lastChange = b.at;
      worstGapMs = Math.max(worstGapMs, b.at - lastChange);
    }
    // A minute of a completely unchanged payload is what "frozen" looked like.
    check("no 60s stretch where the feed payload never changed",
      worstGapMs < 60_000, `worst gap ${Math.round(worstGapMs / 1000)}s`);

    console.log("== elapsed time is derivable for the heartbeat");
    check("status carries a stage start time or elapsed reading",
      samples.some((s) => s.raw.startedAt != null || s.raw.elapsedMs != null),
      JSON.stringify({ startedAt: final.raw.startedAt, elapsedMs: final.raw.elapsedMs }));

    console.log("== payload stays clean and bounded");
    check("internal crawl state is never serialized",
      final.raw.crawler === undefined && final.raw.home === undefined &&
      final.raw.extras === undefined);
    const biggest = Math.max(...samples.map((s) => JSON.stringify(s.raw).length));
    check("poll payload stays bounded as the log grows",
      biggest < 512_000, `${biggest} bytes`);
    check("log respects the 400-line cap",
      allLines.length <= 400, `${allLines.length} lines`);
    // The cap must not have cost the user the outcomes.
    check("final summary survived the run",
      allLines.some((l) => /Saved \d+ knowledge chunk/i.test(l)));

    console.log("== resumable from /admin/chat");
    // A second run, left mid-flight, is what a user who clicks Continue has.
    const jar2 = new Jar();
    const email2 = `livefeed2-${stamp}@proof.local`;
    await signupForm(jar2, {
      email: email2, password: "proof-pass-1234", name: "Live Feed Proof 2", slug: `${slug}-b`,
    });
    const start2 = await postJson(jar2, "/api/admin/onboarding/start", { url: SITE });
    const jobId2 = start2.json.jobId;
    await pollJob(jar2, jobId2, ["core-done"]);
    await postJson(jar2, "/api/admin/onboarding/advance", {
      jobId: jobId2, stage: "knowledge", extractors: ["blog", "team", "sweep"],
    });
    await postJson(jar2, "/api/admin/onboarding/complete", { mode: "site" });

    // The client has navigated away and holds NO jobId. The session alone
    // must be enough to find the job that is still running.
    const active = await postJson(jar2, "/api/admin/onboarding/status", {});
    check("session's active job is discoverable without a jobId",
      active.res.status === 200 && !!active.json, String(active.res.status));
    check("it is the job that is actually running",
      active.json?.id === jobId2 || active.json?.jobId === jobId2,
      JSON.stringify({ got: active.json?.id ?? active.json?.jobId, want: jobId2 }));
    check("the resumed view carries the same live feed",
      Array.isArray(active.json?.log) && active.json.log.length > 0,
      `${active.json?.log?.length ?? 0} lines`);

    // Tenant scoping: user 1's session must never see user 2's job.
    const crossById = await postJson(jar, "/api/admin/onboarding/status", { jobId: jobId2 });
    check("another user's job is not readable by id", crossById.res.status === 404,
      String(crossById.res.status));
    const crossActive = await postJson(jar, "/api/admin/onboarding/status", {});
    check("the active-job lookup is tenant-scoped",
      crossActive.res.status === 404 ||
      (crossActive.json?.id ?? crossActive.json?.jobId) !== jobId2,
      JSON.stringify(crossActive.json?.id ?? crossActive.json?.jobId));

    // The chat page itself must not blind the user to the running job.
    const chat = await get(jar2, "/admin/chat");
    check("chat page loads for the user with a running job", chat.res.status === 200,
      String(chat.res.status));

    // And extraction must have kept going the whole time the user was away.
    const resumedDone = await pollJob(jar2, jobId2, ["done"], 240_000);
    check("extraction completed after the user left onboarding",
      resumedDone.phase === "done", resumedDone.error || resumedDone.phase);
    check("chunks were saved for the user who left",
      (resumedDone.chunkCount ?? 0) > 0, String(resumedDone.chunkCount));

    console.log("== no running job -> nothing to show");
    const jar3 = new Jar();
    const email3 = `livefeed3-${stamp}@proof.local`;
    await signupForm(jar3, {
      email: email3, password: "proof-pass-1234", name: "Live Feed Proof 3", slug: `${slug}-c`,
    });
    const none = await postJson(jar3, "/api/admin/onboarding/status", {});
    check("a user with no running job gets no active job", none.res.status === 404,
      String(none.res.status));
  } finally {
    stop();
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`PROOF FAIL: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("PROOF PASS: feed streams pages and chunk counts live, never goes 60s unchanged, and resumes from /admin/chat");
}

main().catch((err) => {
  console.error(`PROOF FAIL: ${err?.stack || err}`);
  process.exit(1);
});

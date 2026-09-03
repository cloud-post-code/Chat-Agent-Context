/**
 * Primary proof for guided onboarding (docs/features/guided-onboarding).
 *
 *   PROOF_BASE_URL=http://localhost:3100 DATABASE_URL=... \
 *     npx tsx docs/features/guided-onboarding/proof.ts
 *
 * Against a RUNNING app server it serves the deterministic fixture site from
 * proof/fixtures/site on a local port, signs up a fresh user, and drives the
 * onboarding HTTP surface end to end: first-login gating, URL extraction of
 * profile + theme + knowledge, editability (a corrected field wins), the
 * step-3 extraction report reconciled against the fixture's known contents,
 * persistence into the right tables, the manual path, and that a completed
 * user never sees onboarding again. Prints PROOF PASS or exits 1.
 *
 * Expected HTTP contract (pinned here; the implementation must satisfy it).
 * The flow is STAGED, mirroring the chat UI: core info first (fast), then
 * theme on request, then only the knowledge extractions the user selected.
 *   GET  /admin/onboarding                          -> chat onboarding page (200) for a
 *                                                      logged-in, not-yet-onboarded user
 *   GET  /admin (dashboard route)                   -> routes a not-yet-onboarded
 *                                                      user to onboarding
 *   POST /api/admin/onboarding/start   {url}        -> { jobId }; runs the core stage
 *   GET  /api/admin/onboarding/status?jobId=...     -> { phase, progress, step1?, step2?,
 *                                                      chunkCount?, report? }; phases
 *                                                      core-done / theme-done / done
 *   POST /api/admin/onboarding/advance {jobId, stage: "theme" | "knowledge", extractors?}
 *   POST /api/admin/onboarding/save    {profile?, theme?} -> 200; persists what's sent
 *   POST /api/admin/onboarding/complete {mode}      -> 200; marks user onboarded
 * `report` must include per-extraction details (see assertions below).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.PROOF_BASE_URL || "http://localhost:3100";
const FIXTURE_PORT = Number(process.env.PROOF_FIXTURE_PORT || 4173);
const FIXTURE_ROOT = join(__dirname, "proof", "fixtures", "site");
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
function startFixtureSite(): Promise<() => void> {
  const server = createServer(async (req, res) => {
    let path = (req.url || "/").split("?")[0];
    if (path === "/") path = "/index.html";
    if (path === "/feed" || path === "/rss.xml") path = "/feed.xml";
    const file = normalize(join(FIXTURE_ROOT, path));
    if (!file.startsWith(FIXTURE_ROOT)) { res.writeHead(403).end(); return; }
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
  // Reuses the multi-tenant proof's no-JS server-action protocol.
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
/** Poll until the job reaches one of the wanted phases (or fails). */
async function pollJob(jar: Jar, jobId: string, want: string[], timeoutMs = 180_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { json } = await postJson(jar, `/api/admin/onboarding/status`, { jobId });
    const status = json ?? (await get(jar, `/api/admin/onboarding/status?jobId=${jobId}`)).text;
    const s = typeof status === "string" ? JSON.parse(status) : status;
    if (want.includes(s?.phase) || s?.phase === "failed") return s;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`onboarding job did not reach ${want.join("/")} in time`);
}

async function main() {
  const stop = await startFixtureSite();
  const stamp = Date.now();
  const email = `onboard-${stamp}@proof.local`;
  const slug = `onboard-${stamp}`;
  const jar = new Jar();

  try {
    console.log("== signup + first-login gating");
    await signupForm(jar, { email, password: "proof-pass-1234", name: "Onboard Proof", slug });
    const user = await prisma.user.findUnique({ where: { email } });
    check("fresh user exists", !!user);
    const dash = await get(jar, "/admin/dashboard");
    const onboardingPage = await get(jar, "/admin/onboarding");
    check("onboarding page renders for new user", onboardingPage.res.status === 200 &&
      /onboarding/i.test(onboardingPage.text));
    check("new user is steered to onboarding, not the dashboard",
      [307, 302, 303].includes(dash.res.status)
        ? /onboarding/.test(dash.res.headers.get("location") || "")
        : /onboarding/i.test(dash.text));
    check("chat entry asks for the website link and offers manual setup",
      /website link/i.test(onboardingPage.text) && /manually/i.test(onboardingPage.text));

    console.log("== staged extraction run against fixture site");
    const start = await postJson(jar, "/api/admin/onboarding/start", { url: SITE });
    check("start returns a jobId", !!start.json?.jobId, JSON.stringify(start.json));
    const jobId = start.json.jobId;
    const core = await pollJob(jar, jobId, ["core-done"]);
    check("core stage finished first (contact form before any crawl)",
      core.phase === "core-done", core.error || core.phase);

    console.log("== step 1: core info (no fabrication)");
    const s1 = core.step1 || {};
    check("company name", s1.company_name === "Acme Rivet Co.", s1.company_name);
    check("address", /412 Foundry Lane/.test(s1.company_address || ""), s1.company_address);
    check("phone", /218.*555.*0147/.test(s1.company_phone_number || ""), s1.company_phone_number);
    check("email", s1.company_email === "hello@acmerivet.example", s1.company_email);
    const hours = s1.company_hours || {};
    check("weekday hours extracted", /8/.test(String(hours.monday ?? hours.Monday ?? s1.company_hours ?? "")));
    check("saturday empty (site says closed)",
      !hours.saturday && !/saturday.*\d/i.test(String(s1.company_hours || "")));
    check("owner name empty — site never states one (anti-fabrication)",
      !s1.owner_name, s1.owner_name);

    console.log("== contact review saves first, edited value wins");
    const edited = { ...s1, owner_name: "Priya Raman (edited in review)" };
    const saveProfile = await postJson(jar, "/api/admin/onboarding/save", { profile: edited });
    check("profile-only save accepted", saveProfile.res.status === 200, String(saveProfile.res.status));

    console.log("== step 2: theme stage runs on request, constrained to supported options");
    const adv1 = await postJson(jar, "/api/admin/onboarding/advance", { jobId, stage: "theme" });
    check("advance to theme accepted", adv1.res.status === 200, String(adv1.res.status));
    const themed = await pollJob(jar, jobId, ["theme-done"]);
    check("theme stage finished", themed.phase === "theme-done", themed.error || themed.phase);
    const s2 = themed.step2 || {};
    // lib/fonts.ts can't be imported outside Next (next/font). The curated
    // keys are read from the FontKey union in the source instead.
    const fontsSrc = await readFile(join(__dirname, "..", "..", "..", "lib", "fonts.ts"), "utf8");
    const union = fontsSrc.match(/export type FontKey =([\s\S]*?);/)?.[1] ?? "";
    const fontKeys = [...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);
    check("themeBodyFont is a curated key", fontKeys.includes(s2.themeBodyFont), s2.themeBodyFont);
    check("themeRadius is a supported preset", ["sharp", "rounded", "pill"].includes(s2.themeRadius), s2.themeRadius);
    check("themeHeadingWeight supported", ["", "500", "600", "700", "800"].includes(String(s2.themeHeadingWeight ?? "")), String(s2.themeHeadingWeight));
    const colors = typeof s2.themeColors === "string" ? JSON.parse(s2.themeColors) : s2.themeColors || {};
    check("themeColors are hex values", Object.values(colors).every((v) => /^#[0-9a-fA-F]{3,8}$/.test(String(v))));
    check("brand color extracted from the fixture css", JSON.stringify(colors).toLowerCase().includes("0f4c81"));
    check("logo stored via app uploads", /^\/api\/uploads\//.test(s2.themeLogo || ""), s2.themeLogo);

    console.log("== step 3: user-selected knowledge extraction");
    const saveTheme = await postJson(jar, "/api/admin/onboarding/save", { theme: s2 });
    check("theme-only save accepted", saveTheme.res.status === 200, String(saveTheme.res.status));
    const adv2 = await postJson(jar, "/api/admin/onboarding/advance", {
      jobId, stage: "knowledge", extractors: ["blog", "testimonials", "team", "sweep"],
    });
    check("advance to knowledge accepted", adv2.res.status === 200, String(adv2.res.status));
    const final = await pollJob(jar, jobId, ["done"]);
    check("knowledge stage finished", final.phase === "done", final.error || final.phase);
    const rep = final.report || {};
    check("chunk count reported and > 0", (final.chunkCount ?? 0) > 0, String(final.chunkCount));
    // (a) blog: 3 unique posts, feed reconciliation, pagination walked, no double-saves
    check("blog existed", rep.blog?.existed === true);
    check("blog posts saved = 3", rep.blog?.postsSaved === 3, String(rep.blog?.postsSaved));
    check("blog unique URLs found = 3", rep.blog?.uniqueUrls === 3, String(rep.blog?.uniqueUrls));
    check("blog count reconciles with feed", rep.blog?.feedCount === 3, String(rep.blog?.feedCount));
    check("pagination page walked", (rep.blog?.paginationPages || []).some((p: string) => p.includes("page2")),
      JSON.stringify(rep.blog?.paginationPages));
    // (b) testimonials: 3 genuine, never merged, image URL recorded not downloaded
    check("testimonials found = 3 (press mention excluded)", rep.testimonials?.count === 3,
      String(rep.testimonials?.count));
    const quotes: string[] = (rep.testimonials?.items || []).map((t: any) => String(t.quote || ""));
    check("testimonials not merged (3 distinct quotes)", new Set(quotes.map((q) => q.slice(0, 80))).size === 3);
    check("marta's image recorded as URL", (rep.testimonials?.items || [])
      .some((t: any) => /faces\/marta\.jpg/.test(t.imageUrl || "")));
    // (c) team: one block per person, duplicate bio skipped, embeddings present
    check("team page existed", rep.team?.existed === true);
    check("team blocks = 3 (duplicate Priya block skipped)", rep.team?.blocks === 3, String(rep.team?.blocks));
    check("team embedding dimension reported", (rep.team?.embeddingDim ?? 0) > 0, String(rep.team?.embeddingDim));
    // (d) sitemap sweep covers services.html
    check("sitemap sweep captured the services page",
      JSON.stringify(rep.sweep?.pages || rep.sweep || {}).includes("services"));

    console.log("== persistence in the right tables");
    const done = await postJson(jar, "/api/admin/onboarding/complete", { mode: "site" });
    check("complete accepted", done.res.status === 200, String(done.res.status));
    const profile = await prisma.profile.findUnique({ where: { userId: user!.id } });
    check("Profile.company_name persisted", profile?.company_name === "Acme Rivet Co.");
    check("Profile.owner_name is the edited value", profile?.owner_name === "Priya Raman (edited in review)");
    const theme = await prisma.themeConfig.findUnique({ where: { userId: user!.id } });
    check("ThemeConfig persisted with supported radius", ["sharp", "rounded", "pill"].includes(theme?.themeRadius || ""));
    const persona = await prisma.personaConfig.findUnique({ where: { userId: user!.id } });
    check("logo persisted on PersonaConfig.company_logo", /^\/api\/uploads\//.test(persona?.company_logo || ""));
    const chunkRows = await prisma.chunk.count({ where: { userId: user!.id } });
    check("Chunk rows match reported count", chunkRows === final.chunkCount, `${chunkRows} vs ${final.chunkCount}`);
    const embedded = await prisma.chunk.count({ where: { userId: user!.id, embedding: { not: null } } });
    check("chunks are embedded via existing pipeline", embedded === chunkRows, `${embedded}/${chunkRows}`);
    const offDomain = await prisma.source.count({
      where: { userId: user!.id, url: { not: { startsWith: SITE } }, type: "link" },
    });
    check("crawl stayed on the entered domain", offDomain === 0, String(offDomain));

    console.log("== onboarded user never sees the flow again");
    const dash2 = await get(jar, "/admin/dashboard");
    check("dashboard now reachable", dash2.res.status === 200 && !/data-onboarding/i.test(dash2.text));
    const ob2 = await get(jar, "/admin/onboarding");
    check("onboarding no longer offered",
      [302, 303, 307].includes(ob2.res.status) || !/api\/admin\/onboarding\/start/.test(ob2.text));

    console.log("== manual path reaches the same forms, empty");
    const jarB = new Jar();
    const emailB = `manual-${stamp}@proof.local`;
    await signupForm(jarB, { email: emailB, password: "proof-pass-1234", name: "Manual Proof", slug: `manual-${stamp}` });
    const obB = await get(jarB, "/admin/onboarding");
    check("manual option present for second user", /manually/i.test(obB.text));
    check("manual forms start empty", !/Acme Rivet/.test(obB.text));
    const doneB = await postJson(jarB, "/api/admin/onboarding/complete", { mode: "manual" });
    check("manual complete accepted", doneB.res.status === 200, String(doneB.res.status));
    const dashB = await get(jarB, "/admin/dashboard");
    check("manual user lands on dashboard afterwards", dashB.res.status === 200 && !/data-onboarding/i.test(dashB.text));
  } finally {
    stop();
    await prisma.$disconnect();
  }

  console.log(failures === 0 ? "\nPROOF PASS" : `\nPROOF FAIL — ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROOF FAIL —", err);
  process.exit(1);
});

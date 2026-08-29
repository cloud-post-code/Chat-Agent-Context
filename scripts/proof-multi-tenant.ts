/**
 * Primary proof for the multi-tenant conversion (docs/features/multi-tenant-conversion).
 *
 *   PROOF_BASE_URL=http://localhost:3100 DATABASE_URL=... npx tsx scripts/proof-multi-tenant.ts
 *
 * Against a RUNNING server it exercises the real HTTP surface end to end:
 * two fresh signups, one distinct source ingested each through the admin
 * ingest form (no-JS server-action POSTs), a chat on each agent page that
 * must answer only from that user's own source, cross-tenant probes with the
 * other tenant's resource ids, the public directory, and the founding user's
 * intact pre-existing data. Prints PROOF PASS or exits 1.
 *
 * The chat model may be a mock that ECHOES the prompt's retrieved KNOWLEDGE
 * section (see the proof run's mock-anthropic server): that makes the
 * isolation assertion strict — a fact can only appear in an answer if
 * retrieval surfaced it for that tenant.
 */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.PROOF_BASE_URL || "http://localhost:3100";
const prisma = new PrismaClient();

const FACT_A = "ALEXANDRITE-9931";
const FACT_B = "OBSIDIAN-4417";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
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
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function get(jar: Jar | null, path: string) {
  const res = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: jar ? { Cookie: jar.header() } : {},
  });
  jar?.absorb(res);
  return { res, html: await res.text() };
}

async function postForm(jar: Jar | null, path: string, fields: Record<string, string>) {
  // The no-JS server-action protocol: the SSR form posts multipart/form-data
  // back to its own URL, carrying the hidden $ACTION_ID_<hash> field.
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: jar ? { Cookie: jar.header() } : {},
    body,
  });
  jar?.absorb(res);
  return { res, text: await res.text() };
}

/** Every <form>…</form> block in a page. */
function formsOf(html: string): string[] {
  return html.match(/<form[\s\S]*?<\/form>/g) ?? [];
}

/** The no-JS server-action field name ($ACTION_ID_<hash>) inside a form. */
function actionFieldOf(form: string): string | null {
  const m = form.match(/name="(\$ACTION_ID_[^"]+)"/);
  return m ? m[1] : null;
}

function findForm(html: string, marker: RegExp): string | null {
  return formsOf(html).find((f) => marker.test(f)) ?? null;
}

async function signup(name: string, email: string, password: string): Promise<Jar> {
  const jar = new Jar();
  const { html } = await get(jar, "/signup");
  const form = findForm(html, /name="email"/);
  const action = form && actionFieldOf(form);
  if (!action) throw new Error("signup form/action not found");
  const { res } = await postForm(jar, "/signup", { [action]: "", name, email, password });
  check(`signup ${email}`, res.status === 303, `status ${res.status}`);
  check(`signup ${email} sets a session`, jar.cookies.has("agent_session"));
  return jar;
}

async function login(email: string, password: string): Promise<Jar> {
  const jar = new Jar();
  const { html } = await get(jar, "/admin");
  const form = findForm(html, /name="email"/);
  const action = form && actionFieldOf(form);
  if (!action) throw new Error("login form/action not found");
  const { res } = await postForm(jar, "/admin", { [action]: "", email, password });
  check(`login ${email}`, res.status === 303 && jar.cookies.has("agent_session"), `status ${res.status}`);
  return jar;
}

/** Paste one text source through the dashboard's real Text-tab form. */
async function ingestText(jar: Jar, title: string, text: string) {
  const { html } = await get(jar, "/admin/dashboard?tab=text");
  const form = findForm(html, /name="type"[^>]*value="text"|value="text"[^>]*name="type"/);
  const action = form && actionFieldOf(form);
  if (!action) throw new Error("text ingest form/action not found");
  // A non-redirecting action re-renders the page (200) on the no-JS path;
  // the DB assertions right after this are what prove the ingest landed.
  const { res } = await postForm(jar, "/admin/dashboard?tab=text", {
    [action]: "",
    type: "text",
    title,
    text,
  });
  check(`ingest "${title}" accepted`, res.status === 200 || res.status === 303, `status ${res.status}`);
}

async function chat(slug: string, question: string): Promise<string> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      sessionId: `proof-${slug}`,
      messages: [{ role: "user", content: question }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`chat ${slug}: ${res.status} ${raw.slice(0, 200)}`);
  let out = "";
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.t === "text") out += obj.v;
    } catch {}
  }
  return out;
}

async function main() {
  console.log(`proof: multi-tenant conversion against ${BASE}\n`);

  // ── Founding user: claimed at boot, pre-existing data intact ──
  console.log("· founding user");
  const founder = await prisma.user.findUnique({ where: { id: "founder" } });
  check("founder account exists", !!founder);
  check(
    "founder claimed from env",
    !!founder && founder.email !== "founder@unclaimed.invalid" && founder.passwordHash.startsWith("scrypt:"),
    founder?.email,
  );
  const founderCounts = {
    chunks: await prisma.chunk.count({ where: { userId: "founder" } }),
    sessions: await prisma.chatSession.count({ where: { userId: "founder" } }),
    projects: await prisma.project.count({ where: { userId: "founder" } }),
    entities: await prisma.entity.count({ where: { userId: "founder" } }),
  };
  console.log(`    founder owns: ${JSON.stringify(founderCounts)}`);
  check("founder owns the pre-existing chunks", founderCounts.chunks >= 19);
  check("founder owns the pre-existing chat sessions", founderCounts.sessions >= 21);
  check("founder owns the pre-existing projects", founderCounts.projects >= 10);
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const fj = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const { res } = await get(fj, "/admin/dashboard");
    check("founder reaches their dashboard", res.status === 200);
  }

  // ── Two fresh users ──
  console.log("\n· signup and ingest");
  const jarA = await signup("Alice Proof", "alice@proof.local", "alice-pass-123");
  const jarB = await signup("Bob Proof", "bob@proof.local", "bob-pass-1234");
  const userA = await prisma.user.findUnique({ where: { email: "alice@proof.local" } });
  const userB = await prisma.user.findUnique({ where: { email: "bob@proof.local" } });
  if (!userA || !userB) throw new Error("signup rows missing");
  console.log(`    alice slug=${userA.slug}  bob slug=${userB.slug}`);

  await ingestText(jarA, "Alice's mineral", `Alice's favorite mineral is ${FACT_A}. She keeps a sample on her desk.`);
  await ingestText(jarB, "Bob's mineral", `Bob's favorite mineral is ${FACT_B}. He found it on a volcano hike.`);

  const srcA = await prisma.source.findFirst({ where: { userId: userA.id, type: "text" } });
  const srcB = await prisma.source.findFirst({ where: { userId: userB.id, type: "text" } });
  check("alice's source row is hers", !!srcA && (srcA.rawText ?? "").includes(FACT_A));
  check("bob's source row is his", !!srcB && (srcB.rawText ?? "").includes(FACT_B));
  check(
    "sources were chunked per tenant",
    (await prisma.chunk.count({ where: { userId: userA.id, sourceId: srcA?.id } })) > 0 &&
      (await prisma.chunk.count({ where: { userId: userB.id, sourceId: srcB?.id } })) > 0,
  );

  // ── Each agent page answers only from its own knowledge ──
  console.log("\n· per-tenant chat");
  const answerA = await chat(userA.slug, "What is the favorite mineral?");
  const answerB = await chat(userB.slug, "What is the favorite mineral?");
  console.log(`    alice answer: ${answerA.replace(/\s+/g, " ").slice(0, 140)}…`);
  console.log(`    bob answer:   ${answerB.replace(/\s+/g, " ").slice(0, 140)}…`);
  check("alice's page knows alice's fact", answerA.includes(FACT_A));
  check("alice's page never leaks bob's fact", !answerA.includes(FACT_B));
  check("bob's page knows bob's fact", answerB.includes(FACT_B));
  check("bob's page never leaks alice's fact", !answerB.includes(FACT_A));

  // ── Cross-tenant probes: A's session against B's resource ids ──
  console.log("\n· cross-tenant probes (A's session, B's ids)");
  const bobCard = await prisma.uiCard.findFirst({ where: { userId: userB.id } });
  if (bobCard) {
    const { res } = await get(jarA, `/admin/cards/${bobCard.id}`);
    check("GET /admin/cards/<B's card id> as A → 404", res.status === 404, `status ${res.status}`);
  }

  // The admin mutations are server actions; invoke the real ones over HTTP
  // (no-JS form protocol) with B's ids and prove nothing changed.
  const { html: dashA } = await get(jarA, "/admin/dashboard?tab=text");
  const summaryForm = findForm(dashA, /name="summary"/);
  const summaryAction = summaryForm && actionFieldOf(summaryForm);
  if (summaryAction && srcB) {
    const probe = await postForm(jarA, "/admin/dashboard?tab=text", {
      [summaryAction]: "",
      id: srcB.id,
      summary: "HACKED-BY-ALICE",
    });
    const bobAfter = await prisma.source.findUnique({ where: { id: srcB.id } });
    check(
      "updateSourceSummary(B's id) as A changes nothing",
      !!bobAfter && bobAfter.summary === srcB.summary && bobAfter.summary !== "HACKED-BY-ALICE",
      `status ${probe.res.status}`,
    );
  } else {
    check("updateSourceSummary probe ran", false, "form or B source not found");
  }

  const deleteForm = formsOf(dashA).find((f) => /name="id"/.test(f) && /Delete/.test(f));
  const deleteAction = deleteForm && actionFieldOf(deleteForm);
  if (deleteAction && srcB) {
    await postForm(jarA, "/admin/dashboard?tab=text", { [deleteAction]: "", id: srcB.id });
    const still = await prisma.source.findUnique({ where: { id: srcB.id } });
    check("deleteSource(B's id) as A deletes nothing", !!still);
  } else {
    check("deleteSource probe ran", false, "form or B source not found");
  }

  // Admin API routes refuse anonymous callers outright.
  const anonBuild = await fetch(`${BASE}/api/admin/build-card`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions: "x" }),
  });
  check("POST /api/admin/build-card unauthenticated → 401", anonBuild.status === 401, `status ${anonBuild.status}`);
  const anonGmail = await fetch(`${BASE}/api/admin/gmail/callback`, { redirect: "manual" });
  check("GET /api/admin/gmail/callback unauthenticated → 401", anonGmail.status === 401, `status ${anonGmail.status}`);
  const anonDash = await fetch(`${BASE}/admin/dashboard`, { redirect: "manual" });
  check(
    "GET /admin/dashboard unauthenticated redirects to login",
    anonDash.status >= 300 && anonDash.status < 400,
    `status ${anonDash.status}`,
  );

  // A visitor chatting with an unknown slug gets a 404, not someone's data.
  const badSlug = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: "no-such-agent", sessionId: "x", messages: [{ role: "user", content: "hi" }] }),
  });
  check("POST /api/chat with unknown slug → 404", badSlug.status === 404, `status ${badSlug.status}`);

  // ── Directory lists every agent page ──
  console.log("\n· directory");
  const { html: dir } = await get(null, "/");
  check("directory lists alice", dir.includes(`/a/${userA.slug}`));
  check("directory lists bob", dir.includes(`/a/${userB.slug}`));
  check("directory lists the founder", !!founder && dir.includes(`/a/${founder.slug}`));

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nPROOF PASS" : `\nPROOF FAIL (${failures} failing check(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("proof crashed:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

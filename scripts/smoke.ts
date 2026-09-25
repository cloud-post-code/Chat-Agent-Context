/**
 * Smoke: the key flows against a RUNNING server, over plain HTTP.
 *
 *   PROOF_BASE_URL=http://localhost:3120 npm run smoke
 *
 * signup → login (right and wrong password) → guided onboarding skipped
 * (manual) → dashboard and admin chat
 * render → the public agent page, llms.txt and the A2A agent card serve →
 * /api/a2a refuses an anonymous caller → /api/chat streams NDJSON for the
 * new tenant → /api/booking answers → the account is wiped and deleted, and
 * nothing of it remains. Needs Postgres (via .env) and the server; a chat
 * answer needs ANTHROPIC_API_KEY on the SERVER, otherwise the stream is only
 * checked for shape. Prints SMOKE PASS or exits 1.
 *
 * Every later cleanup phase runs this at its end (see CLAUDE.md).
 */
import { PrismaClient } from "@prisma/client";
import { wipeAccountContent } from "@/lib/accountWipe";

const BASE = (process.env.PROOF_BASE_URL || "http://localhost:3120").replace(/\/$/, "");
const prisma = new PrismaClient();
const stamp = Date.now().toString(36);
const EMAIL = `smoke-${stamp}@example.invalid`;
const PASSWORD = `smoke-pass-${stamp}`;

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
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", headers: jar ? { Cookie: jar.header() } : {} });
  jar?.absorb(res);
  return { res, text: await res.text() };
}
async function postForm(jar: Jar, path: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(`${BASE}${path}`, { method: "POST", redirect: "manual", headers: { Cookie: jar.header() }, body });
  jar.absorb(res);
  return res;
}
/** The no-JS server-action field ($ACTION_ID_<hash>) of the form matching `marker`. */
function actionOf(html: string, marker: RegExp): string | null {
  const form = (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => marker.test(f));
  return form?.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1] ?? null;
}

async function main() {
  console.log(`smoke against ${BASE}\n`);
  const up = await fetch(BASE, { redirect: "manual" }).catch(() => null);
  if (!up) throw new Error(`no server at ${BASE} — start it (npm run dev -- -p 3120) or set PROOF_BASE_URL`);

  // ── signup ──
  const jar = new Jar();
  const { text: signupHtml } = await get(jar, "/signup");
  const signupAction = actionOf(signupHtml, /name="email"/);
  if (!signupAction) throw new Error("signup form not found");
  const signupRes = await postForm(jar, "/signup", { [signupAction]: "", name: `Smoke ${stamp}`, email: EMAIL, password: PASSWORD });
  check("signup redirects and sets a session", signupRes.status === 303 && jar.cookies.has("agent_session"), `status ${signupRes.status}`);
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) throw new Error("signup row missing");
  const sources = await prisma.ingestionSource.findMany({ where: { userId: user.id } });
  check("signup seeds starter ingestion sources, none builtin", sources.length > 0 && sources.every((s) => !s.builtin), `${sources.length} rows`);
  const skip = await fetch(`${BASE}/api/admin/onboarding/complete`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: jar.header() }, body: JSON.stringify({ mode: "manual" }) });
  check("guided onboarding can be skipped (manual mode)", skip.ok, `status ${skip.status}`);

  // ── login (the same credentials, through the real form action) ──
  const fresh = new Jar();
  const { text: loginHtml } = await get(fresh, "/admin");
  const loginAction = actionOf(loginHtml, /name="email"/);
  if (!loginAction) throw new Error("login form not found");
  const loginRes = await postForm(fresh, "/admin", { [loginAction]: "", email: EMAIL, password: PASSWORD });
  check("login redirects and sets a session", loginRes.status === 303 && fresh.cookies.has("agent_session"), `status ${loginRes.status}`);
  const badLogin = new Jar();
  const badRes = await postForm(badLogin, "/admin", { [loginAction]: "", email: EMAIL, password: "wrong-" + PASSWORD });
  check("a wrong password is refused", badRes.status === 303 && !badLogin.cookies.has("agent_session") && (badRes.headers.get("location") ?? "").includes("error"), `status ${badRes.status} → ${badRes.headers.get("location")}`);

  // ── admin ──
  const dash = await get(jar, "/admin/dashboard");
  check("dashboard renders for the new account", dash.res.status === 200 && dash.text.includes("admin-shell"), `status ${dash.res.status}`);
  const chatPage = await get(jar, "/admin/chat");
  check("admin chat renders", chatPage.res.status === 200, `status ${chatPage.res.status}`);
  const anon = await get(null, "/admin/dashboard");
  check("dashboard refuses an anonymous visitor", anon.res.status >= 300 && anon.res.status < 400, `status ${anon.res.status}`);

  // ── public surfaces ──
  const page = await get(null, `/a/${user.slug}`);
  check("public agent page renders", page.res.status === 200, `status ${page.res.status}`);
  const llms = await get(null, `/a/${user.slug}/llms.txt`);
  check("per-tenant llms.txt serves", llms.res.status === 200 && llms.text.length > 0, `status ${llms.res.status}`);
  const rootLlms = await get(null, "/llms.txt");
  check("root llms.txt serves", rootLlms.res.status === 200, `status ${rootLlms.res.status}`);
  const card = await get(null, "/.well-known/agent-card.json");
  let cardOk = false;
  try { cardOk = card.res.status === 200 && typeof JSON.parse(card.text).name === "string"; } catch {}
  check("A2A agent card is valid JSON", cardOk, `status ${card.res.status}`);
  const a2a = await fetch(`${BASE}/api/a2a`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: {} }) });
  check("A2A refuses an anonymous caller", a2a.status === 401 || a2a.status === 403, `status ${a2a.status}`);

  // ── chat ──
  const chat = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: user.slug, sessionId: `smoke-${stamp}`, messages: [{ role: "user", content: "What do you offer?" }] }) });
  const raw = await chat.text();
  const events = raw.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } });
  check("chat streams NDJSON events", chat.status === 200 && events.length > 0 && events.every(Boolean), `status ${chat.status}, ${events.length} events`);
  const errored = events.find((e) => e && e.t === "error");
  check("chat stream reports no error", !errored, errored ? JSON.stringify(errored).slice(0, 160) : "");
  const badSlug = await fetch(`${BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: "no-such-agent", sessionId: "x", messages: [{ role: "user", content: "hi" }] }) });
  check("chat with an unknown slug → 404", badSlug.status === 404, `status ${badSlug.status}`);

  // ── booking ──
  const booking = await fetch(`${BASE}/api/booking?slug=${user.slug}`);
  const bookingBody = await booking.json().catch(() => null);
  check("booking flow endpoint answers for the tenant", booking.status === 200 && bookingBody?.ok === true, `status ${booking.status}`);

  // ── wipe + delete: nothing of the account remains ──
  await wipeAccountContent(user.id);
  const left = await prisma.ingestionSource.count({ where: { userId: user.id } }) + await prisma.chatSession.count({ where: { userId: user.id } }) + await prisma.source.count({ where: { userId: user.id } });
  check("account wipe leaves no content rows", left === 0, `${left} rows`);
  await prisma.user.delete({ where: { id: user.id } });
  check("smoke user deleted", !(await prisma.user.findUnique({ where: { id: user.id } })));

  await prisma.$disconnect();
  console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL (${failures} failing check(s))`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("smoke crashed:", e);
  await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});

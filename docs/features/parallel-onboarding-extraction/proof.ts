/**
 * Primary proof for parallel-onboarding-extraction (see PROOF.md).
 *
 *   npx tsx docs/features/parallel-onboarding-extraction/proof.ts
 *
 * Runs the REAL onboarding job (lib/onboarding/jobs.ts: real Playwright
 * crawler, real extractors, real saves, real graph pass, real database) twice
 * against the guided-onboarding fixture site — once with
 * ONBOARDING_CONCURRENCY=1, once with 4 — and compares them. The one thing
 * faked is the model: `@anthropic-ai/sdk` is swapped for a deterministic
 * stand-in with a fixed latency, so the proof spends no credits, never depends
 * on live model wording, and can count the calls in flight.
 *
 * Needs DATABASE_URL (read from .env) and the Playwright Chromium the app
 * already uses. No app server, no ANTHROPIC_API_KEY.
 */
import Module from "node:module";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// The model is faked below; the key only has to exist. Embeddings stay on the
// local hashed embedder so the proof makes no provider call of any kind.
process.env.ANTHROPIC_API_KEY = "proof-fake-key";
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";
delete process.env.EMBED_PACE_MS;

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── The fake model ──────────────────────────────────────────────────────────

const MODEL_LATENCY_MS = 250;
const SHARED_ENTITY = "Harbor and Rivet Works";
const model = {
  inFlight: 0,
  maxInFlight: 0,
  calls: 0,
  /** Title line of every entity-extraction call, to prove each source is read once. */
  graphTitles: [] as string[],
  reset() {
    this.inFlight = 0; this.maxInFlight = 0; this.calls = 0; this.graphTitles = [];
  },
};

type CreateArgs = { system?: string; messages: { content: unknown }[] };

function fakeReply(args: CreateArgs): string {
  const system = args.system ?? "";
  const content = args.messages[0]?.content;
  const user = typeof content === "string" ? content : JSON.stringify(content);

  if (system.startsWith("You clean one blog/news post")) {
    if (/Older posts|Category:/i.test(user.slice(0, 400)) && user.length < 600) return `{"post":null}`;
    return JSON.stringify({ post: { title: user.slice(0, 60), author: "", date: "", body: user.slice(0, 900) } });
  }
  if (system.startsWith("You find genuine customer testimonials")) {
    return JSON.stringify({ testimonials: [
      { quote: "They delivered every bracket on time.", author: "Marta Ilves", title: "Buyer" },
      { quote: "The salt spray numbers held up in the field.", author: "Deven Okoro", title: "" },
      { quote: "Best forming line we have worked with.", author: "Lucia Ferrand", title: "COO" },
    ] });
  }
  if (system.startsWith("You find the people behind a business")) {
    return JSON.stringify({ people: [
      { name: "Priya Raman", bio: "Founder. Started the first forming line." },
      { name: "Tomas Eide", bio: "Runs the test lab." },
    ] });
  }
  if (system.startsWith("You read text from a business's website and report (1) the services")) {
    return JSON.stringify({
      services: [
        { name: "Bracket forming", description: "Custom titanium brackets." },
        { name: "Salt spray testing", description: "Corrosion testing to spec." },
      ],
      booking: { takesAppointments: false, requirements: [] },
    });
  }
  if (system.startsWith("You distill one page")) {
    // Facts keyed on the page's own text, so every swept page yields distinct
    // chunks and a lost or doubled page changes the comparison below.
    const tag = user.slice(0, 48);
    return JSON.stringify({ title: `Page ${tag}`, facts: [`Fact one about ${tag}.`, `Fact two about ${tag}.`] });
  }
  if (system.includes("write the goals for the AI chat agent")) {
    return JSON.stringify({ goals: ["Get visitors to request a forming quote"] });
  }
  if (system.startsWith("You plan the visual")) return `{"cards":[]}`;
  if (user.startsWith("Extract a small knowledge graph")) {
    const title = user.match(/\nTitle: (.*)\n/)?.[1] ?? "untitled";
    model.graphTitles.push(title);
    // Every source names ONE shared entity, so every concurrent graph write
    // upserts the same row — the collision the per-user lock exists for.
    return JSON.stringify({
      entities: [{ name: SHARED_ENTITY, type: "org" }, { name: `Topic of ${title}`.slice(0, 78), type: "topic" }],
      edges: [{ from: SHARED_ENTITY, to: `Topic of ${title}`.slice(0, 78), relation: "covers" }],
    });
  }
  if (user.startsWith("Below are excerpts")) return "An overview paragraph grounded in the excerpts.";
  return "{}";
}

class FakeAnthropic {
  messages = {
    create: async (args: CreateArgs) => {
      model.calls++;
      model.inFlight++;
      model.maxInFlight = Math.max(model.maxInFlight, model.inFlight);
      try {
        await sleep(MODEL_LATENCY_MS);
        return { content: [{ type: "text", text: fakeReply(args) }] };
      } finally {
        model.inFlight--;
      }
    },
  };
}

// next/font/google only works under Next's compiler (lib/fonts.ts, reached
// through jobs.ts, calls it at load) — stubbed the way filing-eta.ts does.
const fontStub = new Proxy({}, {
  get: (_t, name) => () => ({ className: `font-${String(name)}`, style: { fontFamily: String(name) }, variable: `--f-${String(name)}` }),
});
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const realLoad = (Module as unknown as Loader)._load;
(Module as unknown as Loader)._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/font/google") return fontStub;
  if (request === "@anthropic-ai/sdk") return { __esModule: true, default: FakeAnthropic, Anthropic: FakeAnthropic };
  return realLoad.call(this, request, ...rest);
};

// ── The fixture site, slowed down and instrumented ──────────────────────────

const SITE_ROOT = path.join(root, "docs/features/guided-onboarding/proof/fixtures/site");
const PAGE_DELAY_MS = 300;
const EXTRA_PAGES = 8;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".xml": "application/xml",
};
const site = {
  inFlight: 0,
  maxInFlight: 0,
  /** Document requests per path — a page rendered twice shows up here. */
  docs: new Map<string, number>(),
  reset() { this.inFlight = 0; this.maxInFlight = 0; this.docs = new Map(); },
};

function extraPage(n: number): string {
  return `<!doctype html><html><head><title>Capability ${n}</title></head><body>
<nav><a href="/index.html">Home</a></nav>
<h1>Capability sheet ${n}</h1>
<p>Sheet ${n}: tolerance class ${n * 3}, lead time ${n + 2} weeks, minimum order ${n * 50} units.</p>
</body></html>`;
}

function serve(): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req, res) => {
    let p = (req.url || "/").split("?")[0];
    if (p === "/") p = "/index.html";
    const isDoc = p.endsWith(".html");
    if (isDoc) {
      site.docs.set(p, (site.docs.get(p) ?? 0) + 1);
      site.inFlight++;
      site.maxInFlight = Math.max(site.maxInFlight, site.inFlight);
      await sleep(PAGE_DELAY_MS);
    }
    try {
      const extra = p.match(/^\/extra\/sheet-(\d+)\.html$/);
      if (extra) {
        res.writeHead(200, { "content-type": MIME[".html"] }).end(extraPage(Number(extra[1])));
      } else if (p === "/sitemap.xml") {
        // The fixture's sitemap plus the extra sheets, so the sweep has a real
        // fan-out to do rather than one leftover page.
        const base = await readFile(path.join(SITE_ROOT, "sitemap.xml"), "utf8");
        const more = Array.from({ length: EXTRA_PAGES }, (_, i) =>
          `  <url><loc>/extra/sheet-${i + 1}.html</loc></url>`).join("\n");
        res.writeHead(200, { "content-type": MIME[".xml"] })
          .end(base.replace("</urlset>", `${more}\n</urlset>`));
      } else {
        const file = path.normalize(path.join(SITE_ROOT, p));
        if (!file.startsWith(SITE_ROOT)) throw new Error("traversal");
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }).end(body);
      }
    } catch {
      res.writeHead(404).end("not found");
    } finally {
      if (isDoc) site.inFlight--;
    }
  });
  return new Promise((resolve) => server.listen(0, () => {
    const addr = server.address();
    resolve({ server, url: `http://localhost:${typeof addr === "object" && addr ? addr.port : 0}` });
  }));
}

// ── Part A: the primitives ──────────────────────────────────────────────────

async function provePrimitives() {
  console.log("\nPool primitives");
  const { createLimiter, mapPool, createPacer } = await import("../../../lib/pool");
  const { modelCall, onboardingConcurrency } = await import("../../../lib/onboarding/pool");

  // Limiter: never over the cap, even when callers arrive as slots free up.
  {
    const limit = createLimiter(3);
    let active = 0, peak = 0;
    const order: number[] = [];
    await Promise.all(Array.from({ length: 20 }, (_, i) => limit(async () => {
      active++; peak = Math.max(peak, active); order.push(i);
      await sleep(5 + (i % 3) * 5);
      active--;
    })));
    check("limiter never exceeds its cap", peak === 3, `peak=${peak}`);
    check("limiter starts callers in arrival order", order.every((v, i) => v === i), order.join(","));
  }

  // mapPool: ordered results, bounded, fail-fast without starting new work.
  {
    let active = 0, peak = 0;
    const out = await mapPool([50, 10, 30, 5, 20, 1], 2, async (ms, i) => {
      active++; peak = Math.max(peak, active);
      await sleep(ms);
      active--;
      return i * 10;
    });
    check("mapPool keeps input order whatever finishes first", out.join(",") === "0,10,20,30,40,50", out.join(","));
    check("mapPool runs at most `max` at once", peak === 2, `peak=${peak}`);

    let started = 0;
    const failed = await mapPool(Array.from({ length: 12 }, (_, i) => i), 2, async (i) => {
      started++;
      await sleep(10);
      if (i === 1) throw new Error("boom");
      return i;
    }).then(() => "resolved", (e: Error) => e.message);
    await sleep(40);
    check("mapPool rejects with the first failure", failed === "boom", failed);
    check("mapPool starts no new item after a failure", started <= 4, `started=${started} of 12`);
  }

  // Pacer: spaces STARTS apart; zero never waits.
  {
    const pace = createPacer(60);
    const t0 = Date.now();
    const starts: number[] = [];
    await Promise.all([0, 1, 2].map(async () => { await pace(); starts.push(Date.now() - t0); }));
    check("pacer lets the first caller straight through", starts[0] < 30, `${starts[0]}ms`);
    check("pacer spaces later starts by the pace", starts[1] >= 55 && starts[2] >= 115, starts.join(","));
    const free = createPacer(0);
    const t1 = Date.now();
    await Promise.all([free(), free(), free()]);
    check("a zero pace never waits", Date.now() - t1 < 20);
  }

  // Model gate: bounded, and a rate limit cools EVERY agent down, then retries.
  {
    process.env.ONBOARDING_CONCURRENCY = "3";
    check("ONBOARDING_CONCURRENCY is read", onboardingConcurrency() === 3);
    let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 10 }, () => modelCall(async () => {
      active++; peak = Math.max(peak, active);
      await sleep(15);
      active--;
    })));
    check("model gate caps calls in flight process-wide", peak === 3, `peak=${peak}`);

    const waits: number[] = [];
    const sleepFn = async (ms: number) => { waits.push(ms); await sleep(Math.min(ms, 30)); };
    let tripped = false;
    const limited = Object.assign(new Error("rate limited"), { status: 429, headers: { "retry-after": "2" } });
    const results = await Promise.all([0, 1, 2, 3].map((i) => modelCall(async () => {
      if (i === 0 && !tripped) { tripped = true; throw limited; }
      await sleep(5);
      return i;
    }, { sleepFn })));
    check("a 429 is waited out and retried, not failed", results.join(",") === "0,1,2,3", results.join(","));
    check("the cooldown honors retry-after", waits.some((w) => w > 1500 && w <= 2000), waits.join(","));

    const hard = await modelCall(async () => { throw new Error("bad request"); }, { sleepFn })
      .then(() => "resolved", (e: Error) => e.message);
    check("other errors pass straight through to the caller's policy", hard === "bad request", hard);

    process.env.ONBOARDING_CONCURRENCY = "999";
    check("concurrency is clamped", onboardingConcurrency() === 12, String(onboardingConcurrency()));
    process.env.ONBOARDING_CONCURRENCY = "0";
    check("a nonsense value falls back to the default", onboardingConcurrency() === 4);
    delete process.env.ONBOARDING_CONCURRENCY;
  }

  // The estimate describes the concurrent pass.
  {
    const { filingSeconds } = await import("../../../lib/onboarding/graphIndex");
    const work = { origins: 10, sources: 40, clusters: 6 };
    const one = filingSeconds(work, 0, 1);
    const four = filingSeconds(work, 0, 4);
    check("the filing estimate shrinks with concurrency", four < one / 2, `1→${one}s 4→${four}s`);
    check("a pace still sets the floor when an operator sets one",
      filingSeconds(work, 21_000, 4) >= 39 * 21, String(filingSeconds(work, 21_000, 4)));
  }
}

// ── Part B: the crawler under concurrency ───────────────────────────────────

async function proveCrawler(siteUrl: string) {
  console.log("\nCrawler");
  const { Crawler } = await import("../../../lib/onboarding/crawl");
  site.reset();
  const crawler = new Crawler(siteUrl, undefined, 2);
  try {
    const [a, b, c] = await Promise.all([
      crawler.load("/about.html"), crawler.load("/about.html"), crawler.load("/about.html"),
    ]);
    check("one url asked for three times is rendered once",
      site.docs.get("/about.html") === 1 && a === b && b === c && !!a, `requests=${site.docs.get("/about.html")}`);

    site.reset();
    const pages = await Promise.all(
      Array.from({ length: 6 }, (_, i) => crawler.load(`/extra/sheet-${i + 1}.html`)));
    check("concurrent loads all render", pages.every(Boolean));
    check("open tabs never exceed the crawler's cap", site.maxInFlight === 2, `max=${site.maxInFlight}`);
  } finally {
    await crawler.close();
  }
  site.reset();
  const after = await crawler.load("/services.html");
  check("a closed crawler returns null and never relaunches",
    after === null && (site.docs.get("/services.html") ?? 0) === 0);
}

// ── Part C: the real job, one at a time vs four at a time ───────────────────

type Run = {
  seconds: number;
  phase: string;
  error?: string;
  log: string[];
  report: Record<string, unknown>;
  chunkCount: number;
  graph?: { indexed: number; failed: number; entities: number; relations: number };
  modelPeak: number;
  tabPeak: number;
  maxDocRequests: number;
  graphTitles: string[];
  sources: { url: string; title: string; kind: string }[];
  chunkTexts: string[];
  sharedEntityRows: number;
  sharedEntityMentions: number;
};

async function runJob(siteUrl: string, concurrency: number, tag: string): Promise<Run> {
  const { prisma } = await import("../../../lib/db");
  const jobs = await import("../../../lib/onboarding/jobs");
  process.env.ONBOARDING_CONCURRENCY = String(concurrency);

  const user = await prisma.user.create({
    data: { email: `${tag}@example.test`, name: tag, slug: tag, passwordHash: "x" },
    select: { id: true },
  });
  try {
    const job = jobs.startJob(user.id, siteUrl);
    const until = async (done: () => boolean, ms: number) => {
      const t0 = Date.now();
      while (!done() && Date.now() - t0 < ms) await sleep(100);
    };
    await until(() => job.phase === "core-done" || job.phase === "failed", 120_000);
    if (job.phase !== "core-done") throw new Error(`core stage: ${job.phase} ${job.error ?? ""}`);

    // Measure the knowledge stage only — the stage the request is about.
    site.reset();
    model.reset();
    const logStart = job.log.length;
    const t0 = Date.now();
    if (!jobs.advanceJob(job, "knowledge", jobs.EXTRACTORS)) throw new Error("advanceJob refused");
    await until(() => job.phase === "done" || job.phase === "failed", 300_000);
    const seconds = (Date.now() - t0) / 1000;

    const sources = await prisma.source.findMany({
      where: { userId: user.id },
      select: { url: true, title: true, kind: true },
    });
    const chunks = await prisma.chunk.findMany({
      where: { userId: user.id, originKind: "source" },
      select: { text: true },
    });
    const shared = await prisma.entity.findMany({
      where: { userId: user.id, name: SHARED_ENTITY },
      select: { _count: { select: { mentions: true } } },
    });
    const strip = (u: string | null) => (u ?? "").replace(siteUrl, "");
    return {
      seconds,
      phase: job.phase,
      error: job.error,
      log: job.log.slice(logStart),
      report: (job.report ?? {}) as Record<string, unknown>,
      chunkCount: job.chunkCount ?? -1,
      graph: job.graph,
      modelPeak: model.maxInFlight,
      tabPeak: site.maxInFlight,
      maxDocRequests: Math.max(0, ...site.docs.values()),
      graphTitles: [...model.graphTitles],
      sources: sources
        .map((s) => ({ url: strip(s.url), title: s.title ?? "", kind: s.kind ?? "" }))
        .sort((a, b) => a.url.localeCompare(b.url)),
      chunkTexts: chunks.map((c) => c.text.split(siteUrl).join("")).sort(),
      sharedEntityRows: shared.length,
      sharedEntityMentions: shared[0]?._count.mentions ?? 0,
    };
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
}

const STARTS = [
  "Looking for a blog",
  "Checking for customer testimonials",
  "Reading your team and about pages",
  "Reading your services",
];
const OUTCOMES = [/^Blog: |^No blog found/, /^Testimonials: |testimonials found|third-party widget/, /^Team: |^No team bios/, /^Services: |^No services described/];

/** Did every category start before ANY category finished? */
function agentsOverlapped(log: string[]): boolean {
  const firstOutcome = log.findIndex((l) => OUTCOMES.some((re) => re.test(l)));
  const lastStart = Math.max(...STARTS.map((s) => log.findIndex((l) => l.startsWith(s))));
  return firstOutcome !== -1 && lastStart !== -1 && lastStart < firstOutcome;
}

async function proveJob(siteUrl: string) {
  const stamp = Date.now().toString(36);
  console.log("\nThe real job, ONBOARDING_CONCURRENCY=1");
  const serial = await runJob(siteUrl, 1, `pxproof-serial-${stamp}`);
  console.log(`  … knowledge stage took ${serial.seconds.toFixed(1)}s`);
  console.log("\nThe real job, ONBOARDING_CONCURRENCY=4");
  const parallel = await runJob(siteUrl, 4, `pxproof-parallel-${stamp}`);
  console.log(`  … knowledge stage took ${parallel.seconds.toFixed(1)}s`);
  console.log("  … the feed, as the agents start:");
  for (const l of parallel.log.slice(0, 10)) console.log(`      ${l}`);
  console.log("");

  check("serial run reaches done", serial.phase === "done", `${serial.phase} ${serial.error ?? ""}`);
  check("parallel run reaches done", parallel.phase === "done", `${parallel.phase} ${parallel.error ?? ""}`);

  // It is actually concurrent — and the measurement can tell the difference.
  check("serial: one model call in flight at a time", serial.modelPeak === 1, `peak=${serial.modelPeak}`);
  check("parallel: several model calls in flight, never over the cap",
    parallel.modelPeak > 1 && parallel.modelPeak <= 4, `peak=${parallel.modelPeak}`);
  check("serial: one page rendering at a time", serial.tabPeak === 1, `peak=${serial.tabPeak}`);
  check("parallel: several pages rendering, never over the cap",
    parallel.tabPeak > 1 && parallel.tabPeak <= 4, `peak=${parallel.tabPeak}`);
  check("serial: categories run one after another", !agentsOverlapped(serial.log));
  check("parallel: every category agent starts before any finishes", agentsOverlapped(parallel.log),
    parallel.log.slice(0, 12).join(" | "));
  check("parallel: the feed says agents are running together",
    parallel.log.some((l) => /^Running 4 extraction agents at once/.test(l)));
  const sweepAt = parallel.log.findIndex((l) => l.startsWith("Sweeping the sitemap"));
  const lastOutcome = Math.max(...OUTCOMES.map((re) => parallel.log.findIndex((l) => re.test(l))));
  check("parallel: the sweep waits for the categories it takes leftovers from",
    sweepAt > lastOutcome && lastOutcome !== -1, `sweep@${sweepAt} lastOutcome@${lastOutcome}`);

  // It is faster.
  check("parallel is materially faster than serial", parallel.seconds < serial.seconds * 0.7,
    `${parallel.seconds.toFixed(1)}s vs ${serial.seconds.toFixed(1)}s`);

  // And nothing was lost, doubled or reordered into a different result.
  check("no page is rendered twice in either run",
    serial.maxDocRequests === 1 && parallel.maxDocRequests === 1,
    `serial=${serial.maxDocRequests} parallel=${parallel.maxDocRequests}`);
  // Keys land in the order the agents finish, so compare the contents.
  const canon = (r: Record<string, unknown>) =>
    JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
  check("same knowledge report", canon(serial.report) === canon(parallel.report),
    `\n    serial:   ${JSON.stringify(serial.report)}\n    parallel: ${JSON.stringify(parallel.report)}`);
  check("same chunk count, and it is not zero",
    serial.chunkCount === parallel.chunkCount && parallel.chunkCount > 0,
    `serial=${serial.chunkCount} parallel=${parallel.chunkCount}`);
  check("same Source rows", JSON.stringify(serial.sources) === JSON.stringify(parallel.sources),
    `\n    serial:   ${JSON.stringify(serial.sources)}\n    parallel: ${JSON.stringify(parallel.sources)}`);
  check("same chunk texts", JSON.stringify(serial.chunkTexts) === JSON.stringify(parallel.chunkTexts));
  check("the sweep fanned out over the extra sheets",
    parallel.sources.filter((s) => s.url.startsWith("/extra/")).length === EXTRA_PAGES);
  check("testimonials keep their own record beside services",
    parallel.sources.some((s) => s.url.endsWith("#testimonials")) &&
    parallel.sources.some((s) => s.title === "Services"));

  // The graph pass: once per source, concurrent writers converging on one row.
  for (const [name, run] of [["serial", serial], ["parallel", parallel]] as const) {
    const perTitle = new Map<string, number>();
    for (const t of run.graphTitles) perTitle.set(t, (perTitle.get(t) ?? 0) + 1);
    const sourceTitles = run.sources.map((s) => s.title);
    const twice = sourceTitles.filter((t) => (perTitle.get(t) ?? 0) > sourceTitles.filter((x) => x === t).length);
    check(`${name}: each source is read for the graph once, not twice`, twice.length === 0, twice.join(", "));
    check(`${name}: no graph write failed`, run.graph?.failed === 0 && (run.graph?.indexed ?? 0) === run.sources.length,
      JSON.stringify(run.graph));
    check(`${name}: the shared entity converged on one row mentioned by every source`,
      run.sharedEntityRows === 1 && run.sharedEntityMentions >= run.sources.length,
      `rows=${run.sharedEntityRows} mentions=${run.sharedEntityMentions} sources=${run.sources.length}`);
  }
  check("same graph size either way",
    serial.graph?.entities === parallel.graph?.entities && serial.graph?.relations === parallel.graph?.relations,
    `${JSON.stringify(serial.graph)} vs ${JSON.stringify(parallel.graph)}`);
}

async function main() {
  await provePrimitives();
  const { server, url } = await serve();
  try {
    await proveCrawler(url);
    await proveJob(url);
  } finally {
    server.close();
    const { prisma } = await import("../../../lib/db");
    await prisma.user.deleteMany({ where: { slug: { startsWith: "pxproof-" } } }).catch(() => {});
    await prisma.$disconnect();
  }
}

main().then(() => {
  if (failures) { console.error(`\nPROOF FAIL: ${failures} check(s) failed`); process.exit(1); }
  console.log("\nPROOF PASS: onboarding extraction runs multiple agents at a time, faster, with the same result");
  process.exit(0);
}).catch((e) => { console.error("PROOF FAIL:", e); process.exit(1); });

/**
 * Proof for docs/features/railway-playwright-chromium.
 *
 * Orchestrator mode (no args): asserts the Railway deploy config, then runs
 * the two crawler cases in subprocesses so PLAYWRIGHT_BROWSERS_PATH is fixed
 * before Playwright loads:
 *   --case browser   production shape: browsers path set + sandbox disabled;
 *                    a page whose marker exists only after script execution
 *                    must extract that marker (plain fetch cannot).
 *   --case fallback  empty browsers path: the fetch fallback must return the
 *                    static HTML and a launch warning must be printed.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exit(1);
}

const FIXTURE = `<!doctype html><html><head><title>Fixture</title></head><body>
<p>STATIC_MARKER</p><div id="c"></div>
<script>document.getElementById("c").textContent = "JS_RENDERED_MARKER";</script>
</body></html>`;

async function serveFixture(): Promise<{ url: string; close: () => void }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  return { url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() };
}

async function runCase(kind: "browser" | "fallback") {
  const { Crawler } = await import("../../../lib/onboarding/crawl");
  const site = await serveFixture();
  const crawler = new Crawler(site.url);
  try {
    const page = await crawler.load(site.url);
    if (!page) fail(`case ${kind}: page did not load at all`);
    if (!page.html.includes("STATIC_MARKER")) fail(`case ${kind}: static content missing`);
    // Check the DOM node's text, not the raw HTML — the marker string also
    // appears in the <script> source, which a plain fetch returns verbatim.
    const rendered = page.$("#c").text().includes("JS_RENDERED_MARKER");
    if (kind === "browser" && !rendered)
      fail("case browser: JS-injected marker missing — crawler did not use Chromium");
    if (kind === "fallback" && rendered)
      fail("case fallback: JS marker present — expected the plain-fetch fallback");
    console.log(`case ${kind}: OK`);
  } finally {
    await crawler.close();
    site.close();
  }
}

function defaultBrowsersPath(): string {
  return process.platform === "darwin"
    ? path.join(homedir(), "Library/Caches/ms-playwright")
    : path.join(homedir(), ".cache/ms-playwright");
}

function checkDeployConfig() {
  const nixpacksPath = path.join(root, "nixpacks.toml");
  if (!existsSync(nixpacksPath)) fail("nixpacks.toml is missing");
  const nixpacks = readFileSync(nixpacksPath, "utf8");
  if (!/npx playwright install --with-deps --only-shell chromium/.test(nixpacks))
    fail("nixpacks.toml does not install Playwright Chromium with system deps");
  if (!/PLAYWRIGHT_BROWSERS_PATH\s*=\s*"\/app\/\.playwright"/.test(nixpacks))
    fail("nixpacks.toml does not pin PLAYWRIGHT_BROWSERS_PATH=/app/.playwright");
  if (!/CRAWLER_NO_SANDBOX\s*=\s*"1"/.test(nixpacks))
    fail("nixpacks.toml does not set CRAWLER_NO_SANDBOX=1");
  if (!/dependsOn\s*=\s*\[\s*"install"\s*\]/.test(nixpacks))
    fail("playwright phase does not depend on the install phase");

  const railway = JSON.parse(readFileSync(path.join(root, "railway.json"), "utf8"));
  if (railway.build?.builder !== "NIXPACKS") fail("railway.json no longer builds with NIXPACKS");
  if (railway.deploy?.startCommand !== "npm run start")
    fail("railway.json startCommand changed");

  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  if (!/^node scripts\/migrate\.mjs && /.test(pkg.scripts?.start ?? ""))
    fail("npm start no longer migrates before serving");
  console.log("deploy config: OK");
}

function orchestrate() {
  checkDeployConfig();

  const browsers = process.env.PROOF_BROWSERS_PATH || defaultBrowsersPath();
  // Mirror the build command (minus apt deps, already present on dev machines)
  // so the proof is self-sufficient on a fresh checkout.
  execFileSync("npx", ["playwright", "install", "--only-shell", "chromium"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
  });

  const self = path.join(__dirname, "proof.ts");
  const run = (kind: string, env: Record<string, string>) =>
    spawnSync("npx", ["tsx", self, "--case", kind], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });

  const b = run("browser", { PLAYWRIGHT_BROWSERS_PATH: browsers, CRAWLER_NO_SANDBOX: "1" });
  process.stdout.write(b.stdout);
  process.stderr.write(b.stderr);
  if (b.status !== 0) fail("browser case failed");

  const empty = mkdtempSync(path.join(tmpdir(), "pw-empty-"));
  const f = run("fallback", { PLAYWRIGHT_BROWSERS_PATH: empty, CRAWLER_NO_SANDBOX: "1" });
  process.stdout.write(f.stdout);
  process.stderr.write(f.stderr);
  if (f.status !== 0) fail("fallback case failed");
  if (!/Chromium unavailable/.test(f.stderr))
    fail("fallback did not log the Chromium-unavailable warning");

  console.log("PROOF PASS");
}

const caseArg = process.argv.indexOf("--case");
if (caseArg !== -1) {
  runCase(process.argv[caseArg + 1] as "browser" | "fallback").catch((e) => fail(String(e)));
} else {
  orchestrate();
}

/**
 * Regression proof: extraction must see what the BROWSER renders, not just
 * the raw HTML — external-stylesheet theme values, JS-injected and
 * srcset-only images, CSS background heroes — and must drop rendered-tiny
 * icons. Guards the failure where real company sites (external CSS, client-
 * side galleries) extracted as the fallback preset theme with zero photos.
 *
 *   npx tsx docs/features/guided-onboarding/proof/rendered-extraction.ts
 *
 * Serves proof/fixtures/rendered-site on a local port and runs the crawler
 * and the deterministic corpus/candidate builders directly. No DB, no app
 * server, no model key — the model's inputs are asserted, not its judgment.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Crawler } from "@/lib/onboarding/crawl";
import { themeCorpus } from "@/lib/onboarding/themeCorpus";
import { collectImageCandidates } from "@/lib/onboarding/images";

const PORT = Number(process.env.PROOF_FIXTURE_PORT || 4179);
const ROOT = join(__dirname, "fixtures", "rendered-site");
const SITE = `http://localhost:${PORT}`;
const DARK_PORT = Number(process.env.PROOF_DARK_FIXTURE_PORT || 4317);
const DARK_ROOT = join(__dirname, "fixtures", "dark-site");
const DARK_SITE = `http://localhost:${DARK_PORT}`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function serve(root = ROOT, port = PORT): Promise<() => void> {
  const server = createServer(async (req, res) => {
    let path = (req.url || "/").split("?")[0];
    if (path === "/") path = "/index.html";
    try {
      const file = normalize(join(root, path));
      if (!file.startsWith(root)) throw new Error("traversal");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) =>
    server.listen(port, () => resolve(() => server.close())),
  );
}

async function main() {
  const stop = await serve();
  const crawler = new Crawler(SITE);
  try {
    const home = await crawler.load(SITE);
    if (!home) throw new Error("fixture homepage did not load");

    console.log("rendered digest:");
    const r = home.rendered;
    check("digest present", !!r);
    check("page background from external css", r?.bg === "#fdf6ec", `got ${r?.bg}`);
    check("page text from external css", r?.text === "#22303a", `got ${r?.text}`);
    check("body font size", r?.fontSizePx === 17, `got ${r?.fontSizePx}`);
    check("heading weight", r?.headingWeight === "700", `got ${r?.headingWeight}`);
    check("control radius", (r?.radiusPx ?? 0) >= 10, `got ${r?.radiusPx}`);
    check(
      "brand fill surfaced",
      !!r?.brandColors.some((c) => c.hex === "#c14a2e"),
      JSON.stringify(r?.brandColors),
    );
    check(
      "css hero background measured",
      !!r?.bgImages.some((b) => b.url.includes("/hero.jpg")),
      JSON.stringify(r?.bgImages.map((b) => b.url)),
    );

    console.log("theme corpus:");
    const { corpus } = await themeCorpus(crawler, [home]);
    check("includes RENDERED section", corpus.includes("RENDERED:\npage background: #fdf6ec"));
    check("includes external stylesheet text", corpus.includes("--brand-marker-external-css"));

    console.log("image candidates:");
    const candidates = collectImageCandidates(crawler, [home]);
    const urls = candidates.map((c) => c.url);
    check(
      "JS-injected gallery image found",
      urls.some((u) => u.endsWith("/photo1.jpg")),
      urls.join(", "),
    );
    check("srcset-only image found", urls.some((u) => u.endsWith("/photo2.jpg")));
    check("css hero background is a candidate", urls.some((u) => u.includes("/hero.jpg")));
    check("rendered-tiny icon dropped", !urls.some((u) => u.endsWith("/tiny.png")));
    const injected = candidates.find((c) => c.url.endsWith("/photo1.jpg"));
    // Candidates carry the site's stated alt as CONTEXT for the curation
    // model; the model writes the final caption itself (asserted in the E2E).
    check("site alt text carried as candidate context", injected?.caption === "Morning bake");
  } finally {
    await crawler.close();
    stop();
  }

  // Regression: a white <body> whose real ground is painted by dark stacked
  // sections (the Webflow shape) must measure as the dark ground, not white.
  console.log("dark-sectioned ground:");
  const stopDark = await serve(DARK_ROOT, DARK_PORT);
  const darkCrawler = new Crawler(DARK_SITE);
  try {
    const darkHome = await darkCrawler.load(DARK_SITE);
    check("dark fixture loaded", !!darkHome);
    check(
      "sectioned dark ground wins over white body",
      darkHome?.rendered?.bg === "#1f2724",
      `got ${darkHome?.rendered?.bg}`,
    );
  } finally {
    await darkCrawler.close();
    stopDark();
  }

  console.log(failures ? `PROOF FAIL (${failures})` : "PROOF PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error("PROOF FAIL:", e);
  process.exit(1);
});

/**
 * Proof: the onboarding extraction pipeline is Playwright + Claude LLM only —
 * no deterministic parser fallbacks, no selector-based content extraction,
 * and a throw-don't-degrade failure policy. Runs with ANTHROPIC_API_KEY unset
 * and no network. extract.ts / locations.ts import next/font at module load
 * (Next-only), so those two are asserted at source level; the failure policy
 * is exercised functionally through knowledgeLlm.ts and owners.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

delete process.env.ANTHROPIC_API_KEY;

const ROOT = join(import.meta.dirname, "../../..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  console.log("1) deterministic parsers removed");
  const extractSrc = src("lib/onboarding/extract.ts");
  check("extract.ts has no parseHours", !/parseHours/.test(extractSrc));
  check("extract.ts has no parsePageLocations", !/parsePageLocations/.test(extractSrc));
  check("extract.ts has no ADDRESS_RE", !/ADDRESS_RE/.test(extractSrc));
  check("extract.ts has no PHONE_RE", !/PHONE_RE/.test(extractSrc));
  const ownersSrc = src("lib/onboarding/owners.ts");
  check("owners.ts has no parsePageOwners", !/parsePageOwners/.test(ownersSrc));
  const locationsSrc = src("lib/onboarding/locations.ts");
  check("locations.ts references no removed parser", !/parsePageLocations|parseHours/.test(locationsSrc));
  check("locations.ts extracts via llmExtract", /llmExtract\(/.test(locationsSrc));

  console.log("2) no selector-based content fallbacks in knowledge.ts");
  const knowledgeSrc = src("lib/onboarding/knowledge.ts");
  check("no blockquote selector extraction", !/\$\("blockquote"\)/.test(knowledgeSrc));
  check("no testimonial-card selector extraction", !/testimonial-|review-card/.test(knowledgeSrc));
  check("no team-member selector extraction", !/team-member|"section, \.bio/.test(knowledgeSrc));
  check("no raw chunkText sweep fallback", !/chunkText\(body\)/.test(knowledgeSrc));

  console.log("3) Playwright-only page loads in crawl.ts");
  const crawlSrc = src("lib/onboarding/crawl.ts");
  const loadBody = crawlSrc.slice(
    crawlSrc.indexOf("async load("),
    crawlSrc.indexOf("async loadText("),
  );
  check("load() body exists", loadBody.length > 0);
  check("load() has no fetch fallback", loadBody.length > 0 && !/\bfetch\(/.test(loadBody));

  console.log("4) failure policy: throw, never null/empty");
  const { llmExtract } = await import(join(ROOT, "lib/onboarding/knowledgeLlm.ts"));
  let threw = "";
  try {
    await llmExtract("system", "text", 100, () => {});
  } catch (err) {
    threw = err instanceof Error ? err.message : String(err);
  }
  check("llmExtract without key rejects naming the key", /ANTHROPIC_API_KEY/.test(threw), `got: ${threw || "resolved"}`);

  const owners = await import(join(ROOT, "lib/onboarding/owners.ts"));
  const cheerio = await import("cheerio");
  const html = "<body>Founded by Jane Smith.</body>";
  const fakePage = { url: "https://example.com/", html, $: cheerio.load(html) };
  let ownersThrew = false;
  try {
    await owners.extractOwners([fakePage], () => {});
  } catch {
    ownersThrew = true;
  }
  check("extractOwners without key rejects", ownersThrew);

  console.log("5) retry bound declared");
  const llmSrc = src("lib/onboarding/knowledgeLlm.ts");
  check("llmExtract declares 2 retries", /LLM_RETRIES\s*=\s*2/.test(llmSrc));

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

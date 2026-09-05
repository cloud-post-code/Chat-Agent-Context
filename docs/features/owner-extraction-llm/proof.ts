/**
 * Primary proof for owner-extraction-llm.
 * Exercises lib/onboarding/owners.ts with fixture pages and a stubbed crawler.
 * Pure — no server, DB, network, or model key; ANTHROPIC_API_KEY is unset so
 * the deterministic path is what runs.
 *
 *   npx tsx docs/features/owner-extraction-llm/proof.ts
 */
import * as cheerio from "cheerio";
import type { Page } from "../../../lib/onboarding/crawl";
import {
  OWNERS_SYSTEM_PROMPT,
  discoverOwnerPages,
  parsePageOwners,
  sanitizeOwners,
  extractOwners,
  ownersToOwnerName,
  type Owner,
} from "../../../lib/onboarding/owners";

delete process.env.ANTHROPIC_API_KEY;

async function main() {

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (${detail})`}`);
  if (!ok) failed++;
}

function pageOf(url: string, bodyHtml: string): Page {
  const html = `<html><body>${bodyHtml}</body></html>`;
  return { url, html, $: cheerio.load(html) };
}
const names = (owners: Owner[]) => owners.map((o) => o.name).sort().join("|");

// ── Prompt contract ──
{
  const p = OWNERS_SYSTEM_PROMPT;
  check("prompt: names About/Team/Our Story/Staff/Contact pages",
    /About/.test(p) && /Team/.test(p) && /Our Story/.test(p) && /Staff/.test(p) && /Contact/.test(p));
  check("prompt: allows many owners", /MANY owners/i.test(p));
  check("prompt: forbids guessing", /Never guess/i.test(p));
  check("prompt: pins the JSON shape",
    p.includes('{"owners":[{"name":"","role":""}]}'));
}

// ── Discovery with a stubbed crawler ──
{
  const origin = "https://example.com";
  const home = pageOf(`${origin}/`, `
    <nav>
      <a href="/about">About Us</a>
      <a href="/our-story">Our Story</a>
      <a href="/crew">Meet the Staff</a>
      <a href="/menu">Menu</a>
      <a href="https://facebook.com/x">Facebook</a>
    </nav>`);
  const served = new Map<string, Page>([
    [`${origin}/about`, pageOf(`${origin}/about`, "<p>about</p>")],
    [`${origin}/our-story`, pageOf(`${origin}/our-story`, "<p>story</p>")],
    [`${origin}/crew`, pageOf(`${origin}/crew`, "<p>crew</p>")],
    [`${origin}/team`, pageOf(`${origin}/team`, "<p>team</p>")],
  ]);
  const loads: string[] = [];
  const crawler = {
    resolve(href: string, base?: string): string | null {
      try {
        const u = new URL(href, base || origin);
        if (u.origin !== origin) return null;
        u.hash = "";
        return u.toString();
      } catch { return null; }
    },
    async load(url: string): Promise<Page | null> {
      loads.push(url);
      return served.get(url) ?? null;
    },
    navLinks(page: Page): { text: string; url: string }[] {
      const out: { text: string; url: string }[] = [];
      page.$("nav a, header a, footer a").each((_, el) => {
        const href = page.$(el).attr("href");
        const url = href ? this.resolve(href, page.url) : null;
        if (url) out.push({ text: page.$(el).text().trim(), url });
      });
      return out;
    },
  };

  const pages = await discoverOwnerPages(crawler as never, home, []);
  const urls = pages.map((p) => p.url);
  check("discovery: follows About nav link", urls.includes(`${origin}/about`));
  check("discovery: follows Our Story nav link", urls.includes(`${origin}/our-story`));
  check("discovery: follows Staff nav link by text", urls.includes(`${origin}/crew`));
  check("discovery: tries common /team path", urls.includes(`${origin}/team`));
  check("discovery: skips unrelated nav link", !urls.includes(`${origin}/menu`),
    urls.join(","));
  check("discovery: offsite link excluded", urls.every((u) => u.startsWith(origin)));
  check("discovery: no URL loaded twice", new Set(loads).size === loads.length,
    loads.join(","));
  check("discovery: home is included once", urls.filter((u) => u === home.url).length === 1);
}

// ── Fallback parsing ──
{
  check("parse: Owner label form",
    names(parsePageOwners("Contact us. Owner: Jane Smith. Call today.")) === "Jane Smith");
  const label = parsePageOwners("Owner: Jane Smith.");
  check("parse: label form carries role", label[0]?.role.toLowerCase() === "owner",
    JSON.stringify(label));
  check("parse: founded-by prose with two names",
    names(parsePageOwners(
      "Rosa's Bakery was founded by Maria Lopez and Ana Lopez in 1998.",
    )) === "Ana Lopez|Maria Lopez");
  check("parse: owned-and-operated-by prose",
    names(parsePageOwners("We are owned and operated by Sam Green.")) === "Sam Green");
  check("parse: bio-heading Co-Owner form",
    names(parsePageOwners("Our team. Priya Patel, Co-Owner. Bob Jones, Barista.")) ===
      "Priya Patel");
  check("parse: no ownership language -> empty",
    parsePageOwners("We sell coffee and pastries every day of the week.").length === 0);
}

// ── Multi-owner + dedupe across pages ──
{
  const pages = [
    pageOf("https://x.com/", "<p>Welcome to the shop owned and operated by Sam Green.</p>"),
    pageOf("https://x.com/about", "<p>Founded by Sam Green and Lee Wong.</p>"),
    pageOf("https://x.com/team", "<p>Owner: SAM GREEN</p>"),
  ];
  const owners = await extractOwners(pages, () => {});
  check("extract: every distinct owner kept", names(owners).toLowerCase() ===
    "lee wong|sam green", names(owners));
  check("extract: same person on several pages is one entry",
    owners.filter((o) => o.name.toLowerCase() === "sam green").length === 1);
}

// ── Sanitizer ──
{
  check("sanitize: non-object -> empty", sanitizeOwners("nope").length === 0);
  check("sanitize: owners not an array -> empty",
    sanitizeOwners({ owners: 3 }).length === 0);
  const dirty = sanitizeOwners({
    owners: [
      { name: "  Jane Smith ", role: " Owner " },
      { name: "", role: "Owner" },
      { role: "Founder" },
      { name: "jane smith", role: "Co-Owner" },
      ...Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, role: "" })),
    ],
  });
  check("sanitize: trims and keeps named entries", dirty[0]?.name === "Jane Smith" &&
    dirty[0]?.role === "Owner", JSON.stringify(dirty[0]));
  check("sanitize: dedupes case-insensitively",
    dirty.filter((o) => o.name.toLowerCase() === "jane smith").length === 1);
  check("sanitize: bounded to 12 entries", dirty.length <= 12, String(dirty.length));
}

// ── owner_name mapping ──
{
  check("ownersToOwnerName: empty -> \"\"", ownersToOwnerName([]) === "");
  check("ownersToOwnerName: one name", ownersToOwnerName([{ name: "Jane Smith", role: "Owner" }]) === "Jane Smith");
  check("ownersToOwnerName: joins with comma",
    ownersToOwnerName([
      { name: "Jane Smith", role: "Owner" },
      { name: "Tom Reed", role: "Co-Owner" },
    ]) === "Jane Smith, Tom Reed");
}

// ── No-key path resolves deterministically ──
{
  const owners = await extractOwners(
    [pageOf("https://y.com/about", "<p>Owner: Kim Cole</p>")], () => {});
  check("no key: fallback result returned", names(owners) === "Kim Cole");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
}

void main();

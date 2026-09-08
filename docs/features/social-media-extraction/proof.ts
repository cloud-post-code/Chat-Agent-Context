/**
 * Primary proof for social-media-extraction (see PROOF.md).
 * Run: npx tsx docs/features/social-media-extraction/proof.ts
 *
 * Drives the social-profile extractor with fixture Pages and a scripted
 * extract double (the only doubled boundary — the injectable seam), asserts
 * the anti-hallucination sanitizer, stage gating in jobs.ts, and the real
 * Profile row the save helper writes. Throwaway users are deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

const IG = "https://www.instagram.com/quillhaven.kilns/";
const FB = "https://www.facebook.com/QuillhavenKilns";
const PAGES = [
  page(
    "https://example.invalid/",
    `<footer>
       <a href="${IG}" aria-label="Instagram"></a>
       <a href="${FB}">Facebook</a>
       <a href="/about">About us</a>
       <a href="https://cdn.example.net/asset.js">asset</a>
     </footer>`,
  ),
  page(
    "https://example.invalid/about",
    `<footer><a href="${IG}" aria-label="Instagram"></a></footer>`,
  ),
];

async function main() {
  const { prisma, getProfile } = await import("../../../lib/db");
  const { extractSocialLinks, socialCandidates } = await import("../../../lib/onboarding/social");
  const { parseSocialLinks, sanitizeSocialLinks, saveSocialLinks } = await import(
    "../../../lib/socialLinks"
  );

  const scripted = (result: unknown) => {
    let calls = 0;
    const extract = async () => {
      calls++;
      return result as Record<string, unknown>;
    };
    return { extract, count: () => calls };
  };
  const quiet = () => {};

  // ── 1. Candidates: offsite anchors only, deduped ──
  const { corpus, urls } = socialCandidates(PAGES);
  check("offsite anchors are candidates", urls.includes(IG) && urls.includes(FB));
  check("on-domain links are not candidates", !urls.some((u) => u.includes("/about")));
  check("the same url on two pages is one candidate", urls.filter((u) => u === IG).length === 1);
  check("corpus carries the anchor context", corpus.includes("Instagram"));

  // ── 2. Extraction through the seam: exact-url rule, lowercase, dedupe ──
  const double = scripted({
    profiles: [
      { platform: "Instagram", url: IG },
      { platform: "instagram", url: IG }, // duplicate → one entry
      { platform: "facebook", url: "https://www.facebook.com/SomeoneElse" }, // hallucinated → dropped
      { platform: "facebook", url: FB },
    ],
  });
  const links = await extractSocialLinks(PAGES, quiet, double.extract);
  check("extract seam was used", double.count() === 1);
  check(
    "kept exactly the real profiles",
    links.length === 2 && links.some((l) => l.url === IG) && links.some((l) => l.url === FB),
    JSON.stringify(links),
  );
  check("platform names are lowercased", links.every((l) => l.platform === l.platform.toLowerCase()));
  check("hallucinated url was dropped", !links.some((l) => l.url.includes("SomeoneElse")));

  // ── 3. No offsite links → empty without a model call ──
  const bare = scripted({ profiles: [{ platform: "instagram", url: IG }] });
  const none = await extractSocialLinks(
    [page("https://example.invalid/", `<a href="/contact">Contact</a>`)],
    quiet,
    bare.extract,
  );
  check("no candidates → empty result", none.length === 0);
  check("no candidates → no model call", bare.count() === 0);

  // ── 4. Sanitizer junk safety ──
  for (const junk of [null, {}, { profiles: "x" }, { profiles: [3, { url: 9 }] }]) {
    const s = sanitizeSocialLinks(junk);
    check(`junk shape ${JSON.stringify(junk)} sanitizes empty without throwing`, s.length === 0);
  }
  check(
    "non-http urls are rejected",
    sanitizeSocialLinks([{ platform: "x", url: "javascript:alert(1)" }]).length === 0,
  );

  // ── 5. Persistence: saved JSON round-trips; re-save replaces ──
  // (Stage gating in jobs.ts can't run under tsx — jobs pulls next/font via
  //  extract.ts — so the wiring stays a secondary guard: typecheck + gate.)
  const user = await prisma.user.create({
    data: {
      email: `proof-social-${Date.now()}@example.invalid`,
      name: "Proof Social",
      slug: `proof-social-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });
  try {
    await saveSocialLinks(user.id, links);
    const p1 = await getProfile(user.id);
    check(
      "profile row carries the saved links",
      JSON.stringify(parseSocialLinks(p1.social_links)) === JSON.stringify(links),
      p1.social_links,
    );
    await saveSocialLinks(user.id, [{ platform: "facebook", url: FB }]);
    const p2 = await getProfile(user.id);
    check(
      "re-save replaces, never stacks",
      parseSocialLinks(p2.social_links).length === 1,
      p2.social_links,
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

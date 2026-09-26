/**
 * Primary proof for llm-readable-site (see PROOF.md).
 * Run: npx tsx docs/features/llm-readable-site/proof.ts
 *
 * Drives the real route handlers, robots, sitemap and middleware against the
 * local dev Postgres under one throwaway tenant. Zero model calls. Everything
 * made is deleted at the end (user cascade).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
}
process.env.NEXT_PUBLIC_SITE_URL = "https://proof.example";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const { prisma } = await import("@/lib/db");
  const tenantIndex = (await import("@/app/a/[slug]/llms.txt/route")).GET;
  const tenantFull = (await import("@/app/a/[slug]/llms-full.txt/route")).GET;
  const platformIndex = (await import("@/app/llms.txt/route")).GET;
  const platformFull = (await import("@/app/llms-full.txt/route")).GET;
  const robots = (await import("@/app/robots")).default;
  const sitemap = (await import("@/app/sitemap")).default;
  const { middleware } = await import("@/middleware");

  const stamp = Date.now().toString(36);
  const slug = `llmsproof-${stamp}`;
  const user = await prisma.user.create({
    data: { email: `${slug}@example.test`, name: "Proof Bakery", slug, passwordHash: "x" },
  });
  try {
    await seed(prisma, user.id);
    const params = { params: Promise.resolve({ slug }) };
    const origin = "https://proof.example";

    // 1 + 4: the index
    const idxRes = await tenantIndex(new Request(`${origin}/a/${slug}/llms.txt`), params);
    const idx = await idxRes.text();
    console.log("\n--- llms.txt ---\n" + idx + "\n---");
    check("index answers 200 as markdown", idxRes.status === 200 && idxRes.headers.get("content-type") === "text/markdown; charset=utf-8");
    check("index has ETag and open CORS", !!idxRes.headers.get("etag") && idxRes.headers.get("access-control-allow-origin") === "*");
    const idxLines = idx.split("\n");
    check("index starts with H1 name", idxLines[0] === "# Proof Bakery Co", idxLines[0]);
    check("index line 3 is a blockquote", idxLines[2]?.startsWith("> "), idxLines[2]);
    const bullets = idxLines.filter((l) => l.startsWith("- "));
    check("every bullet is a markdown link to an absolute URL", bullets.length > 0 && bullets.every((l) => /^- \[[^\]]+\]\(https:\/\/proof\.example\/[^)]*\)(: .+)?$/.test(l)), bullets.find((l) => !/^- \[[^\]]+\]\(https:\/\/[^)]*\)/.test(l)));
    check("index links the full document", idx.includes(`(${origin}/a/${slug}/llms-full.txt)`));
    check("index links the chat page", idx.includes(`(${origin}/a/${slug})`));
    check("index links the chat API", idx.includes(`(${origin}/api/chat)`));
    const founder = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
    const isFounder = founder?.id === user.id;
    check("A2A card linked only for the founding tenant", idx.includes("/.well-known/agent-card.json") === isFounder);

    // 2 + 3: the full document
    const fullRes = await tenantFull(new Request(`${origin}/a/${slug}/llms-full.txt`), params);
    const full = await fullRes.text();
    console.log("\n--- llms-full.txt ---\n" + full + "\n---");
    check("full answers 200 as markdown", fullRes.status === 200 && fullRes.headers.get("content-type") === "text/markdown; charset=utf-8");
    const heads = full.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    check("sections in the fixed order", JSON.stringify(heads) === JSON.stringify([
      "About", "Contact and hours", "Projects",
      "Frequently asked questions", "Sources", "How to talk to this agent",
    ]), JSON.stringify(heads));
    check("about carries the persona", full.includes("We bake sourdough at dawn"));
    check("contact carries address, phone, email, hours and a social link", ["12 Main St", "555-0100", "hi@proof.test", "Tue-Sun 7am-2pm", "https://instagram.com/proofbakery"].every((s) => full.includes(s)));
    check("projects list name and links", full.includes("### Bread Club") && full.includes("https://github.com/proof/bread") && full.includes("https://bread.proof.test"));
    check("faq has the answered enabled question", full.includes("### Do you deliver?") && full.includes("Yes, within 5 miles."));
    check("faq omits blank and disabled answers", !full.includes("Are you hiring") && !full.includes("Secret question"));
    check("sources carry title, link and summary", full.includes("### Our story") && full.includes("https://proof.test/story") && full.includes("Founded in 2019"));
    check("sources omit raw text", !full.includes("RAW TEXT MARKER"));
    check("directives never appear", !full.includes("Always upsell") && !idx.includes("Always upsell"));
    check("no admin surface is mentioned", !/admin/i.test(full) && !/admin/i.test(idx));
    check("unknown slug answers 404", (await tenantFull(new Request(`${origin}/a/nope/llms-full.txt`), { params: Promise.resolve({ slug: "nope-" + stamp }) })).status === 404);

    // 5: platform documents
    const pIdx = await (await platformIndex(new Request(`${origin}/llms.txt`))).text();
    check("platform index links the tenant's index", pIdx.includes(`(${origin}/a/${slug}/llms.txt)`));
    check("platform index starts with an H1 and blockquote", pIdx.startsWith("# ") && pIdx.split("\n")[2]?.startsWith("> "));
    const pFull = await (await platformFull(new Request(`${origin}/llms-full.txt`))).text();
    check("platform full contains the tenant's H1", pFull.includes("# Proof Bakery Co"));

    // 6: robots and sitemap
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    for (const agent of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "anthropic-ai"]) {
      check(`robots allows ${agent}`, rules.some((x) => x.userAgent === agent && x.allow === "/"));
    }
    const star = rules.find((x) => x.userAgent === "*");
    check("robots disallows /admin for everyone", !!star && ([] as string[]).concat(star.disallow ?? []).includes("/admin"));
    check("robots names the sitemap", r.sitemap === `${origin}/sitemap.xml`);
    const sm = await sitemap();
    const urls = sm.map((e) => e.url);
    check("sitemap lists the tenant's page and llms files", [`${origin}/a/${slug}`, `${origin}/a/${slug}/llms.txt`, `${origin}/a/${slug}/llms-full.txt`, `${origin}/llms.txt`].every((u) => urls.includes(u)));

    // 7: middleware
    const { NextRequest } = await import("next/server");
    const rewriteOf = (url: string, accept: string) => {
      const res = middleware(new NextRequest(url, { headers: { accept } }));
      return res?.headers.get("x-middleware-rewrite") ?? "";
    };
    check("Accept: text/markdown on the agent page rewrites to llms-full", rewriteOf(`${origin}/a/${slug}`, "text/markdown") === `${origin}/a/${slug}/llms-full.txt`);
    check(".md suffix rewrites to llms-full", rewriteOf(`${origin}/a/${slug}.md`, "*/*") === `${origin}/a/${slug}/llms-full.txt`);
    check("Accept: text/markdown on / rewrites to llms.txt", rewriteOf(`${origin}/`, "text/markdown, text/plain;q=0.9") === `${origin}/llms.txt`);
    check("an HTML request passes through", rewriteOf(`${origin}/a/${slug}`, "text/html,application/xhtml+xml,*/*;q=0.8") === "");
    check("a browser's */* passes through", rewriteOf(`${origin}/a/${slug}`, "*/*") === "");
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

type Db = (typeof import("@/lib/db"))["prisma"];
async function seed(prisma: Db, userId: string) {
  await prisma.profile.create({
    data: {
      userId,
      company_name: "Proof Bakery Co",
      owner_name: "Pat Proof",
      company_address: "12 Main St, Springfield",
      company_phone_number: "555-0100",
      company_email: "hi@proof.test",
      company_hours: "Tue-Sun 7am-2pm",
      social_links: JSON.stringify([{ platform: "instagram", url: "https://instagram.com/proofbakery" }]),
    },
  });
  await prisma.personaConfig.create({
    data: {
      userId,
      tagline: "Real bread, every morning.",
      brandValues: JSON.stringify(["honest", "local"]),
      personaSections: JSON.stringify({ persona: "We bake sourdough at dawn and sell out by noon." }),
    },
  });
  await prisma.source.create({
    data: {
      userId,
      type: "link",
      kind: "article",
      url: "https://proof.test/story",
      title: "Our story",
      summary: "Founded in 2019 by Pat Proof in a garage.",
      rawText: "RAW TEXT MARKER should not be published",
      status: "scanned",
    },
  });
  await prisma.project.create({
    data: { userId, name: "Bread Club", blurb: "A weekly bread box.", githubUrl: "https://github.com/proof/bread", liveUrl: "https://bread.proof.test" },
  });
  await prisma.cannedAnswer.createMany({
    data: [
      { userId, question: "Do you deliver?", matchKey: "do you deliver", answer: "Yes, within 5 miles.", order: 0 },
      { userId, question: "Are you hiring?", matchKey: "are you hiring", answer: "", order: 1 },
      { userId, question: "Secret question?", matchKey: "secret question", answer: "Hidden.", enabled: false, order: 2 },
    ],
  });
  await prisma.agentDirective.create({ data: { userId, kind: "rule", text: "Always upsell the cake." } });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

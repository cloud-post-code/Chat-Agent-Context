/**
 * Primary proof for site-driven-a2ui-cards (see PROOF.md).
 * Run: npx tsx docs/features/site-driven-a2ui-cards/proof.ts
 *
 * Drives the site-cards agent over imported Source rows with two scripted
 * doubles — the planner `llm` seam and the card-builder `draft` seam, the only
 * doubled boundaries — then asserts the real UiCard rows, their order, the
 * untouched owner row, the attachments, the events, the no-site gate, the
 * route's auth refusal and the panel's button. Throwaway users are deleted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// Nothing in this proof may go online.
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const PREFIX = "proof-site-cards";
const COMPANY = "Quillhaven Kiln Works";
const VISIT_URL = "https://quillhaven.invalid/visit";
const WORK_URL = "https://quillhaven.invalid/work";
const VISIT_TEXT = "Park in the Tanner Row yard behind the workshop; step-free entry by the blue door.";
const WORK_TEXT = "Recent retrofits across Harrowgate, photographed on completion.";
const PASTED_TEXT = "Pasted internal note zebra-quartz that is not part of the site.";
const QUESTIONS = [
  "Where do I park when I visit?", // 1 → designed
  "Can I see examples of your work?", // 2 → gallery, but the owner attached a card first
  "Do you work outside Harrowgate?", // 3 → unmapped
];
const NEED = "Visitors coming to the workshop need to know where to park and how to get in";
const BRIEF = "A visiting-the-workshop card: parking and step-free access; search the knowledge base for both";

const PLAN = {
  needs: [
    {
      need: NEED, evidence: VISIT_URL, kind: "designed", label: "Parking & access",
      description: "Where to park and how to get in", reason: "When a visitor asks about visiting",
      brief: BRIEF, questions: [1],
    },
    {
      need: "Prospects want to see finished retrofits before enquiring", evidence: "https://elsewhere.invalid/x",
      kind: "gallery", label: "Our work", description: "Photos of finished retrofits",
      reason: "When a visitor asks to see the work", layout: "filmstrip", questions: [2],
    },
    { need: "Reaching the team", evidence: "", kind: "contact", label: "Reach us", description: "", reason: "When …", questions: [] },
    { need: "Booking a survey", evidence: "", kind: "booking", label: "Book a survey", description: "", reason: "When …", questions: [3] },
    { need: "Contacting", evidence: "", kind: "designed", label: "get in TOUCH", description: "", reason: "When …", brief: "dup", questions: [] },
    { need: "", evidence: "", kind: "designed", label: "Needless card", description: "", reason: "When …", brief: "x", questions: [] },
  ],
};

const DRAFT_BLOCK = {
  type: "custom",
  title: "Parking & access",
  elements: [{ kind: "heading", text: "Visiting us" }, { kind: "list", items: ["Tanner Row yard", "Blue door"] }],
};
const DRAFT = {
  label: "Parking & access", tool: "show_card", description: "Where to park", reason: "When asked about visiting",
  note: "", sampleBlock: JSON.stringify(DRAFT_BLOCK),
};

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { buildCardsFromSite, sanitizeSiteCardPlan, SITE_CARDS_SYSTEM_PROMPT } = await import("../../../lib/siteCards");
  const { listUiCards, customCardBlock, saveUiCard } = await import("../../../lib/uiCards");
  const { normalizeQuestion } = await import("../../../lib/canned");

  const created: string[] = [];
  const mkTenant = async (tag: string, withSite = true) => {
    const u = await prisma.user.create({
      data: {
        email: `${PREFIX}-${tag}@example.invalid`, name: `Proof Site Cards ${tag}`,
        slug: `${PREFIX}-${tag}-${Date.now()}`, passwordHash: "", onboardedAt: new Date(),
      },
    });
    created.push(u.id);
    const userId = u.id;
    await prisma.profile.create({ data: { userId, company_name: COMPANY, company_email: "hello@quillhaven.invalid" } });
    await prisma.personaConfig.create({ data: { userId } });
    await prisma.themeConfig.create({ data: { userId } });
    for (const [i, filename] of ["proofsite-a.jpg", "proofsite-b.jpg"].entries()) {
      await prisma.photo.create({ data: { userId, filename, description: `Photo ${i}`, caption: `Kiln ${i}`, kind: "gallery", order: i } });
    }
    for (const [i, q] of QUESTIONS.entries()) {
      await prisma.cannedAnswer.create({ data: { userId, question: q, matchKey: normalizeQuestion(q), answer: "", order: i } });
    }
    if (withSite) {
      await prisma.source.create({ data: { userId, type: "link", url: VISIT_URL, title: "Visit us", rawText: VISIT_TEXT, status: "scanned" } });
      await prisma.source.create({ data: { userId, type: "link", url: WORK_URL, title: "Our work", rawText: WORK_TEXT, status: "scanned" } });
    }
    await prisma.source.create({ data: { userId, type: "text", title: "Note", rawText: PASTED_TEXT, status: "scanned" } });
    return userId;
  };
  const ownerCard = (userId: string) =>
    saveUiCard(userId, {
      key: "", label: "Get in touch", tool: "show_contact_form", description: "Contact form",
      reason: "When a visitor wants to reach us", note: "", sampleBlock: JSON.stringify({ type: "contact" }),
    });

  const scriptedLlm = (result: unknown) => {
    const seen: string[] = [];
    const systems: string[] = [];
    const llm = async (system: string, userText: string) => {
      systems.push(system);
      seen.push(userText);
      return result as Record<string, unknown>;
    };
    return { llm: llm as never, seen, systems, count: () => seen.length };
  };
  const scriptedDraft = (draft: unknown) => {
    const seen: string[] = [];
    const fn = async (_u: string, input: { instructions: string }) => {
      seen.push(input.instructions);
      return draft as never;
    };
    return { draft: fn as never, seen, count: () => seen.length };
  };
  const throwing = (async () => {
    throw new Error("exploded");
  }) as never;
  type Ev = { t: string; [k: string]: unknown };
  const collector = () => {
    const events: Ev[] = [];
    return { events, on: (e: Ev) => void events.push(e) };
  };

  try {
    // ── 1. Sanitizer ──
    const signals = { photos: 2, projects: 0, services: 0, takesAppointments: true, contactChannels: ["email"], categories: [] };
    const existing = [{ label: "Get in touch", tool: "show_contact_form" }];
    const urls = [VISIT_URL, WORK_URL];
    for (const junk of [null, "x", { needs: 7 }, { needs: [null, 3, {}] }]) {
      check(`sanitizer: junk ${JSON.stringify(junk)} → empty`,
        sanitizeSiteCardPlan(junk as never, signals, 3, existing, urls).cards.length === 0);
    }
    const clean = sanitizeSiteCardPlan(PLAN as never, signals, 3, existing, urls);
    check("sanitizer keeps exactly the designed and gallery cards",
      clean.cards.map((c) => c.label).join("|") === "Parking & access|Our work", JSON.stringify(clean.cards.map((c) => c.label)));
    check("sanitizer keeps known evidence", clean.cards[0]?.evidence === VISIT_URL);
    check("sanitizer blanks unknown evidence", clean.cards[1]?.evidence === "");
    check("sanitizer carries the need", clean.cards[0]?.need === NEED);
    const six = {
      needs: ["designed", "designed", "gallery", "contact", "designed", "designed"]
        .map((kind, n) => ({ need: `Need ${n}`, kind, label: `Card ${n}`, brief: "b", reason: "When …" })),
    };
    check("sanitizer caps at 4 cards", sanitizeSiteCardPlan(six as never, signals, 0, [], urls).cards.length === 4);

    // ── 2. No site ──
    const userN = await mkTenant("nosite", false);
    const llmN = scriptedLlm(PLAN);
    const runN = await buildCardsFromSite(userN, () => {}, { llm: llmN.llm, draft: scriptedDraft(DRAFT).draft });
    check("no imported site: noSite, no planner call, no rows",
      runN.noSite && llmN.count() === 0 && (await prisma.uiCard.count({ where: { userId: userN } })) === 0, JSON.stringify(runN));

    // ── 3–7. Additive round-trip ──
    const userA = await mkTenant("a");
    await ownerCard(userA);
    await prisma.cannedAnswer.updateMany({ where: { userId: userA, question: QUESTIONS[1] }, data: { cardTool: "show_projects" } });
    const ownerBefore = JSON.stringify((await listUiCards(userA))[0]);
    const llmA = scriptedLlm(PLAN);
    const draftA = scriptedDraft(DRAFT);
    const evA = collector();
    const runA = await buildCardsFromSite(userA, evA.on as never, { llm: llmA.llm, draft: draftA.draft });

    const text = llmA.seen[0] ?? "";
    check("planner got the site-cards system prompt", llmA.systems[0] === SITE_CARDS_SYSTEM_PROMPT && /need/i.test(SITE_CARDS_SYSTEM_PROMPT));
    check("corpus carries each imported page's url and text",
      [VISIT_URL, WORK_URL, VISIT_TEXT, WORK_TEXT].every((s) => text.includes(s)));
    check("corpus excludes pasted (non-site) sources", !text.includes("zebra-quartz"));
    check("corpus lists the existing cards", text.includes("EXISTING CARDS") && text.includes("Get in touch"));
    check("corpus names the business and numbers the questions",
      text.includes(COMPANY) && text.includes(`1. ${QUESTIONS[0]}`));

    const rowsA = await listUiCards(userA);
    check("two rows added after the owner's, in plan order",
      rowsA.map((r) => `${r.label}:${r.tool}`).join("|")
        === "Get in touch:show_contact_form|Parking & access:show_card|Our work:show_gallery",
      JSON.stringify(rowsA.map((r) => [r.label, r.tool, r.order])));
    check("new rows order after the existing last row", rowsA[1]?.order === 1 && rowsA[2]?.order === 2);
    check("owner's row is byte-identical", JSON.stringify(rowsA[0]) === ownerBefore);
    const designedKey = rowsA[1]?.key ?? "";
    check("designed row holds the builder's draft and resolves via customCardBlock",
      JSON.stringify(await customCardBlock(userA, designedKey)) === JSON.stringify(DRAFT_BLOCK));
    check("gallery sample holds the tenant's own photos", (rowsA[2]?.sampleBlock ?? "").includes("proofsite-a.jpg"));
    check("report lists what was written",
      runA.written === 2 && !runA.noSite && !runA.failed && runA.cards.map((c) => c.label).join("|") === "Parking & access|Our work", JSON.stringify(runA));

    check("builder brief carries the brief, the need and the evidence page",
      draftA.count() === 1 && [BRIEF, NEED, VISIT_URL, COMPANY].every((s) => (draftA.seen[0] ?? "").includes(s)), draftA.seen[0]);

    const needs = evA.events.filter((e) => e.t === "need");
    const cards = evA.events.filter((e) => e.t === "card");
    check("one need event per planned need, with evidence",
      needs.length === 2 && needs[0].need === NEED && needs[0].evidence === VISIT_URL && needs[0].label === "Parking & access", JSON.stringify(needs));
    check("one card event per written row",
      cards.map((c) => c.key).sort().join("|") === rowsA.slice(1).map((r) => r.key).sort().join("|"), JSON.stringify(cards));
    check("status events were emitted", evA.events.some((e) => e.t === "status"));

    const qA = await prisma.cannedAnswer.findMany({ where: { userId: userA }, orderBy: { order: "asc" } });
    check("named question now carries the designed card",
      qA[0].cardTool === "show_card" && qA[0].cardInput === JSON.stringify({ key: designedKey }));
    check("owner's attachment is untouched", qA[1].cardTool === "show_projects");
    check("unmapped question stays bare", qA[2].cardTool === null && runA.attached === 1, `${runA.attached}`);

    // ── 8. Second run adds nothing ──
    const draftA2 = scriptedDraft(DRAFT);
    const runA2 = await buildCardsFromSite(userA, () => {}, { llm: scriptedLlm(PLAN).llm, draft: draftA2.draft });
    check("second run with the same plan writes nothing and drafts nothing",
      runA2.written === 0 && draftA2.count() === 0 && (await prisma.uiCard.count({ where: { userId: userA } })) === 3, JSON.stringify(runA2));

    // ── 9. Best-effort ──
    const userF = await mkTenant("f");
    const runF = await buildCardsFromSite(userF, () => {}, { llm: throwing, draft: scriptedDraft(DRAFT).draft });
    check("throwing planner: failed, no rows, no throw",
      runF.failed && (await prisma.uiCard.count({ where: { userId: userF } })) === 0);
    const runF2 = await buildCardsFromSite(userF, () => {}, { llm: scriptedLlm(PLAN).llm, draft: throwing });
    // Tenant F has no owner card, so both of the plan's designed cards survive
    // the sanitizer and both hit the throwing builder.
    check("throwing builder: live cards still written, each failed draft counted",
      runF2.written === 2 && runF2.designedFailed === 2
        && (await listUiCards(userF)).map((r) => r.tool).join(",") === "show_gallery,show_contact_form",
      JSON.stringify(runF2));

    // ── 10. Route + button ──
    const route = await import("../../../app/api/admin/site-cards/route");
    let status = 0;
    try {
      status = (await route.POST(new Request("http://localhost/api/admin/site-cards", { method: "POST" }))).status;
    } catch {
      // next/headers outside a request scope: no session can exist, which the
      // route must treat as unauthenticated rather than crash.
      status = -1;
    }
    check("route refuses an unauthenticated request with 401", status === 401, `${status}`);
    const panel = readFileSync(path.join(root, "app/admin/A2uiPanel.tsx"), "utf8");
    const control = readFileSync(path.join(root, "app/admin/SiteCardsRun.tsx"), "utf8");
    check("A2UI panel renders the button, and the control calls the route",
      /<SiteCardsButton\b/.test(panel) && /<SiteCardsLog\b/.test(panel)
        && control.includes('fetch("/api/admin/site-cards"') && control.includes("Build cards from my site"));

    // ── 11. Isolation ──
    const userB = await mkTenant("b");
    check("tenant B sees none of A's cards", (await prisma.uiCard.count({ where: { userId: userB } })) === 0);
  } finally {
    for (const id of created) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: PREFIX } } });
    const leftCards = await prisma.uiCard.count({ where: { userId: { in: created } } });
    check("every row and user the proof created is gone", leftUsers === 0 && leftCards === 0, `${leftUsers},${leftCards}`);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

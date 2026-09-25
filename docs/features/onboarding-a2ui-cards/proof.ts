/**
 * Primary proof for onboarding-a2ui-cards (see PROOF.md).
 * Run: npx tsx docs/features/onboarding-a2ui-cards/proof.ts
 *
 * Drives the card planner with fixture Pages and two scripted doubles — the
 * planner `llm` seam and the card-builder `draft` seam, the only doubled
 * boundaries — then asserts the real UiCard rows written through saveUiCard,
 * the starter-question attachments, the zero-cards gate, the empty-catalog
 * behavior of cardCatalog / buildSystemPrompt / brain.answer(), tenant
 * isolation, and that no starter set exists in code. Throwaway users are
 * deleted at the end.
 */
import { execFileSync } from "node:child_process";
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

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

const PREFIX = "proof-onboarding-cards";
const COMPANY = "Quillhaven Kiln Works";
const GOAL = "Get visitors needing a Quillhaven kiln retrofit to book a site survey";
const QUESTIONS = [
  "What retrofit packages do you offer?", // 1 → designed
  "Can I see examples of your work?", // 2 → gallery
  "How do I book a site survey?", // 3 → booking
  "How can I get in touch?", // 4 → contact, but the owner attached a card first
  "Do you work outside Harrowgate?", // 5 → unmapped
];
const BRIEF =
  "A services-and-pricing card listing the Quillhaven retrofit packages with what each "
  + "includes; search the knowledge base for package names and inclusions";
const PHOTOS = ["proofcards-a.jpg", "proofcards-b.jpg"];

const PAGES = [
  page(
    "https://example.invalid/services",
    "<h1>Services</h1><p>Full Harrowgate-spec retrofit of aging kilns.</p>",
  ),
  page("https://example.invalid/book", "<p>Book a site survey online.</p>"),
];

const PLAN = {
  cards: [
    {
      kind: "gallery", label: "Our work", description: "Photos of finished retrofits",
      reason: "When a visitor asks to see examples of the work", layout: "filmstrip", questions: [2],
    },
    {
      kind: "designed", label: "Services & pricing",
      description: "The retrofit packages and what each includes",
      reason: "When a visitor asks what services are offered or what they cost",
      brief: BRIEF, questions: [1],
    },
    {
      kind: "contact", label: "Get in touch", description: "The in-chat contact form",
      reason: "When a visitor wants to reach the team or request a quote", questions: [4],
    },
    { kind: "booking", label: "Book a site survey", description: "", reason: "When a visitor wants to book a survey", questions: [3] },
    { kind: "projects", label: "Projects", description: "", reason: "When asked about projects", questions: [] },
  ],
};

const DRAFT_BLOCK = {
  type: "custom",
  title: "Services & pricing",
  elements: [
    { kind: "heading", text: "Retrofit packages" },
    { kind: "list", items: ["Harrowgate-spec full retrofit", "Burner-only service"] },
  ],
};
const DRAFT = {
  label: "Services & pricing",
  tool: "show_card",
  description: "Retrofit packages with what each includes",
  reason: "When a visitor asks what services are offered or what they cost",
  note: "",
  sampleBlock: JSON.stringify(DRAFT_BLOCK),
};

const SIGNALS_ON = { photos: 2, projects: 0, services: 0, menuOrderable: false, takesAppointments: true, contactChannels: ["email"], socialLinks: 0, categories: ["services"], hasKnowledge: true };

async function main() {
  const { prisma } = await import("../../../lib/db");
  const cardsMod = await import("../../../lib/onboarding/cards");
  const { generateOnboardingCards, sanitizeCardPlan } = cardsMod;
  const uiCardsMod = await import("../../../lib/uiCards");
  const { cardCatalog, listUiCards, customCardBlock, saveUiCard } = uiCardsMod;
  const { provisionUserDefaults } = await import("../../../lib/users");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");
  const { answer } = await import("../../../lib/brain");
  const { normalizeQuestion } = await import("../../../lib/canned");

  const created: string[] = [];
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `${PREFIX}-${tag}@example.invalid`,
        name: `Proof Cards ${tag}`,
        slug: `${PREFIX}-${tag}-${Date.now()}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    created.push(u.id);
    return u.id;
  };

  /** A tenant as the end of a site onboarding leaves it: profile, photos, goal, blank starter questions, booking on. */
  const mkTenant = async (tag: string) => {
    const userId = await mkUser(tag);
    await prisma.profile.create({
      data: { userId, company_name: COMPANY, company_email: "hello@quillhaven.invalid", bookingEnabled: true },
    });
    await prisma.personaConfig.create({ data: { userId, tagline: "Kilns that outlive their owners" } });
    await prisma.themeConfig.create({ data: { userId } });
    await prisma.agentDirective.create({ data: { userId, kind: "goal", text: GOAL, enabled: true, order: 0 } });
    await prisma.appointmentField.create({
      data: { userId, key: "name", label: "Your name", type: "short_text", required: true, order: 0 },
    });
    for (const [i, filename] of PHOTOS.entries()) {
      await prisma.photo.create({
        data: { userId, filename, description: `Retrofit photo ${i + 1}`, caption: `Kiln ${i + 1}`, kind: "gallery", order: i },
      });
    }
    for (const [i, q] of QUESTIONS.entries()) {
      await prisma.cannedAnswer.create({
        data: { userId, question: q, matchKey: normalizeQuestion(q), answer: "", order: i },
      });
    }
    return userId;
  };

  const questionRows = (userId: string) =>
    prisma.cannedAnswer.findMany({ where: { userId }, orderBy: { order: "asc" } });

  /** The planner seam: records the user text it was handed, returns canned JSON. */
  const scriptedLlm = (result: unknown) => {
    const seen: string[] = [];
    const llm = async (_system: string, userText: string) => {
      seen.push(userText);
      return result as Record<string, unknown>;
    };
    return { llm: llm as never, seen, count: () => seen.length };
  };
  const throwingLlm = (async () => {
    throw new Error("planner exploded");
  }) as never;

  /** The builder seam: records the instructions, returns a fixed draft. */
  const scriptedDraft = (draft: unknown) => {
    const seen: string[] = [];
    const fn = async (_userId: string, input: { instructions: string }) => {
      seen.push(input.instructions);
      return draft as never;
    };
    return { draft: fn as never, seen, count: () => seen.length };
  };
  const throwingDraft = (async () => {
    throw new Error("builder exploded");
  }) as never;

  /** The brain's client double: captures the tools and system prompt it is offered. */
  function brainClient(text = "ok") {
    const spy = { calls: 0, tools: [] as { name: string; input_schema?: { properties?: Record<string, { enum?: string[] }> } }[][], systems: [] as string[] };
    const client = {
      messages: {
        stream(req: { system?: string; tools?: unknown[] }) {
          spy.calls++;
          spy.systems.push(String(req.system ?? ""));
          spy.tools.push((req.tools ?? []) as never);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: "content_block_delta", delta: { type: "text_delta", text } };
            },
            finalMessage: async () => ({ content: [{ type: "text", text }] }),
          };
        },
      },
    };
    return { client, spy };
  }
  async function askBrain(userId: string) {
    const { client, spy } = brainClient();
    for await (const _ of answer(
      { userId, message: "hello there", history: [], sessionId: `${PREFIX}-session` },
      { client },
    )) {
      /* drain */
    }
    return spy;
  }

  const quiet = () => {};
  const RUN = { categories: ["services"] };

  try {
    // ── 1. Sanitizer: junk shapes are empty plans, never throw ──
    for (const junk of [null, "nope", 7, {}, { cards: 7 }, { cards: [null, 3, {}] }]) {
      let threw = false;
      let out: unknown = "unset";
      try {
        out = sanitizeCardPlan(junk as never, SIGNALS_ON, 5);
      } catch {
        threw = true;
      }
      const cards = (out as { cards?: unknown[] })?.cards;
      check(
        `junk plan ${JSON.stringify(junk)} sanitizes empty without throwing`,
        !threw && Array.isArray(cards) && cards.length === 0,
        `threw=${threw} out=${JSON.stringify(out)}`,
      );
    }

    // ── 2. Sanitizer: whitelist and signal gates ──
    const gated = sanitizeCardPlan(
      {
        cards: [
          { kind: "hologram", label: "Nope", reason: "When never", questions: [] },
          { kind: "gallery", label: "Gallery", reason: "When photos", layout: "sideways", questions: [] },
          { kind: "projects", label: "Projects", reason: "When projects", questions: [] },
          { kind: "booking", label: "Book", reason: "When booking", questions: [] },
          { kind: "designed", label: "No brief", reason: "When designed", questions: [] },
          { kind: "contact", label: "Contact", reason: "When contact", questions: [] },
        ],
      },
      { ...SIGNALS_ON, photos: 0, projects: 0, takesAppointments: false },
      5,
    );
    check("unknown kind, gated kinds and a briefless designed card are all dropped",
      gated.cards.length === 1 && gated.cards[0].kind === "contact", JSON.stringify(gated));
    const galleryKept = sanitizeCardPlan(
      { cards: [{ kind: "gallery", label: "Gallery", reason: "When photos", layout: "sideways", questions: [] }] },
      SIGNALS_ON,
      5,
    );
    check("gallery survives with photos and an invalid layout becomes carousel",
      galleryKept.cards.length === 1 && galleryKept.cards[0].layout === "carousel", JSON.stringify(galleryKept));
    const projectsKept = sanitizeCardPlan(
      { cards: [{ kind: "projects", label: "Projects", reason: "When projects", questions: [] }] },
      { ...SIGNALS_ON, projects: 3 },
      5,
    );
    check("projects survives when projects exist", projectsKept.cards.length === 1);
    const designedNoKnowledge = sanitizeCardPlan(
      { cards: [{ kind: "designed", label: "Meet the team", reason: "When asked who runs it", brief: "the team", questions: [] }] },
      { ...SIGNALS_ON, hasKnowledge: false },
      5,
    );
    check("a designed card is dropped when nothing was ever actually extracted",
      designedNoKnowledge.cards.length === 0, JSON.stringify(designedNoKnowledge));

    // ── 3. Sanitizer: caps, dedup, question numbers ──
    const many = sanitizeCardPlan(
      { cards: Array.from({ length: 9 }, (_, i) => ({ kind: "contact", label: `Card ${i}`, reason: "When", questions: [] })) },
      SIGNALS_ON,
      5,
    );
    check("caps at 5 cards", many.cards.length === 5, `${many.cards.length}`);
    const manyDesigned = sanitizeCardPlan(
      { cards: Array.from({ length: 5 }, (_, i) => ({ kind: "designed", label: `Designed ${i}`, reason: "When", brief: "x", questions: [] })) },
      SIGNALS_ON,
      5,
    );
    check("caps at 3 designed cards", manyDesigned.cards.length === 3, `${manyDesigned.cards.length}`);
    const dup = sanitizeCardPlan(
      {
        cards: [
          { kind: "contact", label: "Same", reason: "first", questions: [1, 2, 9, 0, "x"] },
          { kind: "contact", label: "  same ", reason: "second", questions: [2, 3] },
          { kind: "gallery", label: "Other", reason: "third", questions: [2, 3, 3] },
        ],
      },
      SIGNALS_ON,
      5,
    );
    check("a repeated label keeps the first", dup.cards.length === 2 && dup.cards[0].reason === "first", JSON.stringify(dup));
    check("question numbers outside 1..N are dropped",
      JSON.stringify(dup.cards[0].questions) === "[1,2]", JSON.stringify(dup.cards[0].questions));
    check("a question claimed twice belongs to the first card",
      JSON.stringify(dup.cards[1].questions) === "[3]", JSON.stringify(dup.cards[1].questions));

    // ── 4. Provisioning seeds no cards ──
    const fresh = await mkUser("fresh");
    await provisionUserDefaults(fresh);
    const [freshCards, freshProfile, freshPersona, freshTheme, freshSources] = await Promise.all([
      prisma.uiCard.count({ where: { userId: fresh } }),
      prisma.profile.findUnique({ where: { userId: fresh } }),
      prisma.personaConfig.findUnique({ where: { userId: fresh } }),
      prisma.themeConfig.findUnique({ where: { userId: fresh } }),
      prisma.ingestionSource.count({ where: { userId: fresh } }),
    ]);
    check("provisioning creates zero UI cards", freshCards === 0, `cards=${freshCards}`);
    check("the other starter catalogs are still provisioned",
      !!freshProfile && !!freshPersona && !!freshTheme && freshSources > 0,
      `profile=${!!freshProfile} persona=${!!freshPersona} theme=${!!freshTheme} sources=${freshSources}`);

    // ── 5. No starter set in code ──
    const names = Object.keys(uiCardsMod);
    check("lib/uiCards exports no seedStarterUiCards", !names.includes("seedStarterUiCards"), names.join(","));
    check("lib/uiCards exports no STARTER_CARDS", !names.includes("STARTER_CARDS"), names.join(","));
    let hits = "";
    try {
      hits = execFileSync("grep", ["-rlE", "seedStarterUiCards|STARTER_CARDS", "lib", "app", "prisma", "scripts"], {
        cwd: root, encoding: "utf8",
      });
    } catch (e) {
      const err = e as { status?: number; stdout?: string };
      hits = err.status === 1 ? "" : String(err.stdout ?? "grep failed");
    }
    check("no source file references the starter set", hits.trim() === "", hits.trim());

    // ── 6. Empty catalog, empty guidance ──
    const emptyCatalog = await cardCatalog(fresh);
    check("cardCatalog returns [] for an empty table", Array.isArray(emptyCatalog) && emptyCatalog.length === 0,
      JSON.stringify(emptyCatalog));
    const emptyPrompt = await buildSystemPrompt(fresh);
    check("no cards means no USING RICH CARDS section", !emptyPrompt.includes("USING RICH CARDS"));
    const freshSpy = await askBrain(fresh);
    const freshTools = (freshSpy.tools[0] ?? []).map((t) => t.name);
    check("brain reached the model", freshSpy.calls === 1, `${freshSpy.calls}`);
    check("brain offers no card tool on an empty catalog", freshTools.length === 0, freshTools.join(","));

    // ── 7. Round-trip on a real tenant ──
    const userA = await mkTenant("a");
    // The owner attached their own card to question 4 before the run.
    const q4 = (await questionRows(userA))[3];
    await prisma.cannedAnswer.update({ where: { id: q4.id }, data: { cardTool: "show_projects" } });
    const llmA = scriptedLlm(PLAN);
    const draftA = scriptedDraft(DRAFT);
    const runA = await generateOnboardingCards(PAGES, userA, RUN, quiet, { llm: llmA.llm, draft: draftA.draft });
    check("planner seam was used once", llmA.count() === 1, `${llmA.count()}`);
    check("builder seam was used once (one designed card)", draftA.count() === 1, `${draftA.count()}`);
    check("report counts three catalog rows", runA.written === 3, JSON.stringify(runA));
    check("report does not claim it kept an existing catalog", runA.keptExisting === false && runA.failed === false);

    const rowsA = await listUiCards(userA);
    check("three rows written", rowsA.length === 3, `${rowsA.length}`);
    check("rows are in plan order with the right tools",
      rowsA.map((r) => r.tool).join(",") === "show_gallery,show_card,show_contact_form", rowsA.map((r) => r.tool).join(","));
    check("order ascends with the plan", rowsA.every((r, i) => r.order === i), rowsA.map((r) => r.order).join(","));
    check("plan label, description and reason are what was saved",
      rowsA[0].label === "Our work" && rowsA[0].description === "Photos of finished retrofits"
        && rowsA[0].reason === "When a visitor asks to see examples of the work"
        && rowsA[1].label === "Services & pricing" && rowsA[1].reason === PLAN.cards[1].reason,
      JSON.stringify(rowsA.map((r) => [r.label, r.reason])));
    const gallerySample = JSON.parse(rowsA[0].sampleBlock) as { type: string; layout: string; items: { src: string }[] };
    check("gallery sample is the tenant's own photos in the planned layout",
      gallerySample.type === "gallery" && gallerySample.layout === "filmstrip"
        && JSON.stringify(gallerySample.items.map((i) => i.src)) === JSON.stringify(PHOTOS.map((f) => `/api/uploads/${f}`)),
      rowsA[0].sampleBlock.slice(0, 200));
    check("designed row holds the builder's validated block",
      JSON.stringify(JSON.parse(rowsA[1].sampleBlock)) === JSON.stringify(DRAFT_BLOCK), rowsA[1].sampleBlock.slice(0, 200));
    check("designed row key derives from its label", rowsA[1].key === "services-pricing", rowsA[1].key);
    check("contact sample is the contact block", rowsA[2].sampleBlock === JSON.stringify({ type: "contact" }), rowsA[2].sampleBlock);
    check("no booking or projects row was written", rowsA.every((r) => r.tool !== "show_booking" && r.tool !== "show_projects"));
    check("report lists the cards with their keys",
      JSON.stringify(runA.cards.map((c) => c.key)) === JSON.stringify(["our-work", "services-pricing", "get-in-touch"]),
      JSON.stringify(runA.cards));
    const custom = await customCardBlock(userA, "services-pricing");
    check("designed card resolves through customCardBlock", !!custom && custom.type === "custom", JSON.stringify(custom));

    // ── 8. The builder brief ──
    const brief = draftA.seen[0] ?? "";
    check("builder was handed the planner's brief", brief.includes(BRIEF), brief.slice(0, 200));
    check("builder was told the business name", brief.includes(COMPANY));
    check("builder was told the question the card accompanies", brief.includes(QUESTIONS[0]));

    // ── 9. Attachments ──
    const qA = await questionRows(userA);
    check("Q1 carries the designed card",
      qA[0].cardTool === "show_card" && qA[0].cardInput === JSON.stringify({ key: "services-pricing" }),
      `${qA[0].cardTool} ${qA[0].cardInput}`);
    check("Q2 carries the gallery in its planned layout",
      qA[1].cardTool === "show_gallery" && qA[1].cardInput === JSON.stringify({ layout: "filmstrip" }),
      `${qA[1].cardTool} ${qA[1].cardInput}`);
    check("Q3 carries the booking flow", qA[2].cardTool === "show_booking" && qA[2].cardInput === null,
      `${qA[2].cardTool} ${qA[2].cardInput}`);
    check("Q4's owner attachment is untouched", qA[3].cardTool === "show_projects" && qA[3].cardInput === null,
      `${qA[3].cardTool} ${qA[3].cardInput}`);
    check("Q5 (unmapped) stays without a card", qA[4].cardTool === null && qA[4].cardInput === null,
      `${qA[4].cardTool} ${qA[4].cardInput}`);
    check("report counts three attachments", runA.attached === 3, `${runA.attached}`);
    check("question text and order are untouched",
      qA.map((r) => r.question).join("|") === QUESTIONS.join("|") && qA.every((r) => r.answer === ""));

    // ── 10. Chatbot integration ──
    const catalogA = await cardCatalog(userA);
    check("cardCatalog lists the three cards",
      catalogA.map((c) => c.tool).join(",") === "show_gallery,show_card,show_contact_form", JSON.stringify(catalogA));
    const promptA = await buildSystemPrompt(userA);
    check("prompt has USING RICH CARDS", promptA.includes("USING RICH CARDS"));
    check("prompt carries each reason",
      PLAN.cards.slice(0, 3).every((c) => promptA.includes(c.reason)));
    check("prompt names the designed card by key", promptA.includes('show_card with key "services-pricing"'));
    const spyA = await askBrain(userA);
    const toolsA = spyA.tools[0] ?? [];
    const namesA = toolsA.map((t) => t.name);
    check("brain offers gallery, contact, custom and booking tools",
      ["show_gallery", "show_contact_form", "show_card", "show_booking"].every((n) => namesA.includes(n)), namesA.join(","));
    check("brain offers no project tools", !namesA.includes("show_projects") && !namesA.includes("show_project"), namesA.join(","));
    const showCard = toolsA.find((t) => t.name === "show_card");
    check("show_card's key enum holds the designed key",
      JSON.stringify(showCard?.input_schema?.properties?.key?.enum) === JSON.stringify(["services-pricing"]),
      JSON.stringify(showCard?.input_schema));

    // ── 11. Corpus grounding ──
    const sent = llmA.seen[0] ?? "";
    check("corpus carries the page urls", PAGES.every((p) => sent.includes(p.url)), sent.slice(0, 200));
    check("corpus names the business", sent.includes(COMPANY));
    check("corpus carries the goal", sent.includes(GOAL));
    check("corpus lists the numbered starter questions",
      sent.includes("STARTER QUESTIONS") && QUESTIONS.every((q, i) => sent.includes(`${i + 1}. ${q}`)),
      sent.slice(-600));
    check("corpus states the photo count", sent.includes("Gallery photos on file: 2"), sent.slice(-600));
    check("corpus states the booking signal", sent.includes("Takes appointments (customers can book): yes"), sent.slice(-600));
    check("corpus states the knowledge categories", sent.includes("services"));

    // ── 12. Gate: an owner's catalog is never touched ──
    const userB = await mkTenant("b");
    const err = await saveUiCard(userB, {
      key: "", label: "My own card", tool: "show_contact_form", description: "", reason: "When they ask", note: "",
      sampleBlock: '{"type":"contact"}',
    });
    check("fixture owner card saved", err === null, String(err));
    const ownerRow = (await listUiCards(userB))[0];
    const llmB = scriptedLlm(PLAN);
    const draftB = scriptedDraft(DRAFT);
    const runB = await generateOnboardingCards(PAGES, userB, RUN, quiet, { llm: llmB.llm, draft: draftB.draft });
    check("no model call on a non-empty catalog", llmB.count() === 0 && draftB.count() === 0, `${llmB.count()},${draftB.count()}`);
    check("reports it kept the existing catalog", runB.keptExisting === true && runB.written === 0 && runB.attached === 0, JSON.stringify(runB));
    const rowsB = await listUiCards(userB);
    check("owner catalog is exactly its own row, byte-identical",
      rowsB.length === 1 && rowsB[0].id === ownerRow.id && rowsB[0].updatedAt.getTime() === ownerRow.updatedAt.getTime()
        && rowsB[0].label === "My own card",
      JSON.stringify(rowsB.map((r) => r.label)));
    check("owner's questions were not attached", (await questionRows(userB)).every((r) => r.cardTool === null));

    // ── 13. Best-effort ──
    const userC = await mkTenant("c");
    let escapedC = false;
    let runC: { written: number; failed: boolean } | null = null;
    try {
      runC = await generateOnboardingCards(PAGES, userC, RUN, quiet, { llm: throwingLlm, draft: scriptedDraft(DRAFT).draft });
    } catch {
      escapedC = true;
    }
    check("a throwing planner does not throw out of the stage", !escapedC);
    check("failed plan reports failed and zero written", runC?.failed === true && runC?.written === 0, JSON.stringify(runC));
    check("failed plan persists no rows", (await prisma.uiCard.count({ where: { userId: userC } })) === 0);
    check("failed plan attaches nothing", (await questionRows(userC)).every((r) => r.cardTool === null));

    const userD = await mkTenant("d");
    let escapedD = false;
    let runD: Awaited<ReturnType<typeof generateOnboardingCards>> | null = null;
    try {
      runD = await generateOnboardingCards(PAGES, userD, RUN, quiet, { llm: scriptedLlm(PLAN).llm, draft: throwingDraft });
    } catch {
      escapedD = true;
    }
    check("a throwing builder does not throw out of the stage", !escapedD);
    const rowsD = await listUiCards(userD);
    check("live cards still land when the builder fails",
      rowsD.map((r) => r.tool).join(",") === "show_gallery,show_contact_form", rowsD.map((r) => r.tool).join(","));
    check("failed designed card is counted", runD?.designedFailed === 1 && runD?.written === 2, JSON.stringify(runD));
    const qD = await questionRows(userD);
    check("the designed card's question stays unattached", qD[0].cardTool === null, String(qD[0].cardTool));
    check("the other questions are still attached",
      qD[1].cardTool === "show_gallery" && qD[2].cardTool === "show_booking" && qD[3].cardTool === "show_contact_form",
      qD.map((r) => r.cardTool).join(","));

    const userE = await mkTenant("e");
    const badDraft = scriptedDraft({ ...DRAFT, sampleBlock: JSON.stringify({ type: "nonsense" }) });
    const runE = await generateOnboardingCards(PAGES, userE, RUN, quiet, { llm: scriptedLlm(PLAN).llm, draft: badDraft.draft });
    const rowsE = await listUiCards(userE);
    check("a draft saveUiCard rejects is skipped, not saved",
      rowsE.every((r) => r.tool !== "show_card") && rowsE.length === 2 && runE.designedFailed === 1 && runE.written === 2,
      JSON.stringify({ tools: rowsE.map((r) => r.tool), runE }));

    // ── 14. Manual path: no pages still plans from the business context ──
    const userG = await mkTenant("g");
    const llmG = scriptedLlm({ cards: [PLAN.cards[2]] });
    const runG = await generateOnboardingCards([], userG, { categories: [] }, quiet, { llm: llmG.llm, draft: scriptedDraft(DRAFT).draft });
    check("no pages still calls the planner", llmG.count() === 1, `${llmG.count()}`);
    check("no-page corpus still names the business", (llmG.seen[0] ?? "").includes(COMPANY));
    check("no-page corpus carries no page markers", !(llmG.seen[0] ?? "").includes("=== https://"));
    check("contact card lands on the manual path",
      runG.written === 1 && (await listUiCards(userG)).map((r) => r.tool).join(",") === "show_contact_form", JSON.stringify(runG));

    // ── 15. Tenant isolation ──
    check("tenant A's cards are not visible to tenant B",
      (await prisma.uiCard.count({ where: { userId: userB, key: "services-pricing" } })) === 0);
    check("tenant B's card is not visible to tenant A",
      (await prisma.uiCard.count({ where: { userId: userA, label: "My own card" } })) === 0);
  } finally {
    for (const id of created) {
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
    const leftover = await prisma.uiCard.count({ where: { key: { in: ["our-work", "services-pricing", "get-in-touch"] }, userId: { in: created } } });
    const leftUsers = await prisma.user.count({ where: { email: { startsWith: PREFIX } } });
    check("every row and user the proof created is gone", leftover === 0 && leftUsers === 0, `${leftover},${leftUsers}`);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} FAILED` : "\nAll green");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

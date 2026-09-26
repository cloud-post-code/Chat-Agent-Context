import { str } from "@/lib/util/text";
import { prisma } from "@/lib/db";
import { getBookingConfig } from "@/lib/appointments";
import { allProjectsBlock, galleryBlock, listServices, servicesBlock } from "@/lib/cards";
import { listMenu, menuBlock } from "@/lib/menu";
import { draftUiCard, type BuilderDeps, type CardDraft } from "@/lib/cardBuilder";
import { writeUiCard } from "@/lib/uiCards";
import { socialBlock } from "@/lib/social";
import { parseSocialLinks } from "@/lib/socialLinks";
import type { Page } from "./crawl";
import { llmCorpus, llmExtract } from "./knowledgeLlm";

/**
 * The A2UI card planner: one reading of everything onboarding just learned —
 * the pages, the goals, and the starter questions it wrote — turned into the
 * set of cards THIS business's agent should be able to draw.
 *
 * Nothing is seeded at signup any more: the old starter set was written for a
 * personal portfolio and gave a nail salon an "All projects" card. This stage
 * is where a business's cards come from. Live-data cards (the gallery of the
 * photos onboarding imported, the services it read, the contact form, projects
 * when there are any) are written straight into the catalog with the tenant's
 * own data as their preview. Business-specific cards — hours and locations,
 * the team, what to expect — go through the same research-enabled card builder
 * the admin's "Build a card" page uses, so they are drafted from the
 * knowledge base the run just indexed. Every card the plan ties to a starter
 * question is attached to that question, so the visitor who taps the chip
 * sees the card with the answer.
 *
 * Seeding follows the goals rule: only into an EMPTY catalog. Re-onboarding
 * wipes the catalog first, so a re-run designs afresh; an owner who has built
 * or kept any card keeps exactly what they have.
 */

const CARDS_SYSTEM_PROMPT = `You plan the visual "cards" an AI chat agent can show visitors on a business's website. A card is a rich UI block drawn inside the chat beside the agent's words. Your job: decide which cards THIS business's agent should have, from the website text, what the business wants out of a conversation, and the starter questions visitors will tap first.

The text contains the site's pages, each preceded by "=== <url>", then a BUSINESS section, a SIGNALS section stating what the site actually has, and the numbered STARTER QUESTIONS.

Card kinds:
- "gallery": the business's own photos. Only when SIGNALS lists gallery photos. "layout" is "carousel" (one photo at a time) or "filmstrip" (thumbnails with a lightbox).
- "services": the business's services, listed straight from what onboarding saved, each with a Book button when the business takes appointments. Only when SIGNALS lists services on file.
- "menu": the business's menu the visitor can order from — items with prices, options and add-ons, each addable to a cart with a quantity, and a checkout. Only when SIGNALS says the business has something orderable without booking a visit. Plan "menu" when the business sells things a visitor picks several of and can buy right there (dishes, drinks, products, treatments with add-ons sold on their own); plan "services" when it is a plain list booked one at a time, or when SIGNALS says nothing is orderable without booking — an appointment-only service list is "services", never "menu", however many extras it has. One of the two is ALWAYS planned when services are on file, for the question about what the business offers — never both.
- "contact": the in-chat contact form — the visitor leaves their name, email and a message for the business.
- "projects": the business's project portfolio. Only when SIGNALS lists projects.
- "booking": the in-chat appointment flow. Only when SIGNALS says the business takes appointments. Use it for the question about booking or scheduling.
- "social": the business's own social media links as clickable buttons. Only when SIGNALS lists social links on file.
- "designed": a card designed for this business from its own content. Examples span hours and locations, directions and parking, accessibility, service area, meet-the-team and staff expertise, founder story, credentials and licenses, awards and affiliations, testimonials and reviews, portfolio or before/after, pricing and packages, deposits and fees, policies (cancellation, rescheduling, no-show, refund, guarantee), an FAQ, a what-to-expect-on-your-first-visit walkthrough, insurance and financing accepted, and any other content the site itself spends real space on — plan whichever of these (or something else entirely) the site's actual pages support, and nothing the site is silent on. "brief" tells the card builder what the card shows and what to look up in the business's knowledge base. It never states a number, name or claim you are not copying from the text.

Rules:
- Every card serves what a prospective customer of THIS business needs, named in the business's own words for what it sells.
- Never plan a "designed" card that lists services or prices: the "services" card does that from live data, and a designed copy goes stale.
- Never plan a card for content the site does not have. Never invent a service, price, person or policy.
- "reason" is the instruction the agent will receive about when to show the card. Write it as guidance starting "When …".
- "questions" lists the numbers of the starter questions this card should appear with — the card answers that question visually. A question belongs to at most one card; leave the list empty when no starter question fits.
- At most 5 cards, at most 3 of them "designed". Fewer, sharper cards beat padding. Nothing groundable? Return an empty list.

Respond with ONLY this JSON, no other text:
{"cards":[{"kind":"gallery|services|menu|contact|projects|booking|social|designed","label":"","description":"one line on what it renders","reason":"When …","layout":"carousel|filmstrip","brief":"","questions":[1]}]}`;

export type CardKind =
  | "gallery"
  | "services"
  | "menu"
  | "contact"
  | "projects"
  | "booking"
  | "social"
  | "designed";
const KINDS: readonly CardKind[] = [
  "gallery", "services", "menu", "contact", "projects", "booking", "social", "designed",
];

export type PlannedCard = {
  kind: CardKind;
  label: string;
  description: string;
  /** The guidance the chatbot receives: when to show this card. */
  reason: string;
  layout: "carousel" | "filmstrip";
  /** What the card builder is told to design; designed cards only. */
  brief: string;
  /** 1-based numbers of the starter questions this card accompanies. */
  questions: number[];
};

export type CardPlan = { cards: PlannedCard[] };

/** What the account actually has, so the plan cannot name a card with no data behind it. */
export type CardSignals = {
  photos: number;
  projects: number;
  /** Services on file — what the services card would list. */
  services: number;
  /** True when some item on file can be bought without booking an appointment
   *  for it (a real fulfillment other than "appointment") — the one thing that
   *  makes a cart/checkout ("menu") make sense instead of a plain, booked-one-
   *  at-a-time services list. */
  menuOrderable: boolean;
  takesAppointments: boolean;
  contactChannels: string[];
  /** Social links on file — what the social card would show. */
  socialLinks: number;
  /** Knowledge categories that produced content this run. */
  categories: string[];
  /** True when the account has any real extracted knowledge (a scanned
   *  Source) on file — the one thing a "designed" card's research step can
   *  actually ground itself in, instead of relying on the model's own
   *  restraint not to invent one. */
  hasKnowledge: boolean;
};

export type CardsReport = {
  /** Catalog rows actually written. */
  written: number;
  /** Starter questions that now carry a card. */
  attached: number;
  /** True when the tenant already had cards, so nothing was planned. */
  keptExisting: boolean;
  /** True when the planning call failed; the stage is best-effort. */
  failed: boolean;
  /** Designed cards the builder could not produce or the catalog refused. */
  designedFailed: number;
  cards: { key: string; label: string; tool: string }[];
};

/** A short, sharp catalog the owner will read beats a wall the model pads out. */
const MAX_CARDS = 5;
const MAX_DESIGNED = 3;
const MAX_LABEL = 80;
const MAX_TEXT = 300;
const MAX_BRIEF = 1200;
const PLAN_MAX_TOKENS = 2000;

function kindAllowed(kind: CardKind, signals: CardSignals): boolean {
  if (kind === "gallery") return signals.photos > 0;
  if (kind === "projects") return signals.projects > 0;
  if (kind === "services") return signals.services > 0;
  // "menu" additionally needs something a visitor can actually check out
  // without booking a visit — otherwise a plain appointment-only service list
  // would get an "add to cart" it was never meant to have.
  if (kind === "menu") return signals.services > 0 && signals.menuOrderable;
  if (kind === "booking") return signals.takesAppointments;
  if (kind === "social") return signals.socialLinks > 0;
  // "designed" has no table of its own to gate on — hours, team, policies,
  // an FAQ, all of it — so the one hard floor is that SOME real knowledge was
  // actually extracted for the builder to research and copy from, on top of
  // the prompt's own instruction never to invent a claim the site never made.
  if (kind === "designed") return signals.hasKnowledge;
  return true;
}

/** Valid, unclaimed 1-based question numbers; claims them as it goes. */
function claimQuestions(raw: unknown, questionCount: number, claimed: Set<number>): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const q of raw) {
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > questionCount) continue;
    if (claimed.has(q)) continue;
    claimed.add(q);
    out.push(q);
  }
  return out;
}

/**
 * Model output → typed, whitelisted, signal-gated, capped, de-duplicated plan.
 * Never throws: junk of any shape comes back as an empty plan (the
 * sanitizeGoals contract).
 */
export function sanitizeCardPlan(
  raw: Record<string, unknown> | null,
  signals: CardSignals,
  questionCount: number,
): CardPlan {
  const out: CardPlan = { cards: [] };
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { cards?: unknown }).cards)) {
    return out;
  }
  const labels = new Set<string>();
  const claimed = new Set<number>();
  let designed = 0;
  for (const c of (raw as { cards: unknown[] }).cards) {
    if (!c || typeof c !== "object") continue;
    const item = c as Record<string, unknown>;
    const kind = String(item.kind ?? "") as CardKind;
    if (!KINDS.includes(kind) || !kindAllowed(kind, signals)) continue;
    const label = str(item.label, MAX_LABEL);
    if (!label || labels.has(label.toLowerCase())) continue;
    const brief = str(item.brief, MAX_BRIEF);
    if (kind === "designed") {
      if (!brief || designed >= MAX_DESIGNED) continue;
      designed++;
    }
    labels.add(label.toLowerCase());
    out.cards.push({
      kind,
      label,
      description: str(item.description, MAX_TEXT),
      reason: str(item.reason, MAX_TEXT),
      layout: item.layout === "filmstrip" ? "filmstrip" : "carousel",
      brief,
      questions: claimQuestions(item.questions, questionCount, claimed),
    });
    if (out.cards.length === MAX_CARDS) break;
  }
  // The menu lists the same items the services card does, with a cart on top:
  // a plan naming both would give the model two cards for one question.
  if (out.cards.some((c) => c.kind === "menu")) out.cards = out.cards.filter((c) => c.kind !== "services");
  return out;
}

export type Business = { name: string; text: string };

/** Everything the system knows about the business, as a corpus block. */
export async function businessBlock(userId: string): Promise<Business> {
  const [profile, persona, goals, sources] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.personaConfig.findUnique({ where: { userId } }),
    prisma.agentDirective.findMany({
      where: { userId, kind: "goal", enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
    prisma.source.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { title: true },
    }),
  ]);
  const name = profile?.company_name.trim() || profile?.owner_name.trim() || "this business";
  const lines: string[] = [`Business: ${name}`];
  if (profile?.owner_name) lines.push(`Owner: ${profile.owner_name}`);
  if (profile?.company_address) lines.push(`Address: ${profile.company_address}`);
  if (profile?.company_hours) lines.push(`Hours: ${profile.company_hours}`);
  if (persona?.tagline) lines.push(`Tagline: ${persona.tagline}`);
  try {
    const values = JSON.parse(persona?.brandValues || "[]");
    if (Array.isArray(values) && values.length) lines.push(`Brand values: ${values.join(", ")}`);
  } catch {
    /* malformed brandValues never blocks planning */
  }
  if (goals.length) {
    lines.push("Goals for visitor conversations:");
    for (const g of goals) lines.push(`- ${g.text}`);
  }
  const titles = sources.map((s) => s.title).filter(Boolean);
  if (titles.length) lines.push(`Knowledge on file: ${titles.join("; ")}`);
  return { name, text: lines.join("\n") };
}

/** What the account has, read from the tables the cards would draw from. */
export async function readSignals(userId: string, categories: string[]): Promise<CardSignals> {
  const [photos, projects, services, booking, profile, sources] = await Promise.all([
    // The public gallery shows the owner's curated kinds, not ingested images.
    prisma.photo.count({ where: { userId, NOT: { kind: { startsWith: "ingest:" } } } }),
    prisma.project.count({ where: { userId } }),
    listServices(userId),
    getBookingConfig(userId),
    prisma.profile.findUnique({ where: { userId } }),
    prisma.source.count({ where: { userId, status: "scanned" } }),
  ]);
  const contactChannels = [
    profile?.company_email ? "email" : "",
    profile?.company_phone_number ? "phone" : "",
    profile?.company_address ? "address" : "",
  ].filter(Boolean);
  // Items synthesized from the services catalog (no MenuItem rows yet) carry
  // no fulfillment tag, so they read as not-orderable — the safe default when
  // nothing on file says otherwise.
  const menu = services.length ? await listMenu(userId) : [];
  return {
    photos,
    projects,
    services: services.length,
    menuOrderable: menu.some((m) => m.fulfillment.some((f) => f !== "appointment")),
    takesAppointments: booking.enabled && booking.fields.length > 0,
    contactChannels,
    socialLinks: parseSocialLinks(profile?.social_links ?? "[]").length,
    categories: categories.filter(Boolean),
    hasKnowledge: sources > 0,
  };
}

/** The corpus: the pages read, then the business, the signals, and the questions. */
function cardsCorpus(
  pages: Page[],
  business: Business,
  signals: CardSignals,
  questions: string[],
): string {
  const pagesBlock = pages.length
    ? llmCorpus(pages)
    : "=== (no pages: this business was set up by hand, so plan only from what follows)";
  return `${pagesBlock}\n\n${contextBlocks(business, signals, questions)}`;
}

/** The BUSINESS, SIGNALS and STARTER QUESTIONS blocks every card planner reads. */
export function contextBlocks(business: Business, signals: CardSignals, questions: string[]): string {
  return (
    `=== BUSINESS\n${business.text}\n\n=== SIGNALS\n` +
    `Gallery photos on file: ${signals.photos}\n` +
    `Projects on file: ${signals.projects}\n` +
    `Services on file: ${signals.services}\n` +
    `Something orderable without booking (a real cart checkout makes sense): ${signals.menuOrderable ? "yes" : "no"}\n` +
    `Takes appointments (customers can book): ${signals.takesAppointments ? "yes" : "no"}\n` +
    `Contact channels listed: ${signals.contactChannels.length ? signals.contactChannels.join(", ") : "none"}\n` +
    `Social links on file: ${signals.socialLinks}\n` +
    `Knowledge this site provided: ${signals.categories.length ? signals.categories.join(", ") : "none"}\n\n` +
    `=== STARTER QUESTIONS\n` +
    (questions.length ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n") : "(none yet)")
  );
}

type LlmFn = typeof llmExtract;
/** The card builder, narrowed to the one call this module makes. */
export type DraftFn = (
  userId: string,
  input: { instructions: string },
  deps?: BuilderDeps,
) => Promise<CardDraft>;

export type CardsDeps = { llm?: LlmFn; draft?: DraftFn };

/** The brief the builder gets: the plan's idea, the question it answers, and the no-inventing rule. */
function designedInstructions(business: Business, card: PlannedCard, questions: string[]): string {
  const asked = card.questions.map((n) => questions[n - 1]).filter(Boolean);
  return [
    `Design a card for ${business.name}'s website chat agent: ${card.brief}`,
    asked.length
      ? `It will be shown when a visitor asks: ${asked.map((q) => `"${q}"`).join(", ")}.`
      : "",
    "Build its content from the knowledge base — search it for the real names, offerings and "
      + "details — and never invent prices, names or claims that are not there.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The canned-answer args that draw a card of this tool at chat time. */
function attachInput(tool: string, key: string, layout: PlannedCard["layout"]): string | null {
  if (tool === "show_card") return JSON.stringify({ key });
  if (tool === "show_gallery") return JSON.stringify({ layout });
  if (tool === "show_social") return JSON.stringify({});
  return null;
}

export type Placed =
  | { ok: true; card: PlannedCard; tool: string; key: string; cardInput: string | null; row: boolean }
  | { ok: false; card: PlannedCard };

/** A live-data card's preview: the tenant's own data, so the admin sees what visitors will. */
async function liveSample(userId: string, card: PlannedCard): Promise<{ tool: string; sample: string }> {
  if (card.kind === "gallery") {
    return { tool: "show_gallery", sample: JSON.stringify(await galleryBlock(userId, { layout: card.layout })) };
  }
  if (card.kind === "projects") {
    return { tool: "show_projects", sample: JSON.stringify(await allProjectsBlock(userId, {})) };
  }
  if (card.kind === "services") {
    // The signal gate means services exist; the fallback only covers a record
    // deleted between the plan and this read.
    const block = (await servicesBlock(userId)) ?? { type: "services", items: [], booking: null };
    return { tool: "show_services", sample: JSON.stringify(block) };
  }
  if (card.kind === "menu") {
    const block = (await menuBlock(userId, {})) ?? {
      type: "menu", title: "Menu", full: true, items: [],
      checkout: { fulfillment: [], contact: { phone: "off", email: "required" }, currency: "" },
    };
    return { tool: "show_menu", sample: JSON.stringify(block) };
  }
  if (card.kind === "social") {
    const block = (await socialBlock(userId, {})) ?? { type: "social", items: [] };
    return { tool: "show_social", sample: JSON.stringify(block) };
  }
  return { tool: "show_contact_form", sample: JSON.stringify({ type: "contact" }) };
}

/**
 * Put one planned card in place. Booking writes no row (booking is gated by
 * its own toggle, not the catalog) and only exists to be attached. Never
 * throws: a failed draft or a rejected row is that card's loss alone.
 */
export async function placeCard(
  userId: string,
  card: PlannedCard,
  order: number,
  business: Business,
  questions: string[],
  draft: DraftFn,
  onEvent: (m: string) => void,
): Promise<Placed> {
  if (card.kind === "booking") {
    return { ok: true, card, tool: "show_booking", key: "", cardInput: null, row: false };
  }
  try {
    let tool: string;
    let sample: string;
    let note = "";
    let description = card.description;
    let reason = card.reason;
    if (card.kind === "designed") {
      onEvent(`Building the "${card.label}" card`);
      const d = await draft(userId, { instructions: designedInstructions(business, card, questions) }, {
        onEvent: (e) => {
          if (e.t === "search") onEvent(`Researching "${e.query}" for the "${card.label}" card`);
          else if (e.t === "status") onEvent(`${card.label}: ${e.v}`);
        },
      });
      tool = d.tool;
      sample = d.sampleBlock;
      note = d.note;
      description = description || d.description;
      reason = reason || d.reason;
    } else {
      ({ tool, sample } = await liveSample(userId, card));
    }
    const written = await writeUiCard(userId, {
      key: "", label: card.label, tool, description, reason, note, sampleBlock: sample, order,
    });
    if (!written.ok) {
      onEvent(`Couldn't keep the "${card.label}" card (${written.error}) — you can build it under A2UI`);
      return { ok: false, card };
    }
    onEvent(`Card ready: ${card.label}`);
    return { ok: true, card, tool, key: written.key, cardInput: attachInput(tool, written.key, card.layout), row: true };
  } catch (e) {
    const why = e instanceof Error ? e.message.slice(0, 120) : String(e);
    onEvent(`Couldn't build the "${card.label}" card (${why}) — you can build it under A2UI`);
    return { ok: false, card };
  }
}

/**
 * Point each starter question the plan named at its card. Only rows with no
 * card attached are touched — the guard is in the WHERE, so an owner's own
 * attachment can never be overwritten, whatever the plan said.
 */
export async function attachToQuestions(
  userId: string,
  placed: Placed[],
  questionIds: string[],
): Promise<number> {
  let attached = 0;
  for (const p of placed) {
    if (!p.ok) continue;
    for (const n of p.card.questions) {
      const id = questionIds[n - 1];
      if (!id) continue;
      const r = await prisma.cannedAnswer.updateMany({
        where: { id, userId, cardTool: null },
        data: { cardTool: p.tool, cardInput: p.cardInput },
      });
      attached += r.count;
    }
  }
  return attached;
}

/**
 * Plan and write the tenant's cards, then attach them to the starter
 * questions. `deps.llm` (the planner) and `deps.draft` (the card builder) are
 * the two injectable boundaries so proofs run offline; sanitizing, the
 * writeUiCard path and the attachment writes are the real paths.
 *
 * Best-effort by contract: nothing thrown escapes. This runs after the
 * knowledge and the questions are already saved, and losing a card must never
 * cost a completed onboarding.
 */
export async function generateOnboardingCards(
  pages: Page[],
  userId: string,
  run: { categories: string[] },
  onEvent: (m: string) => void,
  deps: CardsDeps = {},
): Promise<CardsReport> {
  const report: CardsReport = {
    written: 0, attached: 0, keptExisting: false, failed: false, designedFailed: 0, cards: [],
  };
  try {
    // The gate first: an existing catalog is the tenant's, so don't spend the
    // model call on a plan we would refuse to write.
    if ((await prisma.uiCard.count({ where: { userId } })) > 0) {
      report.keptExisting = true;
      return report;
    }

    const [signals, business, rows] = await Promise.all([
      readSignals(userId, run.categories),
      businessBlock(userId),
      prisma.cannedAnswer.findMany({
        where: { userId, enabled: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, question: true },
      }),
    ]);
    const questions = rows.map((r) => r.question);

    const llm = deps.llm ?? llmExtract;
    let plan: CardPlan;
    try {
      const raw = await llm(
        CARDS_SYSTEM_PROMPT, cardsCorpus(pages, business, signals, questions), PLAN_MAX_TOKENS, onEvent,
      );
      plan = sanitizeCardPlan(raw, signals, questions.length);
    } catch {
      report.failed = true;
      return report;
    }
    if (!plan.cards.length) return report;

    // Rows take the plan's order; booking holds no slot. Cards are placed
    // concurrently — a designed card can take the builder a minute or two,
    // and the live ones should not wait behind it.
    let order = 0;
    const draft = deps.draft ?? draftUiCard;
    const placed = await Promise.all(
      plan.cards.map((card) =>
        placeCard(userId, card, card.kind === "booking" ? -1 : order++, business, questions, draft, onEvent),
      ),
    );
    for (const p of placed) {
      if (!p.ok) report.designedFailed++;
      else if (p.row) {
        report.written++;
        report.cards.push({ key: p.key, label: p.card.label, tool: p.tool });
      }
    }
    report.attached = await attachToQuestions(userId, placed, rows.map((r) => r.id));
    return report;
  } catch (e) {
    console.error(`generateOnboardingCards(${userId}) failed:`, e);
    report.failed = true;
    return report;
  }
}

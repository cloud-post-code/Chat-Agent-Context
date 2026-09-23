import { prisma } from "@/lib/db";
import { llmExtract } from "@/lib/onboarding/knowledgeLlm";
import {
  attachToQuestions,
  businessBlock,
  contextBlocks,
  placeCard,
  readSignals,
  sanitizeCardPlan,
  type CardKind,
  type CardSignals,
  type CardsDeps,
  type PlannedCard,
} from "@/lib/onboarding/cards";
import { draftUiCard } from "@/lib/cardBuilder";

/**
 * The site-cards agent: the A2UI tab's "Build cards from my site" button.
 *
 * Onboarding designs a card set once, into an empty catalog. This is the
 * on-demand pass after that: it re-reads the site the business imported — the
 * link Sources already in the database, so no crawling and no browser — sets
 * it beside the cards the catalog already has, works out which visitor needs
 * are still unserved, and builds a card for each through the same placement
 * path onboarding uses (live-data cards from the tenant's own data, designed
 * cards through the research-enabled card builder).
 *
 * Strictly additive: existing rows are never edited, replaced or deleted, and
 * a need the catalog already covers — same tool for a live-data card, same
 * label for any card — is dropped before anything is built.
 */

export const SITE_CARDS_SYSTEM_PROMPT = `You review a business's website and decide which visual "cards" its AI chat agent is still missing. A card is a rich UI block drawn inside the chat beside the agent's words.

The text contains the site's imported pages, each preceded by "=== <url>", then EXISTING CARDS (what the agent can already draw), a BUSINESS section, a SIGNALS section stating what the account actually has, and the numbered STARTER QUESTIONS.

Work in two steps. First determine the NEEDS: what does a prospective customer of THIS business come to the site to find out or do, judging by what the site itself spends its pages on? Then, for each need the EXISTING CARDS do not already serve, plan the one card that serves it.

Card kinds:
- "gallery": the business's own photos. Only when SIGNALS lists gallery photos. "layout" is "carousel" or "filmstrip".
- "services": the business's services from live data. Only when SIGNALS lists services on file.
- "contact": the in-chat contact form.
- "projects": the project portfolio. Only when SIGNALS lists projects.
- "designed": a card designed for this business from its own content — hours and locations, meet the team, what to expect on a first visit, parking and access, an FAQ, testimonials, policies, a process walkthrough. "brief" tells the card builder what the card shows and what to look up in the business's knowledge base. It never states a number, name or claim you are not copying from the text.

Rules:
- Every need is grounded in a page: "evidence" is the URL, copied exactly from a "=== <url>" line, where the site shows this need. "need" is one sentence naming the visitor and what they want.
- Never plan a card the EXISTING CARDS already cover, and never a second card with an existing card's name.
- Never plan a "designed" card that lists services or prices: the "services" card does that from live data.
- Never plan a card for content the site does not have. Never invent a service, price, person or policy.
- "reason" is the instruction the agent will receive about when to show the card, starting "When …".
- "questions" lists the numbers of the starter questions this card should appear with; a question belongs to at most one card; empty when none fits.
- At most 4 needs, at most 3 of them "designed". Nothing missing? Return an empty list — that is a good answer.

Respond with ONLY this JSON, no other text:
{"needs":[{"need":"","evidence":"https://…","kind":"gallery|services|contact|projects|designed","label":"","description":"one line on what it renders","reason":"When …","layout":"carousel|filmstrip","brief":"","questions":[1]}]}`;

export type SiteCard = PlannedCard & {
  /** The visitor need this card serves, in one sentence. */
  need: string;
  /** The imported page the need was read from; "" when the model named none we hold. */
  evidence: string;
};

export type SiteCardPlan = { cards: SiteCard[] };

export type SiteCardsEvent =
  | { t: "status"; v: string }
  | { t: "need"; need: string; evidence: string; label: string; kind: CardKind }
  | { t: "card"; key: string; label: string; tool: string };

export type SiteCardsReport = {
  /** Catalog rows actually written. */
  written: number;
  /** Starter questions that now carry one of the new cards. */
  attached: number;
  /** Imported pages the agent read. */
  pagesRead: number;
  /** True when the tenant has no imported site to read; nothing was planned. */
  noSite: boolean;
  /** True when the planning call failed. */
  failed: boolean;
  /** Cards the builder could not produce or the catalog refused. */
  designedFailed: number;
  cards: { key: string; label: string; tool: string; need: string }[];
};

const MAX_SITE_CARDS = 4;
const MAX_NEED = 240;
const PER_PAGE = 2500;
const CORPUS_TOTAL = 40_000;
const MAX_PAGES = 40;
const PLAN_MAX_TOKENS = 2500;

/** The tool a live-data kind draws with; the catalog holds one row per such tool. */
const LIVE_TOOL: Partial<Record<CardKind, string>> = {
  gallery: "show_gallery",
  services: "show_services",
  contact: "show_contact_form",
  projects: "show_projects",
};

type ExistingCard = { label: string; tool: string };

/**
 * Model output → the cards worth building. Needs the catalog already covers
 * are removed BEFORE the onboarding sanitizer runs, so a dropped card never
 * holds a starter question a kept card could have had. Never throws.
 */
export function sanitizeSiteCardPlan(
  raw: Record<string, unknown> | null,
  signals: CardSignals,
  questionCount: number,
  existing: ExistingCard[],
  siteUrls: string[],
): SiteCardPlan {
  const needs = raw && typeof raw === "object" ? (raw as { needs?: unknown }).needs : null;
  if (!Array.isArray(needs)) return { cards: [] };

  const takenLabels = new Set(existing.map((e) => e.label.trim().toLowerCase()));
  const takenTools = new Set(existing.map((e) => e.tool));
  const urls = new Set(siteUrls);
  const meta = new Map<string, { need: string; evidence: string }>();
  const candidates: unknown[] = [];
  for (const n of needs) {
    if (!n || typeof n !== "object") continue;
    const item = n as Record<string, unknown>;
    const need = typeof item.need === "string" ? item.need.trim().slice(0, MAX_NEED) : "";
    const label = typeof item.label === "string" ? item.label.trim().toLowerCase() : "";
    const kind = String(item.kind ?? "") as CardKind;
    if (!need || !label || kind === "booking") continue;
    if (takenLabels.has(label) || takenTools.has(LIVE_TOOL[kind] ?? "")) continue;
    const evidence = typeof item.evidence === "string" && urls.has(item.evidence.trim())
      ? item.evidence.trim()
      : "";
    if (!meta.has(label)) meta.set(label, { need, evidence });
    candidates.push(item);
  }

  const base = sanitizeCardPlan({ cards: candidates }, signals, questionCount);
  return {
    cards: base.cards.slice(0, MAX_SITE_CARDS).map((c) => ({
      ...c,
      ...(meta.get(c.label.toLowerCase()) ?? { need: "", evidence: "" }),
    })),
  };
}

type SitePage = { url: string; title: string; text: string };

/** The imported site: every link source with text, freshest first. */
async function importedPages(userId: string): Promise<SitePage[]> {
  const rows = await prisma.source.findMany({
    where: { userId, type: "link", url: { not: null }, rawText: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: MAX_PAGES,
    select: { url: true, title: true, rawText: true },
  });
  return rows
    .map((r) => ({ url: r.url ?? "", title: r.title ?? "", text: (r.rawText ?? "").replace(/\s+/g, " ").trim() }))
    .filter((p) => p.url && p.text);
}

function siteCorpus(pages: SitePage[], existing: (ExistingCard & { reason: string })[]): string {
  const site = pages
    .map((p) => `=== ${p.url}\n${p.title ? `${p.title}\n` : ""}${p.text.slice(0, PER_PAGE)}`)
    .join("\n\n")
    .slice(0, CORPUS_TOTAL);
  const cards = existing.length
    ? existing.map((e) => `- ${e.label} (${e.tool})${e.reason ? ` — ${e.reason}` : ""}`).join("\n")
    : "(none yet)";
  return `${site}\n\n=== EXISTING CARDS\n${cards}`;
}

/** The builder's brief for a designed card, with the need and its page spelled out. */
function withNeed(card: SiteCard): PlannedCard {
  if (card.kind !== "designed") return card;
  const brief = [
    card.brief,
    `The visitor need this card serves: ${card.need}`,
    card.evidence ? `The business's site covers this at ${card.evidence}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { ...card, brief };
}

/**
 * Read the imported site, determine the unserved needs, build their cards.
 * `deps.llm` (the planner) and `deps.draft` (the card builder) are the two
 * injectable boundaries so proofs run offline. Best-effort: nothing thrown
 * escapes, and one failed card costs that card only.
 */
export async function buildCardsFromSite(
  userId: string,
  onEvent: (e: SiteCardsEvent) => void,
  deps: CardsDeps = {},
): Promise<SiteCardsReport> {
  const report: SiteCardsReport = {
    written: 0, attached: 0, pagesRead: 0, noSite: false, failed: false, designedFailed: 0, cards: [],
  };
  const status = (v: string) => onEvent({ t: "status", v });
  try {
    const pages = await importedPages(userId);
    if (!pages.length) {
      report.noSite = true;
      status("No imported site to read yet — add your site under Sources first");
      return report;
    }
    report.pagesRead = pages.length;
    status(`Reading the ${pages.length} page${pages.length === 1 ? "" : "s"} imported from your site`);

    const [signals, business, existing, questionRows] = await Promise.all([
      readSignals(userId, []),
      businessBlock(userId),
      prisma.uiCard.findMany({
        where: { userId },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { label: true, tool: true, reason: true, order: true },
      }),
      prisma.cannedAnswer.findMany({
        where: { userId, enabled: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, question: true },
      }),
    ]);
    const questions = questionRows.map((r) => r.question);

    status("Working out what your visitors need that your cards don't cover yet");
    let plan: SiteCardPlan;
    try {
      const raw = await (deps.llm ?? llmExtract)(
        SITE_CARDS_SYSTEM_PROMPT,
        `${siteCorpus(pages, existing)}\n\n${contextBlocks(business, signals, questions)}`,
        PLAN_MAX_TOKENS,
        status,
      );
      plan = sanitizeSiteCardPlan(raw, signals, questions.length, existing, pages.map((p) => p.url));
    } catch (e) {
      console.error(`buildCardsFromSite(${userId}) planning failed:`, e);
      report.failed = true;
      return report;
    }
    if (!plan.cards.length) {
      status("Nothing new to add — your cards already cover what the site offers");
      return report;
    }
    for (const c of plan.cards) {
      onEvent({ t: "need", need: c.need, evidence: c.evidence, label: c.label, kind: c.kind });
    }

    // New rows go after the catalog's last, in plan order. Orders are fixed up
    // front because the cards are placed concurrently.
    const first = existing.reduce((max, e) => Math.max(max, e.order), -1) + 1;
    const draft = deps.draft ?? draftUiCard;
    const placed = await Promise.all(
      plan.cards.map(async (card, i) => {
        const p = await placeCard(userId, withNeed(card), first + i, business, questions, draft, status);
        if (p.ok && p.row) onEvent({ t: "card", key: p.key, label: card.label, tool: p.tool });
        return p;
      }),
    );
    placed.forEach((p, i) => {
      if (!p.ok) report.designedFailed++;
      else if (p.row) {
        report.written++;
        report.cards.push({ key: p.key, label: p.card.label, tool: p.tool, need: plan.cards[i].need });
      }
    });
    report.attached = await attachToQuestions(userId, placed, questionRows.map((r) => r.id));
    return report;
  } catch (e) {
    console.error(`buildCardsFromSite(${userId}) failed:`, e);
    report.failed = true;
    return report;
  }
}

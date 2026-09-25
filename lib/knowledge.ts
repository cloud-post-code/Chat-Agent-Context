import { prisma, getProfile, getPersonaConfig } from "./db";
import { personaPromptBlock } from "./persona";
import { goalsPromptSection, rulesPromptLines } from "./directives";
import { retrieve, formatContext } from "./retrieval/search";
import { broadOverviews } from "./retrieval/clusters";
import { cardCatalog, type CardGuidance } from "./uiCards";
import { parseSocialLinks } from "./socialLinks";
import { parsePhotoTags, photoIndexLines } from "./photoIndex";
import { priceFromText } from "./bookingMenu";
import { serviceIndexLines, type ServiceMeta } from "./serviceIndex";

/**
 * Assembles the chatbot's system prompt: a persona core (profile, projects,
 * photos, contact, A2UI instructions, corrections) plus knowledge for THIS
 * question, retrieved from the chunk/entity index built at ingest time.
 * The admin controls all of this content, so the bot only speaks from it.
 *
 * When no query is given, or nothing has been indexed yet (pre-backfill),
 * we fall back to the legacy dump of recent source summaries so the bot is
 * never knowledge-blind.
 *
 * The prompt also tells Claude HOW to use the A2UI tools, from the card
 * catalog Blake edits on the admin A2UI tab (lib/uiCards.ts) — each card's
 * "when to show it" text becomes a line of the USING RICH CARDS section.
 */
export async function buildSystemPrompt(userId: string, query?: string): Promise<string> {
  const [profile, personaConfig, projects, photos, corrections, chunkCount, directives] = await Promise.all([
    getProfile(userId),
    getPersonaConfig(userId),
    prisma.project.findMany({ where: { userId }, orderBy: { order: "asc" } }),
    // The prompt's gallery listing is curated photos only; custom-ingested
    // images (`ingest:*` marks) reach the model through retrieval chunks.
    prisma.photo.findMany({
      where: { userId, NOT: { kind: { startsWith: "ingest:" } } },
      orderBy: { order: "asc" },
    }),
    // Admin corrections: bad answers the owner flagged with a note on the
    // Activity tab. These steer the bot away from repeating mistakes.
    prisma.chatMessage.findMany({
      where: {
        role: "assistant",
        rating: "down",
        note: { not: null },
        session: { userId },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { note: true },
    }),
    prisma.chunk.count({ where: { userId } }),
    // Goals and rules from the Agent Behavior tabs. One fetch for both kinds;
    // the renderers below split them.
    prisma.agentDirective.findMany({
      where: { userId, enabled: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // Just the index — id, name and links. Every project's blurb and write-up is
  // chunked and retrieved on demand, so the ids are here purely so show_project
  // can be called and the links can be quoted.
  const projectBlock = projects.length
    ? projects
        .map((p) => {
          const links = [
            p.githubUrl ? `GitHub: ${p.githubUrl}` : null,
            p.liveUrl ? `Live: ${p.liveUrl}` : null,
          ]
            .filter(Boolean)
            .join(" | ");
          return `- (id:${p.id}) ${p.name}${links ? ` [${links}]` : ""}`;
        })
        .join("\n")
    : "(No projects added yet.)";

  const sourceBlock = await knowledgeBlock(userId, query, chunkCount);

  const correctionNotes = corrections
    .map((c) => c.note?.trim())
    .filter((n): n is string => !!n);
  const correctionBlock = correctionNotes.length
    ? `\n\nCORRECTIONS (${speakerName(profile)} reviewed past answers and flagged these — follow them strictly, they override nothing factual above but tell you how to behave):\n${correctionNotes
        .map((n) => `- ${n}`)
        .join("\n")}`
    : "";

  // The card catalog the admin curates on the A2UI tab: which cards exist and
  // when to show each.
  const cards = await cardCatalog(userId);
  const cardTools = new Set(cards.map((c) => c.tool));

  // Booking config and flow are each read at most once per prompt build, then
  // threaded through the sections that need them (serviceIndexSection,
  // hasBookingOrSocialTools, bookingPromptSection) instead of every section
  // re-fetching its own copy.
  const { getBookingConfig } = await import("./appointments");
  const bookingConfig = await getBookingConfig(userId);
  const { getBookingFlow } = await import("./booking/store");
  const bookingFlow = await getBookingFlow(userId);

  // The full PHOTO INDEX (id | caption | tags) only when show_gallery is
  // actually offered — naming photos the model can't draw is how you get an
  // apology instead of a card. Otherwise the old count-only line.
  const photoBlock = cardTools.has("show_gallery")
    ? photoIndexSection(photos)
    : photos.length
      ? `${photos.length} photo(s) available.`
      : "(No photos uploaded yet.)";

  const personaBlock =
    personaPromptBlock(personaConfig.personaSections) ||
    "Warm, curious, a builder at heart. Enthusiastic about making useful things. Speaks plainly, with a bit of playful energy.";

  const owner = profile.owner_name.trim();
  const company = profile.company_name.trim() || owner || "this business";
  const speaker = owner || company;

  return `You are the AI host for ${company}'s website. You speak on ${speaker}'s behalf to visitors — friendly, helpful, and genuine, never corporate.

PERSONA (who you are and how you behave — follow it in every answer):
${personaBlock}

WHO YOU ARE:
${company}${personaConfig.tagline ? ` — ${personaConfig.tagline}` : ""}${
    owner ? ` Owned and run by ${owner}.` : ""
  }
${brandVoiceBlock(personaConfig.brandValues, personaConfig.toneOfVoice)}
HOW TO CONNECT:
${connectBlock(profile)}

PROJECT INDEX (ids for show_project; details come through KNOWLEDGE below):
${projectBlock}

${photoBlock}
${await serviceIndexSection(userId, cardTools, bookingConfig, bookingFlow)}
KNOWLEDGE FOR THIS QUESTION (retrieved from everything ${speaker} curates —
profile and experience, persona, project write-ups, photo descriptions, saved
sources, and approved answers. Each block is labelled with where it came
from):
${sourceBlock}${cardRulesSection(cards, { hasBookingOrSocial: await hasBookingOrSocialTools(bookingConfig, userId) })}${bookingPromptSection(bookingConfig)}${goalsPromptSection(directives)}

RULES:
- Only state facts present above or returned by a search — never invent a price, service or policy.
- Answer with what you DO know first. When the exact thing asked isn't listed (a combo, a custom request, a discount), give the closest related facts — the individual prices, the nearest service, the relevant policy — and say plainly which part isn't listed. Only then point them to ${speaker} for the rest.
- Only give the full list from KNOWLEDGE, grouped sensibly, when the visitor explicitly asks for everything ("all services", "full price list") — otherwise show or say just what fits the question.
- For questions about ${speaker}'s history, background, or opinions, synthesize naturally from the KNOWLEDGE section — that's where the bio, experience and detail live now.
- Keep answers concise and conversational.
- Never invent projects, jobs, dates, or credentials.${rulesPromptLines(directives)}${correctionBlock}`;
}

/**
 * The knowledge section: retrieved chunks + entity relations when we have a
 * query and an index; the legacy summary dump otherwise.
 */
async function knowledgeBlock(
  userId: string,
  query: string | undefined,
  chunkCount: number,
): Promise<string> {
  if (query?.trim() && chunkCount > 0) {
    try {
      // Broad questions ("tell me about yourself") get the curated
      // neighborhood overviews; anything with a selective token falls
      // through to chunks.
      const broad = await broadOverviews(userId, query);
      if (broad) return broad;
      return formatContext(await retrieve(userId, query));
    } catch {
      // Retrieval trouble shouldn't kill the chat — fall through to the dump.
    }
  }
  const sources = await prisma.source.findMany({
    where: { userId, status: "scanned" },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  if (!sources.length) return "(No sources extracted yet.)";
  return sources
    .map((s) => {
      const tags = safeTags(s.tags);
      const ref = s.url ?? s.filename ?? s.title ?? "(source)";
      return `- [${s.kind}/${s.type}] ${s.title ?? ref} — ${s.summary}${
        tags.length ? ` (tags: ${tags.join(", ")})` : ""
      }${s.url ? `\n  ${s.url}` : ""}`;
    })
    .join("\n");
}

/**
 * "PHOTO INDEX (id | caption | tags):" built from the photos buildSystemPrompt
 * already loaded — no new query. Falls back to a plain sentence when there
 * are none, same tone as the old count-only line.
 */
function photoIndexSection(photos: { id: string; caption: string | null; description: string; tags: string }[]): string {
  if (!photos.length) return "(No photos uploaded yet.)";
  const metas = photos.map((p) => ({
    id: p.id,
    src: "",
    caption: p.caption ?? "",
    description: p.description,
    tags: parsePhotoTags(p.tags),
  }));
  return `PHOTO INDEX (id | caption | tags):\n${photoIndexLines(metas)}`;
}

type BookingConfigLike = Awaited<ReturnType<typeof import("./appointments").getBookingConfig>>;
type BookingFlowLike = Awaited<ReturnType<typeof import("./booking/store").getBookingFlow>>;

/**
 * "SERVICE INDEX (id | name | category | price | terms):" whenever
 * show_services is offered OR booking is enabled — the same gate
 * bookingPromptSection used to name services in prose. Built from the live
 * booking flow's services when there are any, else the knowledge catalog
 * (priceFromText gives it a price the same way serviceIndexLines expects).
 * "" when there is nothing to index. `bookingConfig`/`bookingFlow` are read
 * once by buildSystemPrompt and passed in rather than each section fetching
 * its own copy.
 */
async function serviceIndexSection(
  userId: string,
  cardTools: Set<string>,
  bookingConfig: BookingConfigLike,
  bookingFlow: BookingFlowLike,
): Promise<string> {
  const bookingOn = bookingConfig.enabled && bookingConfig.fields.length > 0;
  if (!cardTools.has("show_services") && !bookingOn) return "";

  // The flow (real Service rows, or the legacy bridge's derived ones) is
  // richer whenever it has anything on file — same rule servicesBlock uses —
  // regardless of whether the booking WIZARD itself has questions configured
  // yet; the knowledge catalog is only the fallback when neither does.
  let metas: ServiceMeta[] = [];
  if (bookingFlow?.flow.services.length) {
    const { pricingLabel } = await import("./booking/types");
    metas = bookingFlow.flow.services.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      priceLabel: pricingLabel(s.pricing, bookingFlow.flow.business.currency),
    }));
  }
  if (!metas.length) {
    const { listServices } = await import("./cards");
    const catalog = await listServices(userId);
    metas = catalog.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      priceLabel: priceFromText(s.description) || undefined,
    }));
  }
  if (!metas.length) return "";
  return `SERVICE INDEX (id | name | category | price | terms):\n${serviceIndexLines(metas)}\n`;
}

/** Whether either data-gated tool (booking, social) exists, so COMPOSING
 *  CARDS still gets appended when the catalog itself has no reason lines. */
async function hasBookingOrSocialTools(bookingConfig: BookingConfigLike, userId: string): Promise<boolean> {
  const { hasSocialLinks } = await import("./social");
  const social = await hasSocialLinks(userId);
  return (bookingConfig.enabled && bookingConfig.fields.length > 0) || social;
}

const COMPOSING_CARDS_SECTION = `
COMPOSING CARDS:
Several small, focused cards beat one big one. The catalog above tells you WHEN to reach for a
card; the PHOTO INDEX and SERVICE INDEX tell you WHICH items to put in it. Narrow every card to
the exact need of the moment — a few matching photos, the one service asked about plus its close
neighbours, the booking flow narrowed to what the visitor was just looking at — rather than the
whole gallery, catalog, or wizard. Combine several small cards in one answer when the visitor's
need spans them (e.g. a few photos of a service plus that service's card plus booking). Show the
whole gallery or full list only when the visitor explicitly asks for everything. When nothing
matches a filter, show no card and say so in words — never force an empty or wrong one. An earlier
assistant turn may end with a line like "[shown: gallery ids=p1,p2 tags=red,gel · services
ids=s1]" listing the ids/tags of cards the visitor was actually shown — that line is bookkeeping,
never repeat or mention it. When the visitor then says "those", "that one", "the red ones", or
"book that", use those ids/tags: pass the tags as \`query\` to show_services or show_booking, or
pass the ids straight through to \`services\`/\`ids\`, instead of asking them to repeat themselves.`;

/**
 * The USING RICH CARDS section, from the already-gated card list, plus the
 * COMPOSING CARDS paragraph. One line per card with a written reason; a card
 * whose reason is blank contributes its tool's existence (the PHOTO INDEX
 * line, the tool list in brain.ts) but no guidance line. `hasBookingOrSocial`
 * keeps COMPOSING CARDS present even when the catalog itself has no reason
 * lines but booking or social — gated on data, not the catalog — still
 * exist as tools; with neither cards nor those tools, nothing renders:
 * instructing the model about cards it cannot draw is how you get an apology
 * instead of a card.
 */
export function cardRulesSection(cards: CardGuidance[], opts: { hasBookingOrSocial: boolean } = { hasBookingOrSocial: false }): string {
  const lines = cards
    .filter((c) => c.reason.trim())
    // Custom cards share one tool, so the key is part of the instruction:
    // it is the argument the model must pass to draw THIS card.
    .map((c) =>
      c.tool === "show_card"
        ? `- show_card with key "${c.key}": ${c.reason.trim()}`
        : `- ${c.tool}: ${c.reason.trim()}`,
    );
  if (!lines.length && !opts.hasBookingOrSocial) return "";
  const usingCards = lines.length
    ? `

USING RICH CARDS (A2UI):
You have tools that render visual cards in the chat. Prefer a small focused card over a plain text list. When to use each:
${lines.join("\n")}
Always add a short spoken sentence alongside a card — the card supplements your words, it doesn't replace them.`
    : "";
  return `${usingCards}\n${COMPOSING_CARDS_SECTION}`;
}

/**
 * One instruction paragraph when booking is live, none otherwise — telling
 * the model about a tool it doesn't have is how you get an apology instead of
 * a card. `bookingConfig` is read once by buildSystemPrompt and passed in.
 */
function bookingPromptSection(bookingConfig: BookingConfigLike): string {
  if (!bookingConfig.enabled || bookingConfig.fields.length === 0) return "";
  // Services now live in SERVICE INDEX above rather than a prose sentence
  // here — the model picks ids/query from there for show_booking's
  // `services`/`query` inputs instead of a wall of names.
  return `

BOOKING:
Visitors can book an appointment right here in the chat: the card lets them pick a service (with prices and photos), a provider, a location, and a live open time, then confirm. When someone wants to book, schedule, or meet, draw show_booking — pass \`services\` or \`query\` from SERVICE INDEX above to narrow it to what they were just looking at (a gallery or services card, or what they described) instead of opening the whole list — and never promise a specific time until the card has shown you one is actually open.`;
}

/** The person the prompt refers to when citing the owner by name. */
function speakerName(p: { owner_name: string; company_name: string }): string {
  return p.owner_name.trim() || p.company_name.trim() || "the owner";
}

/** Brand values + tone of voice as prompt blocks — only what is set renders,
 *  so an un-onboarded persona adds nothing. */
function brandVoiceBlock(brandValues: string, toneOfVoice: string): string {
  let values: string[] = [];
  try {
    const parsed = JSON.parse(brandValues) as unknown;
    if (Array.isArray(parsed)) values = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // malformed stored JSON reads as no values
  }
  const parts: string[] = [];
  if (values.length) parts.push(`BRAND VALUES (what the business stands for):\n${values.map((v) => `- ${v}`).join("\n")}`);
  if (toneOfVoice.trim()) parts.push(`TONE OF VOICE (write every answer in this style):\n${toneOfVoice.trim()}`);
  return parts.length ? `\n${parts.join("\n\n")}\n` : "";
}

function connectBlock(p: {
  company_email: string;
  company_phone_number: string;
  company_address: string;
  company_hours: string;
  social_links: string;
}): string {
  const lines: string[] = [];
  if (p.company_email) lines.push(`Email: ${p.company_email}`);
  if (p.company_phone_number) lines.push(`Phone: ${p.company_phone_number}`);
  if (p.company_address) lines.push(`Address: ${p.company_address}`);
  if (p.company_hours) lines.push(`Hours: ${p.company_hours}`);
  for (const s of parseSocialLinks(p.social_links)) {
    lines.push(s.platform ? `${s.platform[0].toUpperCase()}${s.platform.slice(1)}: ${s.url}` : s.url);
  }
  return lines.length ? lines.join("\n") : "(No contact info added yet.)";
}

export function safeTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

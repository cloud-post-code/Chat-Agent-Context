import { prisma, getProfile, getPersonaConfig } from "./db";
import { personaPromptBlock } from "./persona";
import { goalsPromptSection, rulesPromptLines } from "./directives";
import { retrieve, formatContext } from "./retrieval/search";
import { broadOverviews } from "./retrieval/clusters";
import { cardCatalog, type CardGuidance } from "./uiCards";

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
export async function buildSystemPrompt(query?: string): Promise<string> {
  const [profile, personaConfig, projects, photos, corrections, chunkCount, directives] = await Promise.all([
    getProfile(),
    getPersonaConfig(),
    prisma.project.findMany({ orderBy: { order: "asc" } }),
    // The prompt's gallery listing is curated photos only; custom-ingested
    // images (`ingest:*` marks) reach the model through retrieval chunks.
    prisma.photo.findMany({
      where: { NOT: { kind: { startsWith: "ingest:" } } },
      orderBy: { order: "asc" },
    }),
    // Admin corrections: bad answers Blake flagged with a note on the Activity
    // tab. These steer the bot away from repeating mistakes.
    prisma.chatMessage.findMany({
      where: { role: "assistant", rating: "down", note: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { note: true },
    }),
    prisma.chunk.count(),
    // Goals and rules from the Agent Behavior tabs. One fetch for both kinds;
    // the renderers below split them.
    prisma.agentDirective.findMany({
      where: { enabled: true },
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

  const sourceBlock = await knowledgeBlock(query, chunkCount);

  const correctionNotes = corrections
    .map((c) => c.note?.trim())
    .filter((n): n is string => !!n);
  const correctionBlock = correctionNotes.length
    ? `\n\nCORRECTIONS (Blake reviewed past answers and flagged these — follow them strictly, they override nothing factual above but tell you how to behave):\n${correctionNotes
        .map((n) => `- ${n}`)
        .join("\n")}`
    : "";

  // The card catalog the admin curates on the A2UI tab: which cards exist and
  // when to show each.
  const cards = await cardCatalog();
  const cardTools = new Set(cards.map((c) => c.tool));

  // Photos are only worth announcing as showable if the gallery card exists.
  const photoBlock = photos.length
    ? `${photos.length} photo(s) available.${
        cardTools.has("show_gallery") ? " Use show_gallery to display them." : ""
      }`
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

HOW TO CONNECT:
${connectBlock(profile)}

PROJECT INDEX (ids for show_project; details come through KNOWLEDGE below):
${projectBlock}

PHOTOS:
${photoBlock}

KNOWLEDGE FOR THIS QUESTION (retrieved from everything Blake curates — his
profile and experience, persona, project write-ups, photo descriptions, saved
sources, and answers he approved. Each block is labelled with where it came
from):
${sourceBlock}${cardRulesSection(cards)}${goalsPromptSection(directives)}

RULES:
- Only state facts present above. If you don't know, say so warmly and point them to how they can connect with Blake directly.
- For questions about Blake's history, background, or opinions, synthesize naturally from the KNOWLEDGE section — that's where his bio, experience and detail live now.
- Keep answers concise and conversational.
- Never invent projects, jobs, dates, or credentials.${rulesPromptLines(directives)}${correctionBlock}`;
}

/**
 * The knowledge section: retrieved chunks + entity relations when we have a
 * query and an index; the legacy summary dump otherwise.
 */
async function knowledgeBlock(query: string | undefined, chunkCount: number): Promise<string> {
  if (query?.trim() && chunkCount > 0) {
    try {
      // Broad questions ("tell me about Blake") get the curated neighborhood
      // overviews; anything with a selective token falls through to chunks.
      const broad = await broadOverviews(query);
      if (broad) return broad;
      return formatContext(await retrieve(query));
    } catch {
      // Retrieval trouble shouldn't kill the chat — fall through to the dump.
    }
  }
  const sources = await prisma.source.findMany({
    where: { status: "scanned" },
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
 * The USING RICH CARDS section, from the already-gated card list. One line per
 * card with a written reason; a card whose reason is blank contributes its
 * tool's existence (the PHOTOS line, the tool list in brain.ts) but no
 * guidance line. No cards at all — every row deleted or gated off — means no
 * section: instructing the model about cards it cannot draw is how you get an
 * apology instead of a card.
 */
export function cardRulesSection(cards: CardGuidance[]): string {
  const lines = cards
    .filter((c) => c.reason.trim())
    // Custom cards share one tool, so the key is part of the instruction:
    // it is the argument the model must pass to draw THIS card.
    .map((c) =>
      c.tool === "show_card"
        ? `- show_card with key "${c.key}": ${c.reason.trim()}`
        : `- ${c.tool}: ${c.reason.trim()}`,
    );
  if (!lines.length) return "";
  return `

USING RICH CARDS (A2UI):
You have tools that render visual cards in the chat. Prefer them over plain text lists. When to use each:
${lines.join("\n")}
Always add a short spoken sentence alongside a card — the card supplements your words, it doesn't replace them.`;
}

function connectBlock(p: {
  company_email: string;
  company_phone_number: string;
  company_address: string;
  company_hours: string;
}): string {
  const lines: string[] = [];
  if (p.company_email) lines.push(`Email: ${p.company_email}`);
  if (p.company_phone_number) lines.push(`Phone: ${p.company_phone_number}`);
  if (p.company_address) lines.push(`Address: ${p.company_address}`);
  if (p.company_hours) lines.push(`Hours: ${p.company_hours}`);
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

import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/knowledge";
import {
  allProjectsBlock,
  singleProjectBlock,
  galleryBlock,
  galleryTagVocabulary,
  contactBlock,
  type UiBlock,
} from "@/lib/cards";
import { recordTurn } from "@/lib/activity";
import { findServableCanned, recordCannedHit } from "@/lib/canned";
import { cardCatalog, customCardBlock } from "@/lib/uiCards";
import { prisma } from "@/lib/db";
import { formatContext, retrieve } from "@/lib/retrieval/search";
import { hasSocialLinks, socialBlock } from "@/lib/social";

/**
 * The chatbot, independent of how it was reached. `answer()` is the one entry
 * point: it decides between a canned answer and the model, runs the A2UI tool
 * loop, and logs the turn. Transports (the /api/chat route today, another
 * channel later) only translate its events onto the wire.
 *
 * Two tiers, deliberately. A canned answer costs nothing; everything else goes
 * to the model configured in lib/claude.ts. There is no classifier call and no
 * escalation tier — a cheap router that itself costs a model call isn't cheap.
 */

export type Msg = { role: "user" | "assistant"; content: string; shown?: ShownCard[] };

/**
 * What a card, once rendered, told the visitor it was showing — folded into
 * the history the model sees on the NEXT turn so "book that" or "the red
 * ones" can resolve against ids/tags from a card the visitor already saw,
 * not just its own prose. Structured and out of band: the page attaches it
 * to each assistant message it sends back (Chat.tsx -> route.ts -> Msg.shown).
 */
export type ShownCard = { type: string; ids?: string[]; tags?: string[]; title?: string };

/**
 * A ShownCard folded into one compact clause: "gallery ids=p1,p2 tags=red,gel".
 * Exported as a pure helper so a proof can assert the exact folding without
 * driving the whole model loop.
 */
function renderOneShown(s: ShownCard): string {
  const parts = [s.type];
  if (s.ids?.length) parts.push(`ids=${s.ids.join(",")}`);
  if (s.tags?.length) parts.push(`tags=${s.tags.join(",")}`);
  if (s.title) parts.push(`title=${s.title}`);
  return parts.join(" ");
}

/** Every ShownCard on a turn, folded into one "[shown: … · …]" suffix; "" when none. */
export function renderShown(shown: ShownCard[] | undefined): string {
  if (!shown?.length) return "";
  return `\n\n[shown: ${shown.map(renderOneShown).join(" · ")}]`;
}

/** What the brain emits. The web transport writes these straight out as NDJSON. */
export type BrainEvent = { t: "text"; v: string } | { t: "card"; v: UiBlock };

/** Web renders cards; other channels are text-only until taught otherwise. */
export type Channel = "web" | "a2a" | (string & {});

/**
 * Channels that can do something with a UI block. Web paints it; A2A hands it
 * to the calling agent as a structured data part, which is more useful to a
 * machine than the prose equivalent. Anything else gets text only.
 */
const CARD_CHANNELS: ReadonlySet<string> = new Set(["web", "a2a"]);

export type BrainInput = {
  /// Which user's agent is answering — scopes knowledge, cards, and logging.
  userId: string;
  message: string;
  history?: Msg[];
  sessionId: string;
  channel?: Channel;
};

/**
 * The Anthropic client, narrowed to what the brain uses. Injectable so tests
 * can count calls at the provider boundary without faking anything inside it.
 */
export type ModelClient = {
  messages: {
    stream(params: Anthropic.MessageStreamParams): {
      // Loose on purpose: the real SDK's stream events are a wide union whose
      // deltas differ per block type, and the brain only reads text out of it.
      [Symbol.asyncIterator](): AsyncIterator<{ type: string; delta?: unknown }>;
      finalMessage(): Promise<{ content: unknown[] }>;
    };
  };
};

export type BrainDeps = { client?: ModelClient };

const TOOLS: Anthropic.Tool[] = [
  {
    name: "show_projects",
    description:
      "Render cards for the owner's projects. With no arguments, ALL of them — use that only when the " +
      "visitor asks for their projects in general. Otherwise narrow it: ids for specific ones, tags for a " +
      "theme, or query for free text describing what they're after.",
    input_schema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Specific project ids" },
        tags: { type: "array", items: { type: "string" }, description: "Tags every project must carry" },
        query: { type: "string", description: "Free text describing what the visitor wants" },
        limit: { type: "integer", description: "Max projects to show" },
        title: { type: "string", description: "Heading for the card" },
      },
    },
  },
  {
    name: "show_project",
    description:
      "Render a single project's card. Use when focused on one specific project. Pass its id from the PROJECTS list.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "The project id" } },
      required: ["id"],
    },
  },
  {
    name: "show_gallery",
    description:
      "Render the owner's photos as a gallery. layout 'carousel' is a slideshow; 'filmstrip' is a browsable " +
      "thumbnail strip with a lightbox. Pick photos with ids from PHOTO INDEX when the visitor named specific " +
      "ones, tags ONLY from the vocabulary PHOTO INDEX lists (never invent a tag), or query for free text " +
      "('storefront', 'behind the scenes'). Leave every filter off ONLY when the visitor explicitly asks to " +
      "see everything — the default is a few photos that fit what they asked, not the whole gallery.",
    input_schema: {
      type: "object",
      properties: {
        layout: { type: "string", enum: ["carousel", "filmstrip"] },
        ids: { type: "array", items: { type: "string" }, description: "Specific photo ids from PHOTO INDEX" },
        tags: { type: "array", items: { type: "string" }, description: "Tags from PHOTO INDEX's vocabulary, e.g. red, gel" },
        query: { type: "string", description: "Free text describing the photos wanted" },
        limit: { type: "integer", description: "Max photos to show" },
        title: { type: "string", description: "Heading for the card" },
      },
      required: ["layout"],
    },
  },
  {
    name: "show_contact_form",
    description:
      "Render a contact form so the visitor can leave their name, email, and a message for the owner. Use this whenever someone wants to get in touch, connect, reach out, hire, or collaborate. Their submission is recorded for the owner.",
    input_schema: { type: "object", properties: {} },
  },
];

/**
 * The gated `show_social` tool: offered on the tenant's OWN data (whether
 * they have any social links at all), not on the card catalog — no existing
 * tenant has a show_social UiCard row and bootstrap never seeds one.
 */
const SHOW_SOCIAL_TOOL: Anthropic.Tool = {
  name: "show_social",
  description:
    "Render the business's social links as a card, one button per platform. With no arguments it shows " +
    "every link on file — use that for a plain 'follow you' ask. Narrow it with platforms " +
    "(instagram, facebook, twitter, tiktok, youtube, linkedin) when the visitor named a specific one, e.g. " +
    "'do you have Instagram?' shows only Instagram, not every platform.",
  input_schema: {
    type: "object",
    properties: {
      platforms: { type: "array", items: { type: "string" }, description: "Platforms the visitor asked about" },
      title: { type: "string", description: "Heading for the card" },
    },
  },
};

/**
 * The tool for cards designed in the admin card builder. One tool for all of
 * them, keyed: the key enum makes the model's choice a closed set, and the
 * per-card "when to show it" guidance lives in the system prompt beside it.
 */
function customCardTool(keys: string[]): Anthropic.Tool {
  return {
    name: "show_card",
    description:
      "Render one of the owner's custom-designed cards. Pass the card's key exactly as given " +
      "in the USING RICH CARDS instructions.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string", enum: keys, description: "The card's key" } },
      required: ["key"],
    },
  };
}

/**
 * The model's second look. The prompt carries one retrieval, keyed on the
 * visitor's literal words; when those words miss ("anything for my face?"),
 * the model can ask again in the site's vocabulary instead of apologizing.
 * Draws nothing — its result goes back to the model, not the visitor.
 */
const SEARCH_TOOL: Anthropic.Tool = {
  name: "search_knowledge",
  description:
    "Search everything the owner has published (services and prices, policies, pages, posts) " +
    "and get the matching passages back. Use it before telling a visitor you don't know: " +
    "search with the business's likely wording, a section name from KNOWLEDGE SECTIONS, or a " +
    "synonym of what they asked.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "A few keywords to look up" } },
    required: ["query"],
  },
};

/** What there is to search, so the model's queries aren't guesses. */
async function searchPromptSection(userId: string): Promise<string> {
  const groups = await prisma.chunk.groupBy({
    by: ["originLabel"],
    where: { userId, originKind: { not: "cluster" } },
    _count: { _all: true },
    orderBy: { _count: { originLabel: "desc" } },
    take: 40,
  });
  const sections = groups
    .filter((g) => g.originLabel)
    .map((g) => `- ${g.originLabel} (${g._count._all})`)
    .join("\n");
  return `

LOOKING THINGS UP:
KNOWLEDGE above is only a first guess at what this question needs. If it doesn't answer the question, call search_knowledge with different words before you say you don't know — never tell a visitor information is unavailable without searching first.${
    sections ? `\nKNOWLEDGE SECTIONS (title, passage count):\n${sections}` : ""
  }`;
}

/** What hydrate() actually drew (or didn't), for the tool result and for logging. */
export type Hydrated = { block: UiBlock | null; summary: string };

const ok = (block: UiBlock | null, summary: string): Hydrated => ({ block, summary });

/** "Rendered N photos: id (caption), …", capped so the tool result stays short. */
function summarizeGallery(block: { items: { id: string; caption: string | null }[] }): string {
  const shown = block.items.slice(0, 8).map((i) => `${i.id} (${i.caption || "photo"})`);
  const tail = block.items.length > 8 ? `, and ${block.items.length - 8} more` : "";
  return `Rendered ${block.items.length} photos: ${shown.join(", ")}${tail}.`;
}

/**
 * Turn a tool call into the UI block it names, plus a summary the model
 * hears back as the tool result — "Rendered N photos: …" instead of a blind
 * "Card rendered to the user.", so the 4-turn loop can retry a filter that
 * matched nothing, and later turns can quote what was actually shown.
 */
export async function hydrate(userId: string, name: string, input: Record<string, unknown>): Promise<Hydrated> {
  switch (name) {
    case "show_projects": {
      const block = await allProjectsBlock(userId, input);
      if (!block || block.type !== "projects") return ok(null, "No projects match.");
      return ok(block, `Rendered ${block.items.length} projects.`);
    }
    case "show_project":
      return ok(await singleProjectBlock(userId, String(input.id ?? "")), "Rendered the project card.");
    case "show_gallery": {
      const layout = input.layout === "carousel" ? "carousel" : "filmstrip";
      const block = await galleryBlock(userId, { ...input, layout });
      if (!block || block.type !== "gallery") {
        const vocab = await galleryTagVocabulary(userId);
        return ok(null, vocab.length ? `No photos match. Tags on file: ${vocab.join(", ")}` : "No photos match.");
      }
      return ok(block, summarizeGallery(block));
    }
    case "show_contact_form":
      return ok(await contactBlock(), "Card rendered to the user.");
    case "show_social": {
      const block = await socialBlock(userId, input);
      if (!block) {
        const wanted = Array.isArray(input.platforms) ? input.platforms.filter((p): p is string => typeof p === "string") : [];
        return ok(null, wanted.length ? `No social links for: ${wanted.join(", ")}` : "No social links on file.");
      }
      return ok(block, `Rendered ${block.items.length} social links: ${block.items.map((i) => i.platform).join(", ")}.`);
    }
    case "show_card":
      // Null when the key doesn't name a custom card any more — a canned
      // answer can outlive the card it pointed at.
      return ok(await customCardBlock(userId, String(input.key ?? "")), "Card rendered to the user.");
    default:
      return ok(null, "No data available.");
  }
}

function parseCardInput(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Everything runModel needs to open the model loop: the system prompt (with
 * the scripted-answer wrapper when a canned row supplies one) and the tool
 * list gated by the card catalog plus the data-only gate (social).
 * Pulled out of runModel so that function stays under the line-count limit;
 * behaviour is unchanged, just named and testable on its own.
 */
async function assembleTools(
  userId: string,
  message: string,
  script: string | undefined,
): Promise<{ system: string; tools: Anthropic.Tool[] }> {
  // The visitor's latest question drives retrieval: the prompt carries only the
  // knowledge relevant to it, not the whole source library.
  const [corePrompt, catalog, searchSection, socialEnabled] = await Promise.all([
    buildSystemPrompt(userId, message),
    cardCatalog(userId),
    searchPromptSection(userId),
    hasSocialLinks(userId),
  ]);
  // A tool is offered only when a catalog card names it — the catalog (the
  // admin's A2UI tab) decides what exists.
  const catalogTools = new Set(catalog.map((c) => c.tool));
  // A scripted turn has its words already; it gets no search tool to wander with.
  const basePrompt = script ? corePrompt : corePrompt + searchSection;
  const system = script
    ? `${basePrompt}\n\nAPPROVED ANSWER\nThe owner has already written the answer to this exact question. ` +
      `Reply with it as written — do not reword, shorten, extend or add to it:\n\n${script}\n\n` +
      `Your only remaining job is to show a card alongside it when one of the cards above genuinely fits.`
    : basePrompt;
  const tools = TOOLS.filter((t) => catalogTools.has(t.name));
  // Custom-designed cards share one keyed tool, built from the catalog.
  const customKeys = catalog.filter((c) => c.tool === "show_card").map((c) => c.key);
  if (customKeys.length) tools.push(customCardTool(customKeys));
  // Social is gated by the tenant having links on file — not by the catalog.
  if (socialEnabled) tools.push(SHOW_SOCIAL_TOOL);
  if (!script) tools.push(SEARCH_TOOL);
  return { system, tools };
}

/** The model tier: stream text, run any tools, let Claude close. */
async function* runModel(
  userId: string,
  message: string,
  history: Msg[],
  client: ModelClient,
  /**
   * An owner-approved answer for this exact question (a canned/starter row with
   * no card attached). The model must speak it as written — it is here only so
   * the turn can still carry an A2UI card the prose alone couldn't show.
   */
  script?: string,
): AsyncGenerator<BrainEvent> {
  const { system, tools } = await assembleTools(userId, message, script);
  const convo: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    // Fold what a past assistant turn's cards showed into its content, so
    // "those", "that one", "the red ones" can resolve against ids/tags the
    // visitor actually saw rather than only the words around them. Never
    // shown to the visitor or logged — it only ever reaches the model.
    content: m.role === "assistant" ? m.content + renderShown(m.shown) : m.content,
  }));
  convo.push({ role: "user", content: message });

  // Loop so we can run tools and let Claude continue speaking after.
  for (let turn = 0; turn < 4; turn++) {
    const stream = client.messages.stream({
      model: claudeModel(),
      max_tokens: 2048,
      system,
      tools,
      messages: convo,
    });

    for await (const event of stream) {
      const delta = event.delta as { type?: string; text?: string } | undefined;
      if (event.type === "content_block_delta" && delta?.type === "text_delta") {
        yield { t: "text", v: delta.text ?? "" };
      }
    }

    const final = await stream.finalMessage();
    const content = final.content as Anthropic.ContentBlock[];
    const toolUses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) return; // Claude is done talking.

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      if (tu.name === SEARCH_TOOL.name) {
        const query = String((tu.input as { query?: unknown })?.query ?? "").trim() || message;
        const found = formatContext(await retrieve(userId, query));
        results.push({ type: "tool_result", tool_use_id: tu.id, content: found });
        continue;
      }
      const { block, summary } = await hydrate(userId, tu.name, (tu.input ?? {}) as Record<string, unknown>);
      if (block) yield { t: "card", v: block };
      results.push({ type: "tool_result", tool_use_id: tu.id, content: summary });
    }

    // Feed the tool results back so Claude can add closing words.
    convo.push({ role: "assistant", content });
    convo.push({ role: "user", content: results });
  }
}

/**
 * Answer one visitor message. Yields text and cards in the order they happen,
 * then records the turn — the log write is awaited after the last token, so it
 * costs the visitor nothing and the Activity tab is never a step behind.
 */
export async function* answer(
  input: BrainInput,
  deps: BrainDeps = {},
): AsyncGenerator<BrainEvent> {
  const { userId, message, history = [], sessionId, channel = "web" } = input;
  const cards = CARD_CHANNELS.has(channel);
  let spoken = "";

  try {
    const canned = await findServableCanned(userId, message);
    // A canned row short-circuits the model ONLY when it can answer in full:
    // either the channel takes no cards, or the owner attached the card this
    // answer should come with. Starter questions are canned rows, so without
    // this a visitor clicking "What nail services do you offer?" got flat prose
    // and never a card, no matter what the A2UI catalog held. When no card is
    // attached, the row's answer becomes the model's script and the model
    // decides which card (if any) belongs with it.
    if (canned && (!cards || canned.cardTool)) {
      spoken = canned.answer;
      yield { t: "text", v: canned.answer };
      if (cards && canned.cardTool) {
        const { block } = await hydrate(userId, canned.cardTool, parseCardInput(canned.cardInput));
        if (block) yield { t: "card", v: block };
      }
      await recordCannedHit(canned.id);
      return;
    }
    if (canned) await recordCannedHit(canned.id);

    for await (const event of runModel(
      userId,
      message,
      history,
      deps.client ?? claude(),
      canned?.answer,
    )) {
      if (event.t === "text") spoken += event.v;
      if (event.t === "card" && !cards) continue;
      yield event;
    }
  } catch (e) {
    const note =
      e instanceof Error && e.message.includes("ANTHROPIC_API_KEY")
        ? "The chatbot isn't configured yet (missing API key)."
        : "Something went wrong reaching the model.";
    yield { t: "text", v: `\n\n[${note}]` };
  } finally {
    // Best-effort: a logging failure must never break a visitor's answer.
    await recordTurn({ userId, sessionId, question: message, answer: spoken }).catch(() => {});
  }
}

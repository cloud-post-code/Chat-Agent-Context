import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/knowledge";
import {
  allProjectsBlock,
  singleProjectBlock,
  galleryBlock,
  contactBlock,
  bookingBlock,
  servicesBlock,
  type UiBlock,
} from "@/lib/cards";
import { getBookingConfig } from "@/lib/appointments";
import { recordTurn } from "@/lib/activity";
import { findServableCanned, recordCannedHit } from "@/lib/canned";
import { cardCatalog, customCardBlock } from "@/lib/uiCards";
import { cartBlock, cartPromptSection, findMenuItem, menuBlock, menuPromptSection } from "@/lib/menu";
import type { MenuItemData } from "@/lib/menuTypes";
import { prisma } from "@/lib/db";
import { formatContext, retrieve } from "@/lib/retrieval/search";

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

export type Msg = { role: "user" | "assistant"; content: string };

/** What the brain emits. The web transport writes these straight out as NDJSON. */
export type BrainEvent =
  | { t: "text"; v: string }
  | { t: "card"; v: UiBlock }
  // A change to the visitor's cart the model asked for (add_to_cart). The cart
  // lives with the visitor, so the page applies it; nothing is stored here.
  | { t: "cart"; v: CartOp };

export type CartOp = { op: "add"; item: MenuItemData; quantity: number };

/** One line of the visitor's cart as the page reports it with each message. */
export type CartLineSummary = { name: string; quantity: number; unitPrice?: string };

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
  /** What the visitor has in their cart, so the model can talk about it. */
  cart?: CartLineSummary[];
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
      "Render cards for ALL of the owner's projects. Use when the visitor asks about their projects in general.",
    input_schema: { type: "object", properties: {} },
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
      "Render the owner's photos as a gallery. layout 'carousel' is a slideshow; 'filmstrip' is a browsable thumbnail strip with a lightbox.",
    input_schema: {
      type: "object",
      properties: {
        layout: { type: "string", enum: ["carousel", "filmstrip"] },
      },
      required: ["layout"],
    },
  },
  {
    name: "show_services",
    description:
      "Render the business's services as a card: each service with what it includes, and a Book button when appointments are on. Use when the visitor asks what the business offers, or about its services, treatments, packages or pricing in general.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "show_menu",
    description:
      "Render the business's menu as a card the visitor can order from: items with prices, options and add-ons, each addable to a cart with a quantity. With no arguments it shows the whole menu grouped by section; pass keys (from MENU INDEX) for a curated list that fits the question, tags for a dietary or popularity filter, or category for one section, with a short title.",
    input_schema: {
      type: "object",
      properties: {
        keys: { type: "array", items: { type: "string" }, description: "Item keys from MENU INDEX, in the order to show them" },
        tags: { type: "array", items: { type: "string" }, description: "Dietary or popularity tags every item must carry, e.g. vegan, popular" },
        category: { type: "string", description: "One section name from MENU INDEX" },
        title: { type: "string", description: "Heading for a curated list, e.g. 'Vegan picks'" },
      },
    },
  },
  {
    name: "show_cart",
    description:
      "Render the visitor's cart: every item they added with quantity steppers, the total, and checkout. Use it when they want to see, change or check out what they've picked.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "show_contact_form",
    description:
      "Render a contact form so the visitor can leave their name, email, and a message for the owner. Use this whenever someone wants to get in touch, connect, reach out, hire, or collaborate. Their submission is recorded for the owner.",
    input_schema: { type: "object", properties: {} },
  },
];

/**
 * Put an on-menu item in the visitor's cart. Offered with the menu; the key is
 * checked against the menu on file before the page is told anything.
 */
const ADD_TO_CART_TOOL: Anthropic.Tool = {
  name: "add_to_cart",
  description:
    "Add an item from MENU INDEX to the visitor's cart, in the quantity they asked for (default 1). Only for items whose key is in the index; the visitor picks any options on the card.",
  input_schema: {
    type: "object",
    properties: {
      key: { type: "string", description: "The item's key from MENU INDEX" },
      quantity: { type: "integer", minimum: 1, maximum: 20 },
    },
    required: ["key"],
  },
};

/**
 * The booking wizard's tool. Unlike TOOLS above it is not gated by the card
 * catalog: the Appointments toggle is its whole existence, so it is offered
 * exactly when booking is enabled and withheld otherwise.
 */
const BOOKING_TOOL: Anthropic.Tool = {
  name: "show_booking",
  description:
    "Render the appointment booking flow so the visitor can book a time. Use it whenever someone wants to book, schedule, or set up an appointment, call, or meeting.",
  input_schema: { type: "object", properties: {} },
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

/** Turn a tool call into the UI block it names. Shared by both tiers. */
async function hydrate(
  userId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<UiBlock | null> {
  switch (name) {
    case "show_projects":
      return allProjectsBlock(userId);
    case "show_project":
      return singleProjectBlock(userId, String(input.id ?? ""));
    case "show_gallery":
      return galleryBlock(userId, input.layout === "carousel" ? "carousel" : "filmstrip");
    case "show_services":
      // Null when no services are on file — the model answers in words.
      return servicesBlock(userId);
    case "show_menu":
      // Null when nothing is on file or nothing matches — the model answers in words.
      return menuBlock(userId, input);
    case "show_cart":
      return cartBlock(userId);
    case "show_contact_form":
      return contactBlock();
    case "show_booking":
      // Null when booking was disabled after the tool was seen (or a stale
      // canned answer names it) — nothing is drawn rather than a dead booker.
      return bookingBlock(userId);
    case "show_card":
      // Null when the key doesn't name a custom card any more — a canned
      // answer can outlive the card it pointed at.
      return customCardBlock(userId, String(input.key ?? ""));
    default:
      return null;
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
  cart?: CartLineSummary[],
): AsyncGenerator<BrainEvent> {
  // The visitor's latest question drives retrieval: the prompt carries only the
  // knowledge relevant to it, not the whole source library.
  const [corePrompt, catalog, booking, searchSection] = await Promise.all([
    buildSystemPrompt(userId, message),
    cardCatalog(userId),
    getBookingConfig(userId),
    searchPromptSection(userId),
  ]);
  // A tool is offered only when a catalog card names it — the catalog (the
  // admin's A2UI tab) decides what exists.
  const catalogTools = new Set(catalog.map((c) => c.tool));
  // The cart comes with the menu: a menu nobody can order from is a price list.
  const menuOn = catalogTools.has("show_menu") || catalogTools.has("show_cart");
  const menuSection = menuOn ? await menuPromptSection(userId) : "";
  // A scripted turn has its words already; it gets no search tool to wander with.
  const basePrompt = (script ? corePrompt : corePrompt + searchSection) + menuSection + cartPromptSection(cart);
  const system = script
    ? `${basePrompt}\n\nAPPROVED ANSWER\nThe owner has already written the answer to this exact question. ` +
      `Reply with it as written — do not reword, shorten, extend or add to it:\n\n${script}\n\n` +
      `Your only remaining job is to show a card alongside it when one of the cards above genuinely fits.`
    : basePrompt;
  const tools = TOOLS.filter((t) => catalogTools.has(t.name) || (menuOn && (t.name === "show_menu" || t.name === "show_cart")));
  if (menuOn && !script) tools.push(ADD_TO_CART_TOOL);
  // Custom-designed cards share one keyed tool, built from the catalog.
  const customKeys = catalog.filter((c) => c.tool === "show_card").map((c) => c.key);
  if (customKeys.length) tools.push(customCardTool(customKeys));
  // Booking is gated by its own toggle, not the catalog.
  if (booking.enabled && booking.fields.length > 0) tools.push(BOOKING_TOOL);
  if (!script) tools.push(SEARCH_TOOL);
  const convo: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
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
      if (tu.name === ADD_TO_CART_TOOL.name) {
        const { key, quantity } = (tu.input ?? {}) as { key?: unknown; quantity?: unknown };
        const item = await findMenuItem(userId, String(key ?? ""));
        const n = Number.isInteger(quantity) && Number(quantity) >= 1 ? Math.min(Number(quantity), 20) : 1;
        if (item && item.availability !== "unavailable") {
          yield { t: "cart", v: { op: "add", item, quantity: n } };
        }
        results.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: !item
            ? "No such item on the menu."
            : item.availability === "unavailable"
              ? `${item.name} is unavailable right now.`
              : item.modifiers.some((m) => m.required)
                ? `Added ${n} × ${item.name}; the visitor still needs to choose ${item.modifiers.filter((m) => m.required).map((m) => m.name).join(", ")} on the cart card.`
                : `Added ${n} × ${item.name} to the cart.`,
        });
        continue;
      }
      const block = await hydrate(userId, tu.name, (tu.input ?? {}) as Record<string, unknown>);
      if (block) yield { t: "card", v: block };
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: block ? "Card rendered to the user." : "No data available.",
      });
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
  const { userId, message, history = [], sessionId, channel = "web", cart } = input;
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
        const block = await hydrate(userId, canned.cardTool, parseCardInput(canned.cardInput));
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
      cart,
    )) {
      if (event.t === "text") spoken += event.v;
      if ((event.t === "card" || event.t === "cart") && !cards) continue;
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

import type Anthropic from "@anthropic-ai/sdk";
import { claude, cardBuilderModel } from "@/lib/claude";
import { prisma, getProfile, getPersonaConfig } from "@/lib/db";
import { safeTags } from "@/lib/knowledge";
import { CARD_TOOLS, type CardTool } from "@/lib/canned";
import { listServices } from "@/lib/cards";
import { parseSampleBlock, swatch } from "@/lib/uiCards";
import { retrieve as defaultRetrieve, formatContext } from "@/lib/retrieval/search";
import {
  findLibraryImages,
  generateCardImage,
  describePromptImage,
  imageGenEnabled,
  IMAGE_BUDGET,
  type ImageShape,
  type PromptImage,
} from "@/lib/imageGen";

/**
 * The AI card builder: turns a plain-text description ("a card that shows my
 * three best projects with a fun blurb") into a complete draft card — name,
 * tool, purpose text and a renderable sample block — and revises the draft
 * from feedback. The admin never has to hand-write block JSON; the builder
 * page previews each draft with the chat's own Cards component and only
 * saveUiCard()'s validation-checked output ever reaches the database.
 */

export type CardDraft = {
  label: string;
  tool: string;
  description: string;
  reason: string;
  note: string;
  /** JSON string of the UiBlock the preview renders. */
  sampleBlock: string;
};

/** The card types each tool may draw — a mismatch is a broken card. */
const TOOL_TO_TYPES: Record<CardTool, string[]> = {
  show_projects: ["projects"],
  show_project: ["project"],
  show_gallery: ["gallery"],
  show_services: ["services"],
  show_menu: ["menu"],
  show_cart: ["cart"],
  show_contact_form: ["contact"],
  show_booking: ["booking"],
  show_card: ["custom", "html"],
};

/**
 * How many knowledge searches one drafting call may run. Enough for the model
 * to research two or three angles and re-word a thin query; low enough that a
 * confused model cannot spin. Past the budget the tool returns an instruction
 * to draft with what it has, so the loop always converges on a card.
 */
const SEARCH_BUDGET = 4;

/**
 * The model's own ceiling, not one of ours. A coded card carrying a dense grid
 * or a big inline SVG used to truncate mid-string at 4000, which surfaced to
 * the admin as "the model's response wasn't valid JSON" — deterministic, since
 * the retry hit the same wall. The builder is a rare admin click, so there is
 * no reason to cap it below what the model can emit; output is billed by what
 * it actually writes, not by this number.
 */
const DRAFT_MAX_TOKENS = 64000;

/**
 * Extended thinking gives the model room to plan a layout before writing 5KB
 * of HTML, and the admin watches it happen. Current models take "adaptive"
 * thinking with an effort level rather than a fixed token budget — they spend
 * what the task needs.
 *
 * Both fields are load-bearing, verified against the live API:
 * - display "summarized" is what returns readable thinking text. Without it
 *   the block still arrives but carries only a signature_delta, so the panel
 *   would sit empty.
 * - effort "max" is what makes the model actually think on this workload. At
 *   "high" a card request came back with no thinking block at all.
 */
const THINKING = { type: "adaptive", display: "summarized" } as const;
const THINKING_EFFORT = "max" as const;

/**
 * How many times a malformed draft is fed back for correction. Every failure
 * message is written as an instruction ("use the theme variables…"), so the
 * model usually lands on the second try; the extra attempts cover a stubborn
 * coded card that keeps tripping the theme gate.
 */
const VALIDATION_ATTEMPTS = 5;

const BUILDER_BRIEF = `You design "A2UI cards" for a personal portfolio site's chatbot. A card is a rich UI block the chatbot can draw in a conversation. Your job: turn the owner's description into ONE card definition.

There are three ways to build a card. FIRST decide which fits, in this order:

1. A LIVE-DATA card, when the owner wants the site's own content (their projects, photos, services, contact form). These hydrate from the database at chat time, so their sample is ILLUSTRATIVE ("Sample Project A" style). Tools and exact sample shapes ("type" must match the tool):
- show_projects → {"type":"projects","items":[ProjectCard, …]} — a grid of project cards
- show_project → {"type":"project","item":ProjectCard} — one project, drawn wide
- show_gallery → {"type":"gallery","layout":"carousel"|"filmstrip","items":[PhotoCard, …]} — photos
- show_services → {"type":"services","items":[{"id":"1","name":"…","description":"…"}, …],"booking":null} — the business's services, each with a Book button when appointments are on. ALWAYS this for a services, treatments, menu or price-list card: it lists the real services on file, which a custom or coded card would freeze as a copy
- show_menu → {"type":"menu","title":"Menu","full":true,"items":[{"key":"…","name":"…","category":"…","price":"$…"}, …],"checkout":{"fulfillment":[],"contact":{"phone":"off","email":"required"},"currency":""}} — the business's menu with prices, options and add-ons, each item addable to a cart with a quantity; the whole menu grouped by section, or a curated list. Prefer this over show_services when the business sells things a visitor picks several of (dishes, products, treatments with add-ons)
- show_cart → {"type":"cart","checkout":{"fulfillment":[],"contact":{"phone":"off","email":"required"},"currency":""}} — the visitor's cart with quantities and checkout
- show_contact_form → {"type":"contact"} — the in-chat contact form

2. A CUSTOM card (tool "show_card"), ONLY for content that is genuinely a plain vertical stack — an FAQ, a testimonial, a short list of points. Stock elements render as a single unstyled column at one text size; they cannot express layout. The content you write IS what visitors will see (nothing is hydrated later — write it fully and well). Shape:
{"type":"custom","title":"…","elements":[Element, …]}
Element is one of:
{"kind":"heading","text":"…"} | {"kind":"text","text":"…"} | {"kind":"list","items":["…"]} | {"kind":"badges","items":["…"]} | {"kind":"stats","items":[{"label":"…","value":"…"}]} | {"kind":"buttons","items":[{"label":"…","url":"https://…"}]} | {"kind":"image","src":"/api/uploads/… or placeholder","alt":"…"} | {"kind":"quote","text":"…","by":"…"} | {"kind":"divider"}

DISQUALIFYING TEST for route 2 — a custom card is only correct if ALL of these hold. If even ONE fails, the card is a CODED card (route 3), no exceptions:
- Six or fewer elements, read top to bottom in one column.
- At most ONE heading, and it is the card's only title. A second heading is disqualifying: both render identically, so an eyebrow/label above a title, a kicker, or section headers within the card all collapse into the same flat text.
- At most one image, and it sits in the stack like any other element — full width, nothing beside or over it. A real image IS available here (see the image tools below), but the moment the design wants it as a hero behind a title, cropped, beside text, or one of several in a row, that is layout: code it.
- No relationship between elements other than "one after another". Anything side by side, in a grid, overlapping, aligned to a column, or visually grouped is disqualifying.
- No emphasis you cannot get from the element kinds themselves. If the design needs a word larger, a number set apart, a label in a different weight, a colored rule, a badge on a corner — that is layout, and it is disqualifying.
A useful check: if you can describe the card fully as "a title, then some paragraphs and a list", it is custom. If your description contains the words above/beside/across/hero/header/grid/columns, it is coded.

3. A CODED card (also tool "show_card"), the DEFAULT whenever route 2's test fails — and it usually does for anything a person would call "designed". A word cloud, a pricing grid, a skill meter, a profile header, a stat strip, a two-column feature, a timeline ribbon, any bespoke visual. You are the design and coding agent here: write real HTML with inline CSS yourself. As with custom cards, what you write IS what visitors see. Shape:
{"type":"html","html":"<div style=\"…\">…</div>","height":320}
Coding rules (violations fail validation or render blank):
- Inline CSS only: style attributes and/or one <style> tag. NO <script>, no event-handler attributes (onclick etc.), no <iframe>/<object>/<embed>/<form>/<link>/<meta> — the card runs in a sealed sandbox that refuses to execute anything, and validation rejects markup that looks executable.
- The sandbox blocks external requests: outside images, fonts and stylesheets will not load. You CAN use <img src="/api/uploads/…"> for an image from find_image or generate_image — those are served from this site — plus CSS, inline SVG and data: URIs. Any other host is blocked and renders as a broken image.
- Links need target="_blank" (the sandbox cannot navigate the page it sits in).
- "height" is the rendered height in px (40–1200): size it to the content, it does not auto-grow.

DESIGN SYSTEM for coded cards. Read this as a palette and a type scale, not as a layout template: COLOR and FONT are fixed and mechanically enforced, everything else is yours. Compose freely — asymmetry, overlap, grids, ribbons, oversized numerals, inline SVG illustration, whatever the content deserves — and be genuinely inventive with structure, because a coded card exists precisely to do what the stock elements cannot. The constraints below are what keep your design legible on every theme the owner might switch to; they are not a house style to imitate:
- COLORS (enforced): only the theme variables, or color-mix() blends of them for shades — raw hex/rgb()/hsl() values are rejected. Backgrounds/fills/borders: var(--bg-soft), var(--surface), var(--primary), var(--accent), var(--border). Shade example: color-mix(in srgb, var(--primary) 35%, transparent).
- TEXT COLOR (enforced, this one bites): the "color" property may ONLY use the readable-on tokens — var(--on-bg-soft) for normal text, var(--accent-on-bg-soft) for emphasis, var(--success-on-bg-soft)/var(--danger-on-bg-soft) for status, var(--on-primary) on a primary background, var(--on-surface) on a surface background — or color-mix() blends of those (keep the token at ≥55% so text stays legible). NEVER color text with var(--primary)/var(--accent)/var(--surface) directly: on many themes those sit close to the card background and the text becomes invisible. Vary word-cloud emphasis with font-size, font-weight and ≥55% color-mix opacity of the on-tokens, not with brand colors. The same rule applies to SVG fill/stroke on text-bearing shapes.
- TEXT (enforced): never declare a concrete font-family — headings already use the site's heading font (h1 17px, h2 15px, h3 14px) and body text is already 14px/1.55 in the site font; font-family declarations that don't reference a var() are rejected. Secondary/caption text: 11–12px, often italic. Tags: 11px, var(--accent-on-bg-soft), "#" prefix, no background.
- EDGES: build corners from the radius tokens — var(--radius-md) for containers, var(--radius-sm) for small controls, var(--radius-pill) for pills and dots — and borders from var(--border), so edges match the rest of the site. Which elements get an edge at all, and how you use them, is a design choice.
- BUTTONS: primary = background var(--primary), color var(--on-primary), no border, padding 10px 18px, radius var(--radius-sm); secondary = transparent, 1px solid var(--border), italic.
- SPACING: ~16px container padding and 8–12px gaps as a resting rhythm; depart from it deliberately where the composition calls for it.
- To restate the boundary: color tokens, the type scale and the radius/border tokens are fixed. Structure, hierarchy, proportion, density, illustration and the overall idea of the card are entirely yours — a coded card should look designed, not like a stack of stock elements with better spacing.

Field shapes for live-data samples:
ProjectCard = {"id":string,"name":string,"blurb":string,"detail":string|null,"githubUrl":string|null,"liveUrl":string|null,"imageUrl":string|null,"tags":[string,…]}
PhotoCard = {"id":string,"src":string,"description":string,"caption":string|null}
TimelineEntry = {"role":string,"company":string,"dates":string,"description":string}

Rules:
- Route in order: a live-data tool when the intent clearly matches site content; otherwise run route 2's disqualifying test and take CODED html the moment any part of it fails. When a card could plausibly go either way, code it — a flat stack that wanted design is a worse outcome than a designed card that could have been flat.
- Custom and coded card content comes from the REAL SITE DATA section below — real project names, real tags, real roles. Never invent facts; where the data is silent, stay generic and say so in "note".
- IMAGES: when the request carries an ATTACHED IMAGES block, those come first — the owner picked them deliberately, and each one says whether to embed it or treat it as visual direction. Beyond that you have two tools. "find_image" searches the images the owner already HAS (uploaded photos and their descriptions, project images, their company logo) — always try this first, because a real photo of the actual subject beats any drawing of it. "generate_image" draws new artwork when the library has nothing that fits. Both return a src path like "/api/uploads/…" — put that EXACT string in the image field and it renders for real, in stock elements and coded cards alike. Only when neither tool gives you something suitable, fall back to the exact string "placeholder", which becomes a flat colored swatch. Never write any other URL into an image field: outside images are stripped and render as a swatch.
- Generated artwork defaults to flat, textless illustration on a plain background — the look that survives the visitor re-theming the card under it. Ask for something else in the prompt whenever the card wants it (photographic realism, a dense texture, a specific palette, lettering) and your prompt wins. Two things stay true regardless: generated art cannot depict the owner's actual people, places or events — use find_image for those — and words baked into pixels keep their own color when the theme changes, so put titles and labels in the HTML around the image unless the lettering itself is the design.
- In a custom card, only include facts the owner actually stated. Where you need specifics they didn't give (a price, a link), keep it generic and flag it in "note" so they know to revise.
- "reason" is the instruction the chatbot will actually receive about when to show this card. Write it as guidance, starting "When …".
- "note" is an optional admin-facing caveat; usually "".

RESEARCH: the REAL SITE DATA below is a summary — names, tags, roles. The owner's full knowledge base (articles, talks, notes, project write-ups, photo descriptions, past answers) is searchable with the "search_knowledge" tool. Use it whenever the card needs specifics the summary doesn't carry: quotes for a testimonial card, real topics for a writing card, actual detail for a project deep-dive. Search BEFORE drafting, with the terms you'd expect in the source material; search again with different wording if the first result is thin. You have a budget of ${SEARCH_BUDGET} searches per card — spend them when content depends on facts, skip them when the summary already covers it. When a search returns nothing, say so in "note" and keep that part of the card generic rather than inventing it. Two more tools cover artwork: "find_image" (unlimited, always try first) and "generate_image" (${IMAGE_BUDGET} per card) — see the IMAGES rule above.

Respond with ONLY a JSON object (no prose, no code fences):
{"label":"…","tool":"show_…","description":"one line on what it renders","reason":"When …","note":"","sampleBlock":{…the block object…}}`;

/**
 * The site's actual content, given to the drafting model so custom and coded
 * cards are built FROM real data instead of invented "typical" examples. A
 * card listing project tags carries Blake's real tags; the model only stays
 * generic where the data is silent. Best-effort: a DB hiccup degrades to
 * drafting without data, not a dead builder.
 */
async function siteDataBrief(userId: string): Promise<string> {
  try {
    const [profile, persona, projects, photoCount, services] = await Promise.all([
      getProfile(userId),
      getPersonaConfig(userId),
      prisma.project.findMany({ where: { userId }, orderBy: { order: "asc" } }),
      prisma.photo.count({ where: { userId } }),
      listServices(userId),
    ]);
    const lines: string[] = ["REAL SITE DATA (build card content from this — do not invent facts):"];
    const who = profile.company_name || profile.owner_name;
    lines.push(`Business: ${who}${persona.tagline ? ` — ${persona.tagline}` : ""}`);
    if (projects.length) {
      lines.push("Projects (name | tags | blurb):");
      for (const p of projects.slice(0, 20)) {
        lines.push(`- ${p.name} | ${safeTags(p.tags).join(", ") || "(no tags)"} | ${p.blurb.slice(0, 140)}`);
      }
    } else {
      lines.push("Projects: none added yet.");
    }
    // show_services draws nothing without services on file, so the model has
    // to know which side of that line this account is on before choosing it.
    lines.push(
      services.length
        ? `Services on file (${services.length}): ${services.slice(0, 20).map((s) => s.name).join(", ")}`
        : "Services: none on file — show_services would draw nothing.",
    );
    lines.push(
      services.length
        ? "Menu: the same items are on file for show_menu / show_cart (the orderable menu with a cart)."
        : "Menu: none on file — show_menu would draw nothing.",
    );
    const contact = [profile.company_email, profile.company_phone_number, profile.company_address, profile.company_hours].filter(Boolean).join(" | ");
    if (contact) lines.push(`Contact: ${contact}`);
    lines.push(`Photos: ${photoCount} uploaded.`);
    return lines.join("\n").slice(0, 3500);
  } catch {
    return "REAL SITE DATA: (unavailable right now — keep content generic and flag it in the note.)";
  }
}

/**
 * A conversation turn: plain text, or the structured blocks a tool turn needs
 * (the model's tool_use blocks replayed back, and our tool_result blocks).
 * Typed against the SDK's block params so the real client accepts it.
 */
type BuilderContent = Anthropic.MessageParam["content"];
type BuilderMessage = { role: "user" | "assistant"; content: BuilderContent };

/** Minimal client surface, injectable for tests (same pattern as answerDrafts). */
export type BuilderClient = {
  messages: {
    create(req: {
      model: string;
      max_tokens: number;
      system: string;
      tools?: Anthropic.Tool[];
      thinking?: Anthropic.ThinkingConfigParam;
      output_config?: { effort?: "low" | "medium" | "high" | "xhigh" | "max" };
      messages: BuilderMessage[];
    }): Promise<{ content: unknown[]; stop_reason?: string | null }>;
  };
};

/**
 * What the admin sees while a card is being built. The builder emits these as
 * it works so the page can show reasoning and searches instead of a dead
 * "Designing…" — a coded card can take two minutes, and silence that long
 * reads as a hang.
 */
export type BuildEvent =
  | { t: "thinking"; v: string }
  | { t: "search"; query: string }
  | { t: "searched"; query: string; hits: number }
  | { t: "image"; src: string; prompt: string }
  | { t: "status"; v: string }
  | { t: "draft"; draft: CardDraft }
  | { t: "error"; v: string };

export type BuilderDeps = {
  client?: BuilderClient;
  /** Injectable for proof; defaults to the chatbot's own hybrid retrieval. */
  retrieve?: typeof defaultRetrieve;
  /** Called with each progress event; the streaming route forwards these. */
  onEvent?: (e: BuildEvent) => void;
};

/**
 * Look through the images the owner already has before drawing a new one.
 * Offered unconditionally — unlike generation, this needs no API key, and a
 * real photo of the actual subject beats generated artwork every time.
 */
const FIND_IMAGE_TOOL = {
  name: "find_image",
  description:
    "Search the images the owner already has — uploaded photos with their descriptions, "
    + "project images, source article images and their company logo — for one that fits the card. "
    + "Returns matching images with a src path you can use directly in an image field. "
    + "ALWAYS try this before generate_image: a real photo of the actual subject is better "
    + "than a drawing of it.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "What the image should show, in the words its description would use.",
      },
    },
    required: ["query"],
  },
};

/**
 * Draw artwork a card needs and the library does not have. Offered only when
 * an image key is configured, so an unconfigured site simply never sees the
 * tool rather than watching the model call something that always fails.
 */
const GENERATE_IMAGE_TOOL = {
  name: "generate_image",
  description:
    "Generate artwork for the card and store it on the site. Use when the card needs an image "
    + "that find_image did not turn up — a hero, a texture, a spot illustration, a backdrop. "
    + "Returns a src path you can use directly in an image field. "
    + `Budget: ${IMAGE_BUDGET} per card. `
    + "Left unspecified, the image comes back as flat textless illustration on a plain background, "
    + "which is the safest look under a theme the visitor can change. Say so in the prompt when the "
    + "card wants something else — photographic realism, a dense full-bleed texture, a particular "
    + "palette, lettering — and that wins over the default. Two things to weigh: generated art is "
    + "strong at abstract, textural and conceptual imagery but cannot depict the owner's specific "
    + "real people, places or events (use find_image for those), and any text baked into the pixels "
    + "keeps its own color when the visitor switches themes, so prefer real HTML text over lettering "
    + "in the image unless the lettering IS the design.",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string" as const,
        description:
          "What to draw, described concretely — subject, composition, mood, palette. State any "
          + "departure from the house style (flat, textless, plain background) explicitly here, "
          + "because whatever you write overrides it.",
      },
      shape: {
        type: "string" as const,
        enum: ["landscape", "square", "portrait"],
        description: "landscape for a hero or banner, square for an avatar or icon.",
      },
    },
    required: ["prompt"],
  },
};

/** The knowledge search: the same retrieval the chatbot runs. */
const SEARCH_TOOL = {
  name: "search_knowledge",
  description:
    "Search the owner's knowledge base — articles, talks, notes, project write-ups, "
    + "photo descriptions and past answers — for facts to build the card from. "
    + "Returns matching excerpts plus known relationships between the things they mention.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string" as const,
        description: "What to look for, in the words you'd expect in the source material.",
      },
    },
    required: ["query"],
  },
};

/**
 * Run one `search_knowledge` call. Never throws: a knowledge-base problem
 * degrades to a note the model can act on, because a dead index must not
 * dead-end a card the model could still draft from the summary brief.
 */
async function runSearch(
  userId: string,
  input: unknown,
  search: typeof defaultRetrieve,
): Promise<{ text: string; query: string; hits: number }> {
  const query = String((input as { query?: unknown })?.query ?? "").trim();
  if (!query) {
    return { text: "No query given — call the tool with a `query` string.", query, hits: 0 };
  }
  try {
    const result = await search(userId, query);
    if (!result.chunks.length) {
      return {
        query,
        hits: 0,
        text: `Nothing in the knowledge base matched "${query}". Try different wording, `
          + "or keep that part of the card generic and flag it in the note.",
      };
    }
    return { text: formatContext(result), query, hits: result.chunks.length };
  } catch {
    return {
      query,
      hits: 0,
      text: "The knowledge base could not be searched right now. Draft from the "
        + "REAL SITE DATA summary and flag any gaps in the note.",
    };
  }
}

/**
 * Turn attached images into a block of the opening brief. Each one is read by
 * vision once, here, rather than re-sent as bytes on every turn of a loop that
 * can run ten times.
 *
 * The admin's intent is stated as an instruction rather than left for the model
 * to infer: "use" and "reference" pull in opposite directions — one embeds the
 * file, the other must NOT — and guessing wrong wastes a whole build.
 */
async function describeAttachments(attachments: PromptImage[]): Promise<string> {
  if (!attachments.length) return "";
  const described = await Promise.all(
    attachments.map(async (a) => ({ ...a, desc: await describePromptImage(a.src) })),
  );

  const lines: string[] = ["ATTACHED IMAGES (the owner added these to this request):"];
  for (const a of described) {
    const what = a.desc || "(the image could not be read — rely on the description above)";
    if (a.intent === "use") {
      lines.push(
        `- USE THIS IMAGE IN THE CARD. Put the exact src "${a.src}" in an image field (or an `
        + `<img src="${a.src}"> in coded HTML), and design the card around it. What it shows: ${what}`,
      );
    } else if (a.intent === "reference") {
      lines.push(
        `- STYLE REFERENCE ONLY — do NOT put this image in the card, and never write its src `
        + `anywhere. Take layout, structure, proportion and mood direction from it, expressed `
        + `with the site's own theme tokens. What it shows: ${what}`,
      );
    } else {
      lines.push(
        `- The owner attached this without saying how to use it. Decide from their description: `
        + `embed it with the exact src "${a.src}" if the card wants this actual image, or treat it `
        + `as visual direction and leave it out. What it shows: ${what}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Look up images the owner already has. Never throws: a lookup failure means
 * the model generates or goes without artwork, not that the card dies.
 */
async function runFindImage(
  userId: string,
  input: unknown,
  emit: (e: BuildEvent) => void,
): Promise<string> {
  const query = String((input as { query?: unknown })?.query ?? "").trim();
  emit({ t: "status", v: `Looking for an image of "${query}"…` });
  try {
    const found = await findLibraryImages(userId, query);
    if (!found.length) {
      return "The owner has no images stored yet. Either generate one, or design the card "
        + "without artwork.";
    }
    const lines = found.map((f) => `- src "${f.src}" (${f.origin}): ${f.description}`);
    emit({ t: "status", v: `Found ${found.length} image${found.length === 1 ? "" : "s"}.` });
    return (
      `Images the owner already has (use a src EXACTLY as written, only if it genuinely fits `
      + `the card — otherwise generate one or use none):\n${lines.join("\n")}`
    );
  } catch {
    return "The image library could not be read right now. Generate an image instead, or "
      + "design the card without artwork.";
  }
}

/**
 * Draw and store one image. Never throws: a generation failure comes back as
 * an instruction, so the model finishes the card without artwork rather than
 * losing the whole draft to a provider hiccup.
 */
async function runGenerateImage(input: unknown, emit: (e: BuildEvent) => void): Promise<string> {
  const req = input as { prompt?: unknown; shape?: unknown };
  const prompt = String(req?.prompt ?? "").trim();
  const shape = (["landscape", "square", "portrait"] as const).includes(req?.shape as ImageShape)
    ? (req.shape as ImageShape)
    : "landscape";
  emit({ t: "status", v: `Generating an image: ${prompt.slice(0, 80)}…` });
  try {
    const img = await generateCardImage(prompt, shape);
    emit({ t: "image", src: img.src, prompt: img.prompt });
    return `Image created and stored. Use this EXACT src in the card: "${img.src}"`;
  } catch (e) {
    return `Image generation failed: ${(e as Error).message} Design the card without artwork, `
      + "and say so in the note.";
  }
}

/**
 * Draft a card from a description, or revise a draft from feedback. The
 * revision call replays the description and current draft as conversation
 * turns, so feedback like "make it three photos" edits rather than restarts.
 */
export async function draftUiCard(
  userId: string,
  input: {
    instructions: string;
    current?: CardDraft;
    feedback?: string;
    /** Images the admin attached to the prompt. */
    attachments?: PromptImage[];
  },
  deps: BuilderDeps = {},
): Promise<CardDraft> {
  const instructions = input.instructions.trim();
  if (!instructions) throw new Error("Describe the card you want first.");

  // An attachment belongs in the FIRST user turn: it is part of the brief, not
  // a fact discovered later, and it often decides the whole layout.
  const attachmentBrief = await describeAttachments(input.attachments ?? []);
  const messages: BuilderMessage[] = [
    { role: "user", content: attachmentBrief ? `${instructions}\n\n${attachmentBrief}` : instructions },
  ];
  if (input.current && input.feedback?.trim()) {
    messages.push(
      { role: "assistant", content: draftToJson(input.current) },
      { role: "user", content: `Revise the card with this feedback: ${input.feedback.trim()}` },
    );
  }

  const client = deps.client ?? claude();
  const search = deps.retrieve ?? defaultRetrieve;
  const emit = deps.onEvent ?? (() => {});
  const system = `${BUILDER_BRIEF}\n\n${await siteDataBrief(userId)}`;

  // Two nested behaviors share one conversation:
  //  - Research: the model may call search_knowledge to pull real facts out of
  //    the knowledge base before it drafts, up to SEARCH_BUDGET times.
  //  - Self-correction: a draft that fails validation goes back to the model
  //    WITH the validation error. The errors are written as instructions ("use
  //    the theme variables…"), so the model keeps correcting until it lands or
  //    VALIDATION_ATTEMPTS is spent — a malformed completion costs retries,
  //    never a saved broken card.
  let convo = messages;
  let searches = 0;
  let images = 0;
  let attempt = 0;
  let lastError: Error | null = null;
  // Bounded by construction: every iteration either spends a search or a
  // validation attempt, and both are capped.
  for (let turn = 0; turn < SEARCH_BUDGET + VALIDATION_ATTEMPTS + 2; turn++) {
    const response = await streamOnce(client, {
      model: cardBuilderModel(),
      max_tokens: DRAFT_MAX_TOKENS,
      system,
      // Generation is offered only when configured; the library lookup and the
      // knowledge search always are.
      tools: imageGenEnabled()
        ? [SEARCH_TOOL, FIND_IMAGE_TOOL, GENERATE_IMAGE_TOOL]
        : [SEARCH_TOOL, FIND_IMAGE_TOOL],
      thinking: THINKING,
      output_config: { effort: THINKING_EFFORT },
      messages: convo,
    }, emit);

    const toolUses = toolUsesOf(response.content);
    if (toolUses.length) {
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (tu.name === FIND_IMAGE_TOOL.name) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: await runFindImage(userId, tu.input, emit),
          });
          continue;
        }
        if (tu.name === GENERATE_IMAGE_TOOL.name) {
          if (images >= IMAGE_BUDGET) {
            results.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Image budget spent (${IMAGE_BUDGET} per card). Build the rest of the `
                + "card with the images you already have.",
            });
            continue;
          }
          images++;
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: await runGenerateImage(tu.input, emit),
          });
          continue;
        }
        const over = searches >= SEARCH_BUDGET;
        if (over) {
          results.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Search budget spent (${SEARCH_BUDGET} searches). Draft with what you have `
              + "now, and flag any remaining gaps in the note.",
          });
          continue;
        }
        searches++;
        const q = String((tu.input as { query?: unknown })?.query ?? "").trim();
        emit({ t: "search", query: q });
        const r = await runSearch(userId, tu.input, search);
        emit({ t: "searched", query: r.query, hits: r.hits });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: r.text });
      }
      convo = [
        ...convo,
        // Replay the model's own blocks verbatim — the tool_use ids in the
        // results must refer to blocks the model can see in its own turn, and
        // thinking blocks must survive the round trip for the next turn.
        { role: "assistant", content: response.content as BuilderContent },
        { role: "user", content: results },
      ];
      continue;
    }

    const raw = textOf(response.content);
    try {
      const draft = parseDraft(raw);
      emit({ t: "draft", draft });
      return draft;
    } catch (e) {
      lastError = e as Error;
      attempt++;
      if (attempt >= VALIDATION_ATTEMPTS) throw lastError;
      emit({ t: "status", v: `Draft ${attempt} didn't validate — correcting: ${lastError.message}` });
      convo = [
        ...convo,
        // Only the text is replayed on a correction turn: thinking blocks are
        // tied to the turn that produced them, and this turn is being redone.
        { role: "assistant", content: raw },
        {
          role: "user",
          content:
            `That response failed validation: ${lastError.message} ` +
            "Respond again with ONLY the corrected JSON object.",
        },
      ];
    }
  }
  // Only reachable if the model spends every turn on tool calls and never
  // drafts — surfaced as a retryable message, never a saved broken card.
  throw lastError ?? new Error("The builder kept researching without drafting a card — try again.");
}

/**
 * One streamed model turn. Streaming is what makes thinking visible — the
 * deltas arrive as the model reasons, and a two-minute coded card stops
 * looking like a hang. Returns the assembled final message, so the caller's
 * tool/validation logic is identical to the non-streamed shape.
 *
 * Falls back to a plain create() for injected test clients, which implement
 * only the non-streaming surface.
 */
async function streamOnce(
  client: BuilderClient,
  req: Parameters<BuilderClient["messages"]["create"]>[0],
  emit: (e: BuildEvent) => void,
): Promise<{ content: unknown[]; stop_reason?: string | null }> {
  const streamable = (client as { messages: { stream?: unknown } }).messages.stream;
  if (typeof streamable !== "function") return client.messages.create(req);

  const stream = (client as unknown as Anthropic).messages.stream(
    req as unknown as Anthropic.MessageStreamParams,
  );
  for await (const event of stream) {
    if (event.type !== "content_block_delta") continue;
    const delta = event.delta as { type?: string; thinking?: string };
    if (delta.type === "thinking_delta" && delta.thinking) {
      emit({ t: "thinking", v: delta.thinking });
    }
  }
  const final = await stream.finalMessage();
  return { content: final.content, stop_reason: final.stop_reason };
}

type ToolUse = { id: string; name: string; input: unknown };

/** The tool_use blocks in a response, if the model asked to search. */
function toolUsesOf(content: unknown[]): ToolUse[] {
  return content.filter(
    (b): b is ToolUse =>
      !!b && typeof b === "object" && (b as { type?: string }).type === "tool_use",
  );
}

function textOf(content: unknown[]): string {
  return content
    .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
    .join("");
}

function draftToJson(d: CardDraft): string {
  return JSON.stringify({ ...d, sampleBlock: JSON.parse(d.sampleBlock) });
}

/**
 * Parse and validate a model response into a draft. Every failure throws a
 * message the builder page can show next to a "try again" — a malformed
 * completion must cost one retry, never a saved broken card.
 */
export function parseDraft(raw: string): CardDraft {
  // Models fence JSON out of habit even when told not to.
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped) as Record<string, unknown>;
  } catch {
    throw new Error("The model's response wasn't valid JSON — try again.");
  }

  const label = String(parsed.label ?? "").trim();
  if (!label) throw new Error("The draft is missing a name — try again.");
  const tool = String(parsed.tool ?? "");
  if (!CARD_TOOLS.includes(tool as CardTool)) {
    throw new Error(`The draft names an unknown tool "${tool}" — try again.`);
  }

  const rawBlock = parsed.sampleBlock;
  if (!rawBlock || typeof rawBlock !== "object") {
    throw new Error("The draft is missing its sample block — try again.");
  }
  const withImages = substitutePlaceholders(rawBlock as Record<string, unknown>, label);
  const sampleBlock = JSON.stringify(withImages);
  const block = parseSampleBlock(sampleBlock);
  if (!block) throw new Error("The draft's sample block isn't a renderable card — try again.");
  const allowed = TOOL_TO_TYPES[tool as CardTool];
  if (!allowed.includes(block.type)) {
    throw new Error(
      `The sample is a "${block.type}" block but ${tool} draws ${allowed.map((t) => `"${t}"`).join(" or ")} — try again.`,
    );
  }
  if (block.type === "html") enforceThemedHtml(block.html);

  return {
    label,
    tool,
    description: String(parsed.description ?? "").trim(),
    reason: String(parsed.reason ?? "").trim(),
    note: String(parsed.note ?? "").trim(),
    sampleBlock,
  };
}

/**
 * The theme-fidelity gate for coded cards: colors, edges and text must come
 * from the site's design system. Colors and fonts are checkable mechanically,
 * so they are enforced here; layout stays the model's to design. Thrown
 * messages are instructions — the drafting loop feeds them back to the model
 * for a corrected attempt.
 */
function enforceThemedHtml(html: string): void {
  if (/#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\s*\(/.test(html)) {
    throw new Error(
      "The coded card hard-codes colors. Use only the theme variables (var(--primary), "
      + "var(--on-bg-soft), …) or color-mix() blends of them — try again.",
    );
  }
  // Text must use the readable-on tokens. Raw brand tokens as text color are
  // the invisible-words bug: on themes where --primary sits near the card
  // surface, a word cloud colored var(--primary) renders as a blank card.
  const colorDecl = /(?:^|[;{"\s'])color\s*:\s*([^;"'}]+)/gi;
  for (let m = colorDecl.exec(html); m; m = colorDecl.exec(html)) {
    const value = m[1].trim();
    if (/^(inherit|currentcolor|transparent)$/i.test(value)) continue;
    if (!/var\(--[a-z0-9-]*on-[a-z0-9-]*\)/i.test(value)) {
      throw new Error(
        `The coded card colors text with "${value}", which can vanish against the card `
        + "background on some themes. Color text ONLY with the readable-on tokens — "
        + "var(--on-bg-soft), var(--accent-on-bg-soft), var(--success-on-bg-soft), "
        + "var(--on-primary) on primary — or color-mix() of them — try again.",
      );
    }
  }
  // A font-family that names a real font drifts off-theme; one that references
  // a var() (or inherit) rides the theme. The body font needs no declaration.
  const fontDecl = /font-family\s*:\s*([^;"'}]+)/gi;
  for (let m = fontDecl.exec(html); m; m = fontDecl.exec(html)) {
    if (!/var\(|inherit/i.test(m[1])) {
      throw new Error(
        "The coded card sets a concrete font-family. Text inherits the site's fonts; "
        + "use var(--font-heading) for headings or omit font-family — try again.",
      );
    }
  }
}

/** Rotating flat colors for generated placeholder images. */
const SWATCH_COLORS = ["#3b4a63", "#5a4a63", "#3f5a52", "#33415c", "#5c4433"];

/**
 * Images the builder legitimately produced: an upload the model found through
 * find_image, or one generate_image just stored. Both are the site's own bytes
 * on our own volume, so they survive the placeholder swap that exists to catch
 * URLs the model invented. Anything else — a remote host, a made-up path — is
 * still replaced with a swatch.
 */
function isOwnedImage(src: string): boolean {
  return /^\/api\/uploads\/[a-f0-9-]+\.(jpg|png|webp|gif)$/i.test(src);
}

/**
 * Swap every "placeholder" image the model emitted (and any non-data URL — the
 * preview must never fetch an external image the model invented) for a
 * generated flat swatch. Real site uploads pass through untouched. Walks the
 * block structurally, so it covers items in arrays as well as top-level fields.
 */
function substitutePlaceholders(node: Record<string, unknown>, label: string): Record<string, unknown> {
  let i = 0;
  const next = () => SWATCH_COLORS[i++ % SWATCH_COLORS.length];
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (
          (k === "src" || k === "imageUrl") &&
          typeof val === "string" &&
          val &&
          !val.startsWith("data:") &&
          !isOwnedImage(val)
        ) {
          out[k] = swatch(label, next());
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return walk(node) as Record<string, unknown>;
}

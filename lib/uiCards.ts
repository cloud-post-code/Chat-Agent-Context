import { prisma } from "@/lib/db";
import { CARD_TOOLS, type CardTool } from "@/lib/canned";
import type { UiBlock } from "@/lib/cards";

/**
 * The A2UI card catalog: one row per card the chatbot can draw, holding its
 * name, the tool that draws it, the guidance for when the agent should show
 * it, and a stored sample payload the admin tab renders as a preview.
 *
 * The catalog drives the chatbot: lib/brain.ts offers a tool only when a row
 * names it, and lib/knowledge.ts builds the "when to use each card" prompt
 * section from the rows' reasons. Deleting a row therefore takes the card away
 * from the agent, and editing a reason steers it.
 *
 * Data only, like lib/canned.ts — rendering belongs to the admin panel.
 */

export type UiCardRow = {
  id: string;
  key: string;
  label: string;
  tool: string;
  description: string;
  reason: string;
  note: string;
  sampleBlock: string;
  order: number;
};

const BLOCK_TYPES = [
  "projects",
  "project",
  "gallery",
  "contact",
  "custom",
  "html",
] as const;

const MAX_HTML_LENGTH = 40_000;

/**
 * Whether a coded card's markup is storable. The sandboxed iframe it renders
 * in refuses to execute anything anyway (no scripts, sealed CSP) — this check
 * is defense in depth: markup that even LOOKS executable never reaches the
 * database, so a renderer regression can't turn stored cards into an attack.
 */
export function safeCardHtml(html: unknown): html is string {
  if (typeof html !== "string" || !html.trim() || html.length > MAX_HTML_LENGTH) return false;
  return !/<\s*(script|iframe|object|embed|link|meta|base|form)\b|javascript:|\bon[a-z]+\s*=|srcdoc\s*=/i.test(
    html,
  );
}

/**
 * Parse a stored sample into a renderable block, or null when it isn't one.
 * Sample JSON is admin-typed free text, so a typo must degrade into "no
 * preview", never a crashed dashboard.
 */
export function parseSampleBlock(raw: string): UiBlock | null {
  try {
    const v = JSON.parse(raw);
    if (
      v &&
      typeof v === "object" &&
      (BLOCK_TYPES as readonly string[]).includes((v as { type?: string }).type ?? "")
    ) {
      const block = v as UiBlock;
      if (block.type === "html" && !safeCardHtml(block.html)) return null;
      return block;
    }
    return null;
  } catch {
    return null;
  }
}

export async function listUiCards(userId: string): Promise<UiCardRow[]> {
  return prisma.uiCard.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/** Write one row from the admin form. A blank id creates. */
export async function saveUiCard(userId: string, input: {
  id?: string;
  key: string;
  label: string;
  tool: string;
  description: string;
  reason: string;
  note: string;
  sampleBlock: string;
  order?: number;
}): Promise<string | null> {
  const label = input.label.trim();
  if (!label) return "The card needs a name.";
  const tool = CARD_TOOLS.includes(input.tool as CardTool) ? input.tool : null;
  if (!tool) return `Unknown tool "${input.tool}".`;

  const sampleBlock = input.sampleBlock.trim() || "{}";
  if (sampleBlock !== "{}" && !parseSampleBlock(sampleBlock)) {
    return "Sample block must be JSON with a \"type\" of: " + BLOCK_TYPES.join(", ") + ".";
  }

  // The key anchors deep links and the starter seed; a hand-typed one is
  // normalized rather than rejected, and a blank one is derived from the label.
  let key =
    (input.key.trim() || label)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "card";

  // `key` is unique, and what happens on a collision depends on intent. An
  // EDIT keeping its own key is a plain update. A NEW card whose derived key
  // is taken gets a suffixed key instead: the builder names cards freely, and
  // silently overwriting whichever existing card happened to share the name
  // is how a "new" card vanishes from the list while the agent serves it.
  const owner = await prisma.uiCard.findUnique({
    where: { userId_key: { userId, key } },
  });
  if (owner && owner.id !== input.id) {
    for (let n = 2; ; n++) {
      const candidate = `${key}-${n}`;
      if (
        !(await prisma.uiCard.findUnique({
          where: { userId_key: { userId, key: candidate } },
        }))
      ) {
        key = candidate;
        break;
      }
    }
  }

  const data = {
    key,
    label,
    tool,
    description: input.description.trim(),
    reason: input.reason.trim(),
    note: input.note.trim(),
    sampleBlock,
  };

  if (input.id) {
    const updated = await prisma.uiCard.updateMany({
      where: { id: input.id, userId },
      data: { ...data, order: input.order ?? 0 },
    });
    if (updated.count === 0) return "That card no longer exists.";
  } else {
    // New cards go to the end of the list, where "just added" is findable.
    const last = await prisma.uiCard.aggregate({
      where: { userId },
      _max: { order: true },
    });
    await prisma.uiCard.create({
      data: { ...data, userId, order: input.order ?? (last._max.order ?? -1) + 1 },
    });
  }
  return null;
}

export async function deleteUiCard(userId: string, id: string) {
  await prisma.uiCard.deleteMany({ where: { id, userId } });
}

export type CardGuidance = { tool: string; reason: string; key: string };

/**
 * The catalog as the chatbot consumes it: which tools exist and when to use
 * them. Falls back to the starter set when the table is empty — a visitor can
 * chat before the dashboard has ever seeded it — and when the read fails,
 * because a DB hiccup must degrade to stock guidance, not a card-less bot.
 */
export async function cardCatalog(userId: string): Promise<CardGuidance[]> {
  try {
    const rows = await prisma.uiCard.findMany({
      where: { userId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { tool: true, reason: true, key: true },
    });
    if (rows.length > 0) return rows;
  } catch {
    // fall through to starters
  }
  return STARTER_CARDS.map((c) => ({ tool: c.tool, reason: c.reason, key: c.key }));
}

/**
 * A builder-made card's stored block, for the show_card tool at chat time.
 * Only "custom" and coded "html" blocks are served: pointing show_card at a
 * built-in card would draw its SAMPLE content to a visitor as if it were real.
 */
export async function customCardBlock(userId: string, key: string): Promise<UiBlock | null> {
  if (!key.trim()) return null;
  const row = await prisma.uiCard.findUnique({
    where: { userId_key: { userId, key: key.trim() } },
  });
  const block = row ? parseSampleBlock(row.sampleBlock) : null;
  return block && (block.type === "custom" || block.type === "html") ? block : null;
}

/**
 * Fill an EMPTY table with the starter cards — one per card the chatbot can
 * currently draw. Never tops up a non-empty table: a missing row is a
 * deletion Blake made on purpose.
 */
export async function seedStarterUiCards(userId: string) {
  if ((await prisma.uiCard.count({ where: { userId } })) > 0) return;
  await prisma.uiCard.createMany({
    data: STARTER_CARDS.map((c, i) => ({ ...c, userId, order: i })),
    skipDuplicates: true,
  });
}

/** A flat placeholder image, so sample cards need no uploads. */
export function swatch(label: string, bg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">` +
    `<rect width="480" height="320" fill="${bg}"/>` +
    `<text x="240" y="172" text-anchor="middle" font-family="sans-serif" ` +
    `font-size="24" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SAMPLE_PHOTOS = [
  {
    id: "s1",
    src: swatch("Sample photo 1", "#3b4a63"),
    description: "A sample photo. Real captions come from Claude's description of the upload.",
    caption: "Sample one",
  },
  {
    id: "s2",
    src: swatch("Sample photo 2", "#5a4a63"),
    description: "The second sample, so the arrows and dots have somewhere to go.",
    caption: "Sample two",
  },
  {
    id: "s3",
    src: swatch("Sample photo 3", "#3f5a52"),
    description: "The third sample — the filmstrip scrolls once there are enough.",
    caption: "Sample three",
  },
];

const SAMPLE_PROJECTS = [
  {
    id: "sample-a",
    name: "Sample Project A",
    blurb: "A one-line blurb — this is the line that sells the project.",
    detail:
      "The longer write-up, hidden behind Learn more. It is the place for how it "
      + "was built, what was hard, and what it does now.",
    githubUrl: "https://github.com/example/sample-a",
    liveUrl: "https://example.com",
    imageUrl: swatch("Project image", "#33415c"),
    tags: ["typescript", "next.js"],
  },
  {
    id: "sample-b",
    name: "Sample Project B",
    blurb: "No image and no live link — the card closes up around what is missing.",
    detail: null,
    githubUrl: "https://github.com/example/sample-b",
    liveUrl: null,
    imageUrl: null,
    tags: ["python"],
  },
  {
    id: "sample-c",
    name: "Sample Project C",
    blurb: "Links but no image, and a detail paragraph to expand.",
    detail: "Learn more shows this. Keep it to a paragraph or two.",
    githubUrl: null,
    liveUrl: "https://example.com",
    imageUrl: null,
    tags: ["react", "postgres"],
  },
];

/** Five roles, so the "earlier roles" fold is on show — the card holds four. */

/**
 * The starter rows: every card the chatbot can currently draw. The `reason`
 * texts are the same guidance lib/knowledge.ts gives the model today, so the
 * seeded catalog documents the behavior that actually ships.
 */
const STARTER_CARDS: Omit<UiCardRow, "id" | "order">[] = [
  {
    key: "projects",
    label: "All projects",
    tool: "show_projects",
    description: "Every project, as a grid of cards.",
    reason: "When asked about projects generally — it renders all project cards.",
    note: "",
    sampleBlock: JSON.stringify({ type: "projects", items: SAMPLE_PROJECTS }),
  },
  {
    key: "project",
    label: "Single project",
    tool: "show_project",
    description: "One project by id, drawn wider than the grid card.",
    reason: "When asked about one specific project — it renders that card alone.",
    note: "",
    sampleBlock: JSON.stringify({ type: "project", item: SAMPLE_PROJECTS[0] }),
  },
  {
    key: "gallery-carousel",
    label: "Gallery — carousel",
    tool: "show_gallery",
    description: "Photos one at a time, with arrows and dots.",
    reason:
      "When asked to see photos, a gallery, or pictures. Choose layout \"carousel\" "
      + "for a slideshow feel.",
    note: "",
    sampleBlock: JSON.stringify({ type: "gallery", layout: "carousel", items: SAMPLE_PHOTOS }),
  },
  {
    key: "gallery-filmstrip",
    label: "Gallery — filmstrip",
    tool: "show_gallery",
    description: "The same photos as thumbnails — tap for the lightbox.",
    reason:
      "When asked to see photos, a gallery, or pictures. Choose layout \"filmstrip\" "
      + "for a browsable strip with a lightbox.",
    note: "",
    sampleBlock: JSON.stringify({ type: "gallery", layout: "filmstrip", items: SAMPLE_PHOTOS }),
  },
  {
    key: "contact",
    label: "Contact form",
    tool: "show_contact_form",
    description: "The in-chat contact form, posted to /api/contact.",
    reason:
      "When someone wants to connect, reach out, get in touch, hire, or collaborate — "
      + "so they can leave their details. Then also mention the direct contact info "
      + "from HOW TO CONNECT.",
    note: "Live form — anything sent from here lands in Contacts like a real visitor message.",
    sampleBlock: JSON.stringify({ type: "contact" }),
  },
];

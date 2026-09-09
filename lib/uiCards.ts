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
 * There is no default set. Nothing is seeded at signup; a business's cards are
 * designed for it when onboarding finishes (lib/onboarding/cards.ts) and
 * added from the card builder after that. An empty catalog is an agent with
 * no cards, not an agent with someone else's.
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

export type UiCardInput = {
  id?: string;
  key: string;
  label: string;
  tool: string;
  description: string;
  reason: string;
  note: string;
  sampleBlock: string;
  order?: number;
};

/**
 * Write one row. A blank id creates. Returns the key the row ended up with —
 * derived from the label when blank, suffixed on collision — because a caller
 * that goes on to point a canned answer at a custom card needs the key that
 * was actually stored, not the one it asked for.
 */
export async function writeUiCard(
  userId: string,
  input: UiCardInput,
): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "The card needs a name." };
  const tool = CARD_TOOLS.includes(input.tool as CardTool) ? input.tool : null;
  if (!tool) return { ok: false, error: `Unknown tool "${input.tool}".` };

  const sampleBlock = input.sampleBlock.trim() || "{}";
  if (sampleBlock !== "{}" && !parseSampleBlock(sampleBlock)) {
    return {
      ok: false,
      error: "Sample block must be JSON with a \"type\" of: " + BLOCK_TYPES.join(", ") + ".",
    };
  }

  // The key anchors deep links and canned-answer attachments; a hand-typed one
  // is normalized rather than rejected, and a blank one is derived from the label.
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
    if (updated.count === 0) return { ok: false, error: "That card no longer exists." };
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
  return { ok: true, key };
}

/** Write one row from the admin form. Returns an error message, or null on success. */
export async function saveUiCard(userId: string, input: UiCardInput): Promise<string | null> {
  const result = await writeUiCard(userId, input);
  return result.ok ? null : result.error;
}

export async function deleteUiCard(userId: string, id: string) {
  await prisma.uiCard.deleteMany({ where: { id, userId } });
}

export type CardGuidance = { tool: string; reason: string; key: string };

/**
 * The catalog as the chatbot consumes it: which tools exist and when to use
 * them. An empty table is an empty list — there is no stock set to fall back
 * on, so an account with no cards offers the model no card tools and no card
 * guidance (lib/brain.ts and lib/knowledge.ts both handle that). A failed
 * read degrades the same way: a card-less answer beats a failed one.
 */
export async function cardCatalog(userId: string): Promise<CardGuidance[]> {
  try {
    return await prisma.uiCard.findMany({
      where: { userId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { tool: true, reason: true, key: true },
    });
  } catch {
    return [];
  }
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

/** A flat placeholder image, so sample cards need no uploads. */
export function swatch(label: string, bg: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">` +
    `<rect width="480" height="320" fill="${bg}"/>` +
    `<text x="240" y="172" text-anchor="middle" font-family="sans-serif" ` +
    `font-size="24" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

import type { CardTool } from "./canned.tools";
import type { UiBlock } from "./cards";

/**
 * Pure helpers over stored card samples — no database. Client components
 * (A2uiPanel, CardBuilder) import these; lib/uiCards.ts re-exports them for
 * the server side.
 */
export const BLOCK_TYPES = [
  "projects",
  "project",
  "gallery",
  "services",
  "menu",
  "cart",
  "contact",
  "custom",
  "html",
  "social",
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

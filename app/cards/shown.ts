/**
 * Pure helper deriving the wire `ShownCard[]` for a message's rendered cards
 * (see the composable-a2ui-elements contract, "Wire / card memory").
 * Client-safe: the only import is the `ShownCard` type from lib/brain.ts,
 * which the type-only `import type` erases at compile time — no server code
 * reaches the client bundle — so this still runs from app/Chat.tsx and from
 * a proof script alike. `ShownCard` itself lives in lib/brain.ts (the wire
 * type the contract defines it against) rather than being redefined here.
 *
 * Per card: gallery/projects -> ids of items (tags only for gallery, the
 * union across its items, capped); social -> ids = platforms. `title` is
 * carried through when present. Caps: 4 cards per message, 12 ids per card
 * (tags capped at 12 too).
 */

import type { ShownCard } from "@/lib/brain";

export type { ShownCard };

const MAX_CARDS = 4;
const MAX_IDS = 12;
const MAX_TAGS = 12;

type AnyCard = { type: string; [key: string]: unknown };

function idsFrom(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const it of items) {
    const id = it && typeof it === "object" ? (it as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id) ids.push(id);
  }
  return ids.slice(0, MAX_IDS);
}

function tagUnionFrom(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  for (const it of items) {
    const tags = it && typeof it === "object" ? (it as { tags?: unknown }).tags : undefined;
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      if (typeof t === "string" && t) seen.add(t);
      if (seen.size >= MAX_TAGS) break;
    }
    if (seen.size >= MAX_TAGS) break;
  }
  return Array.from(seen).slice(0, MAX_TAGS);
}

function shownForCard(c: AnyCard): ShownCard | null {
  const title = typeof c.title === "string" && c.title ? c.title : undefined;
  if (c.type === "gallery" || c.type === "projects") {
    const ids = idsFrom(c.items);
    const shown: ShownCard = { type: c.type };
    if (ids.length > 0) shown.ids = ids;
    if (c.type === "gallery") {
      const tags = tagUnionFrom(c.items);
      if (tags.length > 0) shown.tags = tags;
    }
    if (title) shown.title = title;
    return shown;
  }
  if (c.type === "social") {
    const items = Array.isArray(c.items) ? c.items : [];
    const ids = items
      .map((it) => (it && typeof it === "object" ? (it as { platform?: unknown }).platform : undefined))
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .slice(0, MAX_IDS);
    const shown: ShownCard = { type: "social" };
    if (ids.length > 0) shown.ids = ids;
    if (title) shown.title = title;
    return shown;
  }
  return null;
}

/** Derives the capped `ShownCard[]` wire payload for one message's `cards`. */
export function shownFromCards(cards: unknown): ShownCard[] {
  if (!Array.isArray(cards)) return [];
  const out: ShownCard[] = [];
  for (const raw of cards) {
    if (!raw || typeof raw !== "object" || typeof (raw as AnyCard).type !== "string") continue;
    const shown = shownForCard(raw as AnyCard);
    if (shown) out.push(shown);
    if (out.length >= MAX_CARDS) break;
  }
  return out;
}

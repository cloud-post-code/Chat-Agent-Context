import { str } from "@/lib/util/text";
import { prisma } from "@/lib/db";
import { parseSocialLinks, type SocialLink } from "@/lib/socialLinks";

/**
 * The social-links A2UI element: one small card of the business's own social
 * profiles, filterable to the platforms a visitor actually asked about
 * ("just Instagram") instead of always showing every link on file.
 *
 * Owns the block the way lib/menu.ts owns MenuBlock: lib/cards.ts re-exports
 * this type into UiBlock rather than redefining it. Reads Profile.social_links
 * through lib/socialLinks.ts, which already owns sanitizing and storing that
 * column — this module only filters and shapes what's already clean.
 */

export type SocialBlock = {
  type: "social";
  title?: string;
  items: { platform: string; url: string }[];
};

const MAX_TITLE = 80;

/** platform, however the model or a canned answer spelled it -> our canonical name. */
const ALIASES: Record<string, string> = {
  ig: "instagram",
  insta: "instagram",
  fb: "facebook",
  x: "twitter",
  yt: "youtube",
  li: "linkedin",
  tt: "tiktok",
};

/** Lowercase, trimmed, alias-resolved. Never throws; junk just passes through lowercased. */
export function normalizePlatform(p: string): string {
  const v = typeof p === "string" ? p.trim().toLowerCase() : "";
  return ALIASES[v] ?? v;
}

/**
 * `platforms` undefined or empty means "every link on file" — the same
 * empty-filter-is-everything rule as filterPhotos/filterServices. Otherwise
 * keep links whose normalized platform is in the normalized filter set, in
 * the links' own stored order.
 */
export function filterSocialLinks(links: SocialLink[], platforms?: string[]): SocialLink[] {
  if (!platforms || platforms.length === 0) return links;
  const wanted = new Set(platforms.map(normalizePlatform).filter(Boolean));
  if (wanted.size === 0) return links;
  return links.filter((l) => wanted.has(normalizePlatform(l.platform)));
}

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "instagram" + "facebook" -> "Instagram · Facebook"; no platforms named -> "Follow us". */
function defaultTitle(platforms: string[] | undefined, items: SocialLink[]): string {
  if (platforms && platforms.length) {
    const names = platforms.map(normalizePlatform).filter(Boolean).map(capitalize);
    if (names.length) return names.join(" · ");
  }
  return "Follow us";
}

/**
 * Load just the social_links column, never upserting: hasSocialLinks and
 * socialBlock both run concurrently with buildSystemPrompt's own getProfile
 * call (lib/brain.ts's runModel Promise.all), and getProfile is an upsert —
 * two concurrent upserts on a tenant with no Profile row yet race on the
 * unique userId constraint and one throws. A profile that doesn't exist yet
 * simply has no links (null -> []); the upsert elsewhere is what creates the
 * row, this read never needs to.
 */
async function socialLinksColumn(userId: string): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { social_links: true } });
  return profile?.social_links ?? "";
}

/**
 * Build the social card from this tenant's stored links, filtered by the
 * tool's input. `input.platforms` is a string array; anything else is
 * ignored (empty filter). `input.title` overrides the derived default, capped
 * at 80 chars. Null when the filter matches nothing — the caller (lib/cards.ts
 * via lib/brain.ts) turns that into a "no such platform" tool result instead
 * of an empty card.
 */
export async function socialBlock(
  userId: string,
  input: Record<string, unknown>,
): Promise<SocialBlock | null> {
  const links = parseSocialLinks(await socialLinksColumn(userId));
  const platforms = Array.isArray(input.platforms)
    ? input.platforms.filter((p): p is string => typeof p === "string")
    : undefined;
  const items = filterSocialLinks(links, platforms);
  if (items.length === 0) return null;
  const title = str(input.title, MAX_TITLE) || defaultTitle(platforms, items);
  return { type: "social", title, items };
}

/** Whether this tenant has any social links at all — gates show_social on data, not the catalog. */
export async function hasSocialLinks(userId: string): Promise<boolean> {
  return parseSocialLinks(await socialLinksColumn(userId)).length > 0;
}

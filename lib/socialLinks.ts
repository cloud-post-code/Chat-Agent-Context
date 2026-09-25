import { str } from "@/lib/util/text";
import { prisma } from "./db";

/**
 * The business's own social media profiles, stored on the Profile row as a
 * JSON array. Written by the onboarding social stage's review and the admin
 * Profile tab; read by the system prompt's HOW TO CONNECT block and the
 * profile indexer.
 */

export type SocialLink = { platform: string; url: string };

const MAX_LINKS = 12;

/** Clamp unknown input into a clean bounded list. Junk never throws. */
export function sanitizeSocialLinks(raw: unknown): SocialLink[] {
  if (!Array.isArray(raw)) {
    if (raw && typeof raw === "object" && Array.isArray((raw as { links?: unknown }).links)) {
      raw = (raw as { links: unknown[] }).links;
    } else {
      return [];
    }
  }
  const out: SocialLink[] = [];
  for (const l of (raw as unknown[]).slice(0, MAX_LINKS * 2)) {
    const link = (l ?? {}) as Record<string, unknown>;
    const url = str(link.url, 500);
    if (!/^https?:\/\//i.test(url)) continue;
    const platform = str(link.platform, 40).toLowerCase();
    if (out.some((o) => o.url === url)) continue;
    out.push({ platform, url });
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Stored JSON → SocialLink[]. Malformed storage reads as no links. */
export function parseSocialLinks(raw: string): SocialLink[] {
  try {
    return sanitizeSocialLinks(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Replace the profile's social links with the reviewed list. */
export async function saveSocialLinks(userId: string, links: SocialLink[]): Promise<void> {
  const social_links = JSON.stringify(sanitizeSocialLinks(links));
  await prisma.profile.upsert({
    where: { userId },
    update: { social_links },
    create: { userId, social_links },
  });
}

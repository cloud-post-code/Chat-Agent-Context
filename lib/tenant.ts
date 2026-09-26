import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * The tenant a public route addresses by slug, or null when the slug is
 * empty or unknown. Every public endpoint (chat, contact,
 * llms.txt, the agent page) resolves its tenant through this one lookup.
 */
export async function tenantBySlug(slug: unknown): Promise<User | null> {
  const s = typeof slug === "string" ? slug.trim() : "";
  return s ? prisma.user.findUnique({ where: { slug: s } }) : null;
}

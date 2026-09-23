import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { siteOrigin } from "@/lib/util";

/** The directory, every agent page, and every LLM-readable file. */

// The entries come from the database, which isn't reachable during `next
// build` (Railway builds without DATABASE_URL). Render per request instead of
// prerendering at build time, like the other DB-backed routes.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteOrigin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { slug: true, updatedAt: true },
  });
  const entries: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "daily", priority: 0.5 },
    { url: `${origin}/llms.txt`, changeFrequency: "daily", priority: 0.5 },
    { url: `${origin}/llms-full.txt`, changeFrequency: "daily", priority: 0.4 },
  ];
  for (const u of users) {
    const page = `${origin}/a/${u.slug}`;
    entries.push(
      { url: page, lastModified: u.updatedAt, changeFrequency: "weekly", priority: 1 },
      { url: `${page}/llms.txt`, lastModified: u.updatedAt, changeFrequency: "weekly", priority: 0.8 },
      { url: `${page}/llms-full.txt`, lastModified: u.updatedAt, changeFrequency: "weekly", priority: 0.8 },
    );
  }
  return entries;
}

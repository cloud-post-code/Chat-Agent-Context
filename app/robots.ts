import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/util";

/**
 * The AI assistants' crawlers and on-demand fetchers, named so an operator
 * reading the file sees they are welcome. `*` already allows them; the
 * explicit groups exist because some of these agents look for their own name
 * before trusting the wildcard, and because the intent is the point.
 */
export const AI_USER_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
] as const;

/** The owner-only surfaces. There is nothing to read there without a login. */
const PRIVATE_PATHS = ["/admin", "/api/admin", "/signup"];

export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      ...AI_USER_AGENTS.map((userAgent) => ({ userAgent, allow: "/", disallow: PRIVATE_PATHS })),
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}

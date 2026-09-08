import type { Page } from "./crawl";
import { llmExtract } from "./knowledgeLlm";
import { sanitizeSocialLinks, type SocialLink } from "@/lib/socialLinks";

/**
 * The dedicated social-media stage. Social profiles live in anchor hrefs —
 * usually icon-only links in the header or footer that page TEXT never
 * mentions — so this stage's model input is a list of the crawled pages'
 * offsite links (url | text | aria-label; attribute reads are data access,
 * like images.ts) and the model decides which are the business's own
 * profiles. Extraction is model-only; never invent: the sanitizer only
 * accepts URLs copied exactly from the candidate list.
 */

export const SOCIAL_SYSTEM_PROMPT = `You identify a business's own social media profiles among links found on its website. The input lists links from several pages; each page section is preceded by "=== <url>" and each link line reads: url | link text | aria-label.

Rules:
- Report ONLY links that literally appear in the input. Never guess, construct, or complete a URL — every "url" you output must be copied exactly from an input line.
- A social profile is the business's OWN page on a platform (Facebook, Instagram, X/Twitter, LinkedIn, YouTube, TikTok, Pinterest, Yelp, Threads, WhatsApp…). Skip share/intent links, other people's profiles, generic platform homepages, and app-store links.
- "platform" is the platform's common lowercase name (e.g. "instagram", "facebook", "x", "linkedin", "youtube", "tiktok").
- The same profile linked on several pages is ONE entry.
- No social profiles in the input? Return an empty list.

Respond with ONLY this JSON, no other text:
{"profiles":[{"platform":"","url":""}]}`;

const MAX_CANDIDATES = 120;

/**
 * Every offsite anchor on the crawled pages, deduped, as the model's corpus
 * plus the exact-url whitelist the sanitizer checks against. Collection is
 * discovery/data access; deciding which links are social stays with the model.
 */
export function socialCandidates(pages: Page[]): { corpus: string; urls: string[] } {
  let origin = "";
  try {
    origin = new URL(pages[0]?.url ?? "").origin;
  } catch {
    /* no valid base — every absolute link counts as offsite */
  }
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const page of pages) {
    const lines: string[] = [];
    page.$("a[href]").each((_, el) => {
      const href = page.$(el).attr("href") ?? "";
      let u: URL;
      try {
        u = new URL(href, page.url);
      } catch {
        return;
      }
      if ((u.protocol !== "https:" && u.protocol !== "http:") || u.origin === origin) return;
      u.hash = "";
      const url = u.toString();
      if (seen.has(url) || seen.size >= MAX_CANDIDATES) return;
      seen.add(url);
      const text = page.$(el).text().trim().slice(0, 80);
      const label = (page.$(el).attr("aria-label") ?? "").trim().slice(0, 80);
      lines.push(`${url} | ${text} | ${label}`);
    });
    if (lines.length) sections.push(`=== ${page.url}\n${lines.join("\n")}`);
  }
  return { corpus: sections.join("\n\n").slice(0, 30_000), urls: [...seen] };
}

/** Model output → clean SocialLink[]; only exact candidate URLs survive. */
function sanitize(raw: unknown, allowed: string[]): SocialLink[] {
  const profiles = (raw as { profiles?: unknown })?.profiles;
  return sanitizeSocialLinks(profiles).filter((l) => allowed.includes(l.url));
}

/** The business's own social profiles from the crawled pages. `extract` is
 *  injectable so proofs run offline; production always uses the model path. */
export async function extractSocialLinks(
  pages: Page[],
  log: (m: string) => void = () => {},
  extract: (
    system: string, text: string, maxTokens: number, log: (m: string) => void,
  ) => Promise<Record<string, unknown>> = llmExtract,
): Promise<SocialLink[]> {
  const { corpus, urls } = socialCandidates(pages);
  if (urls.length === 0) {
    log("No offsite links on your pages — nothing to check");
    return [];
  }
  log(`Checking ${urls.length} offsite link${urls.length === 1 ? "" : "s"} for social profiles`);
  const raw = await extract(SOCIAL_SYSTEM_PROMPT, corpus, 1000, log);
  return sanitize(raw, urls);
}

import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "@/lib/claude";
import type { Page } from "./crawl";
import { modelCall } from "./pool";

/**
 * The four knowledge-extraction system prompts. Each category runs its OWN
 * prompt so the model reads a page with one job at a time: blog posts,
 * testimonials, team bios, and a general catch-all that turns every other
 * page (services, pricing, policies, FAQs, locations…) into discrete facts.
 * Extraction is model-only: a failed call retries and then throws — there is
 * no deterministic parser to fall back to, and a missing key is an error.
 * Shared rule: never invent. Absent stays absent.
 */

export const BLOG_SYSTEM_PROMPT = `You clean one blog/news post from the raw text of its web page.

Rules:
- Report ONLY what the page states. Never invent an author, date, or content.
- "body" is the post's full content with navigation, related-post teasers, footers, and signup prompts removed. Keep the author's wording.
- If the text is not actually an article (a listing page, a category page, an error page), return {"post": null}.

Respond with ONLY this JSON, no other text:
{"post":{"title":"","author":"","date":"","body":""}}`;

export const TESTIMONIALS_SYSTEM_PROMPT = `You find genuine customer testimonials in text extracted from a business's website.

Rules:
- A testimonial is a customer's own quoted words WITH an attribution (a name, initials, or a name-and-title) that literally appears in the text. Marketing copy, press mentions, and unattributed praise do not count.
- Copy each quote as written. Never invent, merge, or embellish quotes or attributions.
- The same quote appearing twice is ONE testimonial.
- Nothing qualifying? Return an empty list.

Respond with ONLY this JSON, no other text:
{"testimonials":[{"quote":"","author":"","title":""}]}`;

export const TEAM_SYSTEM_PROMPT = `You find the people behind a business in text extracted from its website.

Rules:
- One entry per person the text actually introduces: a name plus whatever the text says about them (role, bio, experience). Copy from the text; never infer or pad a bio.
- Skip customers, quoted reviewers, and historical figures mentioned in passing.
- The same person described twice is ONE entry; keep the fuller description.
- Nobody introduced? Return an empty list.

Respond with ONLY this JSON, no other text:
{"people":[{"name":"","bio":""}]}`;

export const GENERAL_SYSTEM_PROMPT = `You distill one page of a business's website into discrete facts for the business's support agent to answer customers from.

Rules:
- Each fact is one self-contained statement a customer could ask about: a service and what it includes, a price, opening hours, an address, a policy, a guarantee, an FAQ answer, what the business is or does.
- Facts come ONLY from the text. Never invent, estimate, or generalize beyond what is written.
- Skip navigation labels, button text, cookie/legal boilerplate, and marketing slogans with no information in them.
- Also give the page a short "title" naming what it covers, from the page's own heading when present.
- A page with nothing substantive returns an empty facts list.

Respond with ONLY this JSON, no other text:
{"title":"","facts":[""]}`;

/** Body text of a page for a model corpus (scripts/styles stripped). */
export function llmPageText(page: Page): string {
  const clone = page.$("body").clone();
  clone.find("script, style, noscript").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

export function llmCorpus(pages: Page[], perPage = 3500, total = 40_000): string {
  return pages
    .map((p) => `=== ${p.url}\n${llmPageText(p).slice(0, perPage)}`)
    .join("\n\n")
    .slice(0, total);
}

/** Extra attempts after the first failed call before the stage errors out. */
const LLM_RETRIES = 2;

/**
 * One extraction call: system prompt + text in, parsed JSON out. A failed or
 * unparseable call retries up to LLM_RETRIES times and then throws — the job
 * surfaces the error rather than degrading to a parser or an empty result.
 * The call itself goes through the shared model gate (pool.ts): the extractors
 * run concurrently, so the gate bounds calls in flight and waits out a rate
 * limit before it ever counts against the retries here.
 */
export async function llmExtract(
  system: string,
  userText: string,
  maxTokens: number,
  log: (m: string) => void,
): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — onboarding extraction requires the model");
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await modelCall(() => claude().messages.create({
        model: claudeModel(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: userText }],
      }));
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const json = text.match(/\{[\s\S]*\}/)?.[0];
      if (!json) throw new Error("model returned no JSON");
      return JSON.parse(json) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 120) : String(err);
      if (attempt >= LLM_RETRIES) {
        throw new Error(`Model extraction failed after ${LLM_RETRIES + 1} attempts: ${msg}`);
      }
      log(`Model call failed (${msg}) — retrying`);
    }
  }
}

export type VisionMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
export type VisionImage = { bytes: Buffer; mediaType: VisionMediaType; label: string };

/**
 * One vision extraction call: system prompt + labeled images + closing text
 * in, parsed JSON out. Same failure policy as llmExtract — retry twice, then
 * throw. Each image is preceded by its label so the model can address images
 * by the index the label states.
 */
export async function llmExtractVision(
  system: string,
  images: VisionImage[],
  userText: string,
  maxTokens: number,
  log: (m: string) => void,
): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — onboarding extraction requires the model");
  }
  const content: Anthropic.ContentBlockParam[] = images.flatMap((im) => [
    { type: "text", text: im.label } as const,
    {
      type: "image",
      source: { type: "base64", media_type: im.mediaType, data: im.bytes.toString("base64") },
    } as const,
  ]);
  content.push({ type: "text", text: userText });
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await modelCall(() => claude().messages.create({
        model: claudeModel(),
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content }],
      }));
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const json = text.match(/\{[\s\S]*\}/)?.[0];
      if (!json) throw new Error("model returned no JSON");
      return JSON.parse(json) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 120) : String(err);
      if (attempt >= LLM_RETRIES) {
        throw new Error(`Model extraction failed after ${LLM_RETRIES + 1} attempts: ${msg}`);
      }
      log(`Model call failed (${msg}) — retrying`);
    }
  }
}

const str = (v: unknown, max = 4000): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export function sanitizePost(
  raw: Record<string, unknown> | null,
): { title: string; author: string; date: string; body: string } | null {
  const post = raw?.post;
  if (!post || typeof post !== "object") return null;
  const p = post as Record<string, unknown>;
  const title = str(p.title, 300);
  const body = str(p.body, 60_000);
  return title && body ? { title, author: str(p.author, 120), date: str(p.date, 40), body } : null;
}

export function sanitizeTestimonials(
  raw: Record<string, unknown> | null,
): { quote: string; author: string; title: string }[] | null {
  if (!raw || !Array.isArray(raw.testimonials)) return null;
  const out: { quote: string; author: string; title: string }[] = [];
  for (const t of raw.testimonials.slice(0, 100)) {
    const item = (t ?? {}) as Record<string, unknown>;
    const quote = str(item.quote);
    const author = str(item.author, 120);
    if (quote && author) out.push({ quote, author, title: str(item.title, 160) });
  }
  return out;
}

export function sanitizePeople(
  raw: Record<string, unknown> | null,
): { name: string; bio: string }[] | null {
  if (!raw || !Array.isArray(raw.people)) return null;
  const out: { name: string; bio: string }[] = [];
  for (const p of raw.people.slice(0, 100)) {
    const item = (p ?? {}) as Record<string, unknown>;
    const name = str(item.name, 120);
    const bio = str(item.bio);
    if (name && bio) out.push({ name, bio });
  }
  return out;
}

export function sanitizeFacts(
  raw: Record<string, unknown> | null,
): { title: string; facts: string[] } | null {
  if (!raw || !Array.isArray(raw.facts)) return null;
  const facts = raw.facts.map((f) => str(f, 1500)).filter(Boolean).slice(0, 60);
  return { title: str(raw.title, 200), facts };
}

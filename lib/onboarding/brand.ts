import { str } from "@/lib/util/text";
import type { Page } from "./crawl";
import { llmCorpus, llmExtract } from "./knowledgeLlm";

/**
 * Brand-identity extraction: tagline, brand values, and tone of voice from
 * the already-crawled pages. Model-only, grounded in the site's own text —
 * absent stays empty. The one generative allowance is the tagline: when the
 * site states none, the model may write one from the site's own copy, and
 * that tagline is FLAGGED "suggested" so the UI never presents it as
 * extracted. The sanitizer enforces the flag's honesty: a tagline whose
 * source the model didn't clearly mark "extracted" is treated as suggested.
 */

export type BrandIdentity = {
  tagline: string;
  taglineSource: "extracted" | "suggested" | "";
  values: string[];
  tone: string;
};

export const BRAND_SYSTEM_PROMPT = `You extract a business's brand identity from text taken from its website. The text contains multiple pages, each preceded by "=== <url>".

Rules:
- Ground everything in the text. Never invent facts about the business.
- "tagline": if the text literally states a tagline or slogan (a short motto the site presents as its own — in a hero heading, beside the name, or repeated as a signature line), copy it as written and set "tagline_source" to "extracted". If none is stated, write ONE short tagline built only from what the text says the business does, and set "tagline_source" to "suggested". If the text gives you nothing to build from, both stay "".
- "values": 3 to 5 short phrases (2–5 words each) naming what the business presents as its values, drawn from about/mission/story copy. Fewer when the text supports fewer; [] when it supports none. Never pad with generic values the text doesn't express.
- "tone": 1–3 sentences describing the site's writing style — tone, formality, vocabulary — phrased as a style instruction an assistant could follow (e.g. "Warm and conversational; short sentences; avoids jargon."). "" when there is too little prose to judge.

Respond with ONLY this JSON, no other text:
{"tagline":"","tagline_source":"","values":[],"tone":""}`;

/** Brand identity from the crawled pages. `extract` is injectable so proofs
 *  run offline; production always uses the real model path. */
export async function extractBrandIdentity(
  pages: Page[],
  log: (m: string) => void = () => {},
  extract: (
    system: string, text: string, maxTokens: number, log: (m: string) => void,
  ) => Promise<Record<string, unknown>> = llmExtract,
): Promise<BrandIdentity> {
  const raw = await extract(BRAND_SYSTEM_PROMPT, llmCorpus(pages), 700, log);

  const tagline = str(raw.tagline, 200);
  const values = (Array.isArray(raw.values) ? raw.values : [])
    .map((v) => str(v, 120))
    .filter(Boolean)
    .slice(0, 5);
  // The honesty rule: only the model's explicit "extracted" keeps that flag;
  // anything else on a non-empty tagline is presented as suggested.
  const taglineSource: BrandIdentity["taglineSource"] =
    !tagline ? "" : raw.tagline_source === "extracted" ? "extracted" : "suggested";

  return { tagline, taglineSource, values, tone: str(raw.tone, 600) };
}

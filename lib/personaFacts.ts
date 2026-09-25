import { slugify } from "@/lib/util/text";
import { textOf } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "./claude";

/**
 * ── PERSONA → KNOWLEDGE ENTRIES ───────────────────────────────────────
 *
 * The persona is one paragraph of prose, but it makes many separate claims:
 * what Blake builds, how he decides, what he distrusts, how he sounds. Indexed
 * whole it is a single blob that has to win a retrieval slot on the average of
 * everything it says. Split into one entry per claim, each is indexed on its
 * own — its own chunk, its own embedding, its own entity extraction — so a
 * question about one thing matches the sentence about that thing, and the
 * graph gets per-claim provenance instead of one edge owner called "Persona".
 *
 * This never changes what the chatbot is told about itself: the full paragraph
 * still ships verbatim in the always-on PERSONA block (lib/knowledge.ts). These
 * entries only affect what is retrievable and what the graph knows.
 *
 * Failure is always a downgrade, never an error: no key, a refusal, malformed
 * JSON, or a paragraph too short to split all return `[]`, and the caller
 * indexes the paragraph whole exactly as it did before this existed.
 */

export type PersonaFact = {
  /** Stable, filename-safe id fragment derived from `topic`. */
  slug: string;
  /** 2-5 words, used as the retrieval citation label. */
  topic: string;
  /** The claim, self-contained enough to read on its own. */
  text: string;
};

/**
 * The narrow slice of the SDK this module uses, so a proof can inject a fake
 * and count calls at the provider boundary instead of reaching the network.
 */
type FactClient = {
  messages: {
    create(
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<{ content: unknown[] }>;
  };
};

export type FactDeps = { client?: FactClient };

/**
 * Hard cap on entries. Every entry costs one embedding request and one Claude
 * entity-extraction call on *every* persona save, and 21s of pacing in a full
 * `scripts/reindex.ts --all` run — so this is a spend limit, not a style rule.
 */
export const MAX_FACTS = 8;

/**
 * Below this the paragraph is a single thought. Splitting it would spend calls
 * to produce fragments shorter than the context they came from.
 */
export const MIN_SPLIT_CHARS = 200;

const BRIEF =
  `Below is the persona paragraph from a personal website — how its owner ` +
  `describes himself. Break it into the distinct claims it actually makes, so ` +
  `each can be indexed and retrieved on its own.\n\n` +
  `Return STRICT JSON: {"facts": [{"topic", "text"}]}.\n` +
  `- "topic": 2-5 words naming what the claim is about ("how he decides", ` +
  `"tools he uses"). This is shown to the model as a citation label.\n` +
  `- "text": the claim in one or two sentences. It MUST read on its own with ` +
  `no surrounding context — resolve every pronoun to a name or a noun, because ` +
  `this sentence will be retrieved alone, without the rest of the paragraph.\n` +
  `- One distinct claim per entry. Do not split a single claim across entries, ` +
  `and do not merge unrelated ones.\n` +
  `- Use ONLY what the paragraph states. Infer nothing, add nothing, and drop ` +
  `anything you cannot support from the text.\n` +
  `- At most ${MAX_FACTS} entries. Fewer is fine.\n` +
  `Return ONLY the JSON object, no prose or fences.`;

/**
 * Coerce whatever came back into usable entries. Never trusts the shape: the
 * model can return a bare array, missing keys, numbers for strings, duplicate
 * topics, or more entries than asked for.
 */
export function sanitizeFacts(json: unknown): PersonaFact[] {
  const raw = Array.isArray(json)
    ? json
    : Array.isArray((json as { facts?: unknown })?.facts)
      ? ((json as { facts: unknown[] }).facts)
      : [];

  const seen = new Set<string>();
  const out: PersonaFact[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    const topic = String(r?.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const text = String(r?.text ?? "").replace(/\s+/g, " ").trim();
    const slug = slugify(topic, 48);
    // A slug is the storage id, so an unusable topic drops the entry outright
    // rather than getting a positional fallback that shifts on the next save.
    if (!slug || text.length < 10 || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, topic, text });
    if (out.length >= MAX_FACTS) break;
  }
  return out;
}

/**
 * Split the persona paragraph into indexable entries. Returns `[]` whenever
 * splitting isn't possible or isn't worth it — the caller treats that as
 * "index the paragraph whole".
 */
export async function splitPersonaFacts(
  prose: string,
  deps: FactDeps = {},
): Promise<PersonaFact[]> {
  const text = prose.replace(/\r/g, "").trim();
  if (text.length < MIN_SPLIT_CHARS) return [];
  // Check the env directly rather than letting claude() throw: no key is a
  // supported configuration here, not a failure worth logging on every save.
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return [];

  try {
    const client = deps.client ?? claude();
    const msg = await client.messages.create({
      model: claudeModel(),
      max_tokens: 2000,
      messages: [{ role: "user", content: `${BRIEF}\n\nPERSONA:\n${text.slice(0, 12000)}` }],
    });
    const out = textOf(msg.content);
    if (!out) return [];
    return sanitizeFacts(JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)));
  } catch {
    return [];
  }
}

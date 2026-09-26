import Anthropic from "@anthropic-ai/sdk";

/**
 * Thin wrapper around the Anthropic SDK. All Claude calls (chatbot + link
 * summarizer) go through here so the model + key are configured once.
 */

let client: Anthropic | null = null;

export function claude(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
}

/**
 * The model for the admin's ingestion-source builder only. Split from
 * CLAUDE_MODEL because the two workloads want different trade-offs: the
 * chatbot answers every visitor message (cost matters, Haiku fits), while the
 * builder is a rare, admin-only design task where quality beats the extra
 * cents. Falls back to the chatbot's model when unset. CARD_BUILDER_MODEL is
 * the variable's old name, still honoured so an existing deploy keeps working.
 */
export function builderModel(): string {
  return process.env.BUILDER_MODEL || process.env.CARD_BUILDER_MODEL || claudeModel();
}

/** The text of a response's content blocks, joined; non-text blocks contribute nothing. */
export function textOf(content: unknown[]): string {
  return content
    .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
    .join("");
}

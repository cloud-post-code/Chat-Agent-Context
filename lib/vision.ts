import { capTags } from "@/lib/util/text";
import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "./claude";

/**
 * Uses Claude vision to write a one-paragraph description of an uploaded photo.
 * Returns "" on any failure so the upload still succeeds and the admin can
 * write the description manually.
 */

const MEDIA: Record<string, "image/jpeg" | "image/png" | "image/webp" | "image/gif"> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Description plus facets, for a photo the gallery filter can later address
 * by tag: subject, colors, style, service words a visitor might type
 * ("red", "nails", "gel", "storefront"). Asks the model for both in one
 * JSON reply so a single vision call covers upload, onboarding, and the
 * backfill script alike. On any failure — the API call, or a reply that
 * isn't the expected JSON shape — falls back to describeImage's plain
 * paragraph and an empty tag list, so the upload still succeeds.
 */
export async function describeAndTagImage(
  bytes: Buffer,
  ext: string,
): Promise<{ description: string; tags: string[] }> {
  const mediaType = MEDIA[ext.toLowerCase()] ?? "image/jpeg";
  try {
    const msg = await claude().messages.create({
      model: claudeModel(),
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: bytes.toString("base64") },
            },
            {
              type: "text",
              text:
                "Write ONE natural paragraph (2-4 sentences) describing this photo for a "
                + "personal website gallery. Describe what's visibly in it — subject, "
                + "setting, mood. Do not invent names, places, or facts you can't see. "
                + "Then pick 3-8 short lowercase words a visitor might search for: the "
                + "subject, dominant colors, visual style, and any service or product "
                + "words it shows.\n\nRespond with ONLY this JSON, no other text: "
                + '{"description":"","tags":["word1","word2"]}',
            },
          ],
        },
      ],
    });
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : null;
    const description = typeof parsed?.description === "string" ? parsed.description.trim() : "";
    if (!description) return { description: text, tags: [] };
    return { description, tags: capTags(parsed?.tags) };
  } catch {
    return { description: "", tags: [] };
  }
}

export async function describeImage(
  bytes: Buffer,
  ext: string,
): Promise<string> {
  const mediaType = MEDIA[ext.toLowerCase()] ?? "image/jpeg";
  try {
    const msg = await claude().messages.create({
      model: claudeModel(),
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: bytes.toString("base64"),
              },
            },
            {
              type: "text",
              text:
                "Write ONE natural paragraph (2-4 sentences) describing this photo " +
                "for a personal website gallery. Describe what's visibly in it — " +
                "subject, setting, mood. Do not invent names, places, or facts you " +
                "can't see. Plain prose, no preamble.",
            },
          ],
        },
      ],
    });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { personaExtractionPrompt } from "@/lib/personaPrompt";
import { PersonaPrompt } from "@/app/admin/PersonaPrompt";

// Converted from docs/features/persona-prompt-handoff/proof.ts.
const DEEP_MARKER = "Choose exactly three words that describe me";
const raw = readFileSync(path.resolve(__dirname, "../../docs/prompts/persona-extraction.md"), "utf8");

describe("persona extraction prompt", () => {
  it("serves the whole prompt file, cached", () => {
    expect(raw.trimStart().startsWith("# Personal Persona Extraction Prompt")).toBe(true);
    expect(raw).toContain(DEEP_MARKER);
    const prompt = personaExtractionPrompt();
    expect(prompt).toBe(raw.trim());
    expect(personaExtractionPrompt()).toBe(prompt);
  });
  it("renders collapsed with copy/view buttons and no prompt body", () => {
    const html = renderToStaticMarkup(<PersonaPrompt prompt={personaExtractionPrompt()} />);
    expect(html).toMatch(/ChatGPT, Claude or Gemini/);
    expect(html).toContain("Copy prompt");
    expect(html).toContain("View prompt");
    expect(html).not.toContain(DEEP_MARKER);
  });
});

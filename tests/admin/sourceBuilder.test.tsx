import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { draftIngestionSource } from "@/lib/ingestionBuilder";
import { SourceBuilder } from "@/app/admin/SourceBuilder";

// Converted from docs/features/source-builder-chat/proof.ts. The model is
// doubled at the client boundary; nothing here calls Anthropic.
const fakeClient = (text: string) =>
  ({ messages: { create: async () => ({ content: [{ type: "text", text }] }) } }) as never;
const turn = [{ role: "user" as const, content: "A tab for press mentions" }];

describe("draftIngestionSource", () => {
  it("turns valid JSON into a validated draft", async () => {
    const out = await draftIngestionSource(turn, null, {
      client: fakeClient(JSON.stringify({
        reply: "Here's a press-mentions source.",
        draft: {
          label: "Press mentions", key: "press-mentions", description: "Articles about Blake",
          systemPrompt: "Summarize what each mention says about Blake.",
          uploadMethod: "generic", storageKinds: "text+image", outputMethod: "Source/Photo rows",
        },
      })),
    });
    expect(out).toMatchObject({ reply: "Here's a press-mentions source.", draft: { label: "Press mentions", storageKinds: "text+image" } });
  });
  it("coerces out-of-vocabulary fields to safe defaults", async () => {
    const out = await draftIngestionSource(turn, null, {
      client: fakeClient(JSON.stringify({ reply: "ok", draft: { label: "Weird", uploadMethod: "carrier-pigeon", storageKinds: "vibes" } })),
    });
    expect(out).toMatchObject({ draft: { uploadMethod: "generic", storageKinds: "text" } });
  });
  it("degrades non-JSON to a plain reply and drops a label-less draft", async () => {
    const plain = await draftIngestionSource(turn, null, { client: fakeClient("Tell me more about what you want to ingest.") });
    expect(plain).toMatchObject({ draft: null });
    expect((plain as { reply: string }).reply).toContain("Tell me more");
    const unlabeled = await draftIngestionSource(turn, null, { client: fakeClient(JSON.stringify({ reply: "hm", draft: { label: "" } })) });
    expect(unlabeled).toMatchObject({ draft: null });
  });
});

describe("SourceBuilder", () => {
  it("renders the chat and test panes with the empty-state notice", () => {
    const html = renderToStaticMarkup(<SourceBuilder />);
    expect(html).toContain("Builder chat");
    expect(html).toContain("Test page");
    expect(html).toContain("Test mode");
    expect(html).toContain("Describe the ingestion source");
  });
});

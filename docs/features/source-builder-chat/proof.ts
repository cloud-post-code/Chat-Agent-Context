/**
 * Primary proof for source-builder-chat (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/source-builder-chat/proof.ts
 *
 * Fully offline: fake builder client, static rendering, source greps.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fakeClient = (text: string) => ({
  messages: {
    create: async () => ({ content: [{ type: "text", text }] }),
  },
});

async function main() {
  const { draftIngestionSource } = await import("@/lib/ingestionBuilder");
  const { SourceBuilder } = await import("../../../app/admin/SourceBuilder");

  // 1. Valid JSON → validated draft.
  const good = await draftIngestionSource(
    [{ role: "user", content: "A tab for press mentions" }],
    null,
    {
      client: fakeClient(
        JSON.stringify({
          reply: "Here's a press-mentions source.",
          draft: {
            label: "Press mentions",
            key: "press-mentions",
            description: "Articles about Blake",
            systemPrompt: "Summarize what each mention says about Blake.",
            uploadMethod: "generic",
            storageKinds: "text+image",
            outputMethod: "Source/Photo rows, unified items",
          },
        }),
      ),
    },
  );
  check(
    "valid JSON turn yields reply + validated draft",
    !("error" in good) &&
      good.reply === "Here's a press-mentions source." &&
      good.draft?.label === "Press mentions" &&
      good.draft?.storageKinds === "text+image" &&
      good.draft?.systemPrompt.includes("mention"),
    JSON.stringify(good),
  );

  // 2. Out-of-vocab fields coerce to safe defaults.
  const coerced = await draftIngestionSource([{ role: "user", content: "x" }], null, {
    client: fakeClient(
      JSON.stringify({
        reply: "ok",
        draft: { label: "Weird", uploadMethod: "carrier-pigeon", storageKinds: "vibes" },
      }),
    ),
  });
  check(
    "out-of-vocab uploadMethod/storageKinds coerce to generic/text",
    !("error" in coerced) &&
      coerced.draft?.uploadMethod === "generic" &&
      coerced.draft?.storageKinds === "text",
    JSON.stringify(coerced),
  );

  // 3. Non-JSON degrades to a plain reply.
  const plain = await draftIngestionSource([{ role: "user", content: "x" }], null, {
    client: fakeClient("Tell me more about what you want to ingest."),
  });
  check(
    "non-JSON output becomes the reply with no draft",
    !("error" in plain) && plain.draft === null && plain.reply.includes("Tell me more"),
    JSON.stringify(plain),
  );

  // 4. No label → no draft.
  const unlabeled = await draftIngestionSource([{ role: "user", content: "x" }], null, {
    client: fakeClient(JSON.stringify({ reply: "hm", draft: { label: "" } })),
  });
  check("a draft without a label is no draft", !("error" in unlabeled) && unlabeled.draft === null);

  // 5. The split page renders both panes.
  const html = renderToStaticMarkup(h(SourceBuilder, {}));
  check("builder chat pane renders", html.includes("Builder chat"));
  check("sample test pane renders", html.includes("Test page"));
  check("test-mode notice present", html.includes("Test mode"));
  check(
    "no-draft placeholder shows before any turn",
    html.includes("Describe the ingestion source"),
  );

  // 6. Test-only: no real ingest actions in the builder.
  const src = readFileSync(path.join(root, "app/admin/SourceBuilder.tsx"), "utf8");
  check(
    "builder never imports the real ingest actions",
    !src.includes("ingestCustomTextAction") && !src.includes("ingestCustomImageAction"),
  );
  check("test forms are handled locally", src.includes("onSubmit"));
  check("persistence goes through saveBuiltSourceAction", src.includes("saveBuiltSourceAction"));

  // 7. Wiring.
  const page = readFileSync(path.join(root, "app/admin/NewSourcePanel.tsx"), "utf8");
  check("new-source page renders SourceBuilder", page.includes("SourceBuilder"));
  check("manual fallback form kept", page.includes("createIngestionSourceAction"));
  const route = readFileSync(path.join(root, "app/api/admin/build-source/route.ts"), "utf8");
  check("route is auth-gated before model calls", route.includes("isAuthed") && route.includes("401"));
  const actions = readFileSync(path.join(root, "app/admin/actions/ingestion.ts"), "utf8");
  check(
    "saveBuiltSourceAction wraps saveIngestionSource",
    /saveBuiltSourceAction[\s\S]{0,500}saveIngestionSource/.test(actions),
  );
  check(
    "builder save lands on the new source's own tab",
    /saveBuiltSourceAction[\s\S]{0,1200}key/.test(actions) && src.includes("?tab=${"),
  );

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

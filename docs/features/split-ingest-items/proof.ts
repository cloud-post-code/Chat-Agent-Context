/**
 * Primary proof for split-ingest-items (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/split-ingest-items/proof.ts
 *
 * Local dev Postgres; zero model calls. `proof-sii-` markers, finally cleanup.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const KEY = "proof-sii-src";

/** A fake split client that records the system prompt it was sent. */
function fakeSplitClient(payload: string | (() => string)) {
  const seen: { system: string } = { system: "" };
  const client = {
    messages: {
      create: async (req: { system: string }) => {
        seen.system = req.system;
        const text = typeof payload === "function" ? payload() : payload;
        return { content: [{ type: "text", text }] };
      },
    },
  };
  return { client, seen };
}

const items3 = JSON.stringify([
  { title: "Initiative Alpha", text: "Alpha does A. Owner: Ana. Status: shipping." },
  { title: "Initiative Beta", text: "Beta does B. Owner: Bo. Status: blocked." },
  { title: "Initiative Gamma", text: "Gamma does C. Owner: Gil. Status: planned." },
]);

async function main() {
  const {
    splitIntoItems,
    MAX_SPLIT_ITEMS,
    ingestCustomFile,
    ingestCustomUrl,
    ingestCustomText,
  } = await import("@/lib/customIngest");
  const { saveIngestionSource } = await import("@/lib/ingestionSources");
  const { listIngestedItems } = await import("@/lib/ingestedItems");
  const { prisma } = await import("@/lib/db");

  const fakeDoc = async (_b: Buffer, filename: string) => ({
    title: filename, rawText: "sixteen pages of initiatives", summary: `DOC:${filename}`, tags: [],
  });
  const fakeLink = async (url: string) => ({
    title: `Linked ${url}`, rawText: "page text", summary: `SUM:${url}`, tags: [],
  });
  const fakeText = async (text: string, title: string | null) => ({
    title: title ?? "note", rawText: text, summary: `SUMMARY:${text}`, tags: [],
  });

  // 1. Parser: valid array, junk dropped, capped.
  {
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({ title: `T${i}`, text: `body ${i}` })).concat([
        { title: "", text: "" } as never,
        { nope: true } as never,
      ]),
    );
    const { client } = fakeSplitClient(many);
    const parsed = await splitIntoItems("raw", "lens", client);
    check(
      "parser caps items and drops invalid entries",
      parsed !== null && parsed.length === MAX_SPLIT_ITEMS && parsed.every((i) => i.title && i.text),
      String(parsed?.length),
    );
  }

  // 1b. A reply truncated mid-array (max_tokens cutoff) salvages the
  // complete items instead of discarding the whole split.
  {
    const truncated = JSON.stringify([
      { title: "Whole One", text: "complete item one" },
      { title: "Whole Two", text: "complete item two" },
    ]).slice(0, -1) + ',{"title":"Cut Off","text":"this item never fini';
    const { client } = fakeSplitClient(truncated);
    const salvaged = await splitIntoItems("raw", "lens", client);
    check(
      "truncated array salvages the complete items",
      salvaged !== null && salvaged.length === 2 && salvaged[1].title === "Whole Two",
      JSON.stringify(salvaged),
    );
  }

  // 2. The source prompt is the lens; empty prompt gets the default lens.
  {
    const a = fakeSplitClient(items3);
    await splitIntoItems("raw", "ONE-INITIATIVE-PER-ITEM", a.client);
    check("source systemPrompt reaches the splitter", a.seen.system.includes("ONE-INITIATIVE-PER-ITEM"));
    const b = fakeSplitClient(items3);
    await splitIntoItems("raw", "", b.client);
    check("empty prompt falls back to the default lens", b.seen.system.includes("self-contained"));
  }

  try {
    await saveIngestionSource({
      key: KEY, label: "Proof SII", description: "", systemPrompt: "one initiative per item",
      uploadMethod: "file", storageKinds: "text", outputMethod: "unified items",
    });

    // 3. File ingest splits into 3 rows, no parent blob.
    {
      const { client } = fakeSplitClient(items3);
      const e = await ingestCustomFile(KEY, Buffer.from("x"), "proof-sii-brief.pdf", fakeDoc, client);
      check("split file ingest succeeds", e === null, String(e));
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("three item rows, no parent blob row",
        rows.length === 3 && !rows.some((r) => r.summary === "DOC:proof-sii-brief.pdf"),
        JSON.stringify(rows.map((r) => r.title)));
      const items = await listIngestedItems(KEY);
      check("items list the three initiatives uniformly",
        items.filter((i) => i.kind === "text").length === 3 &&
          items.some((i) => i.title === "Initiative Beta"));
      check("items carry the parent doc provenance tag",
        rows.every((r) => (r.tags ?? "").includes("doc:proof-sii-brief.pdf")));
      await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } });
    }

    // 4. Split failure → single-row fallback, upload never lost.
    for (const [label, bad] of [
      ["throwing client", { messages: { create: async () => { throw new Error("boom"); } } }],
      ["garbage JSON", fakeSplitClient("not json at all").client],
    ] as const) {
      const e = await ingestCustomFile(KEY, Buffer.from("x"), "proof-sii-fallback.pdf", fakeDoc, bad);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check(`${label} falls back to one summarized row`,
        e === null && rows.length === 1 && rows[0].summary === "DOC:proof-sii-fallback.pdf",
        JSON.stringify(rows.map((r) => r.title)));
      await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } });
    }

    // 5. A 1-item split also falls back (no churn on short notes).
    {
      const { client } = fakeSplitClient(JSON.stringify([{ title: "Only", text: "one point" }]));
      await ingestCustomFile(KEY, Buffer.from("x"), "proof-sii-one.pdf", fakeDoc, client);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("single-item split keeps the plain document row",
        rows.length === 1 && rows[0].summary === "DOC:proof-sii-one.pdf");
      await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } });
    }

    // 6. URL re-scan replaces its items.
    {
      const url = "https://example.com/proof-sii";
      const first = fakeSplitClient(JSON.stringify([
        { title: "Old One", text: "o1" }, { title: "Old Two", text: "o2" },
      ]));
      check("first url scan ok", (await ingestCustomUrl(KEY, url, fakeLink, first.client)) === null);
      const second = fakeSplitClient(JSON.stringify([
        { title: "New One", text: "n1" }, { title: "New Two", text: "n2" },
      ]));
      check("re-scan ok", (await ingestCustomUrl(KEY, url, fakeLink, second.client)) === null);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("re-scan replaced the url's items (2, all new, no url blob row)",
        rows.length === 2 && rows.every((r) => r.title?.startsWith("New")) && !rows.some((r) => r.url === url),
        JSON.stringify(rows.map((r) => r.title)));
      // A sibling page whose URL merely EXTENDS this one must survive the
      // re-scan — the tag match is exact, not a substring prefix.
      const sibling = fakeSplitClient(JSON.stringify([
        { title: "Sib One", text: "s1" }, { title: "Sib Two", text: "s2" },
      ]));
      check("sibling page scan ok", (await ingestCustomUrl(KEY, `${url}/2`, fakeLink, sibling.client)) === null);
      const rescan = fakeSplitClient(JSON.stringify([
        { title: "New A", text: "a" }, { title: "New B", text: "b" },
      ]));
      check("parent re-scan ok", (await ingestCustomUrl(KEY, url, fakeLink, rescan.client)) === null);
      const after = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("sibling page's items survive the parent's re-scan",
        after.filter((r) => r.title?.startsWith("Sib")).length === 2 &&
          after.filter((r) => r.title?.startsWith("New ")).length === 2,
        JSON.stringify(after.map((r) => r.title)));
      await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } });
    }

    // 7. Pasted text splits through the same pass.
    {
      const { client } = fakeSplitClient(items3);
      const e = await ingestCustomText(KEY, { title: "notes", text: "three things" }, fakeText, client);
      const rows = await prisma.source.findMany({ where: { kind: `ingest:${KEY}` } });
      check("pasted text splits into three rows", e === null && rows.length === 3);
    }
  } finally {
    await prisma.source.deleteMany({ where: { kind: `ingest:${KEY}` } }).catch(() => {});
    await prisma.ingestionSource.deleteMany({ where: { key: { startsWith: "proof-sii" } } }).catch(() => {});
    await prisma.$disconnect();
  }

  // 8. Builder prompt teaches the lens.
  const builder = readFileSync(path.join(root, "lib/ingestionBuilder.ts"), "utf8");
  check("builder prompt says splitting is automatic; prompt describes one item",
    /split/i.test(builder) && /one item/i.test(builder));

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

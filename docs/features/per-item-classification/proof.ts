/**
 * Primary proof for per-item-classification (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/per-item-classification/proof.ts
 */
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

/** A source defaulting to Public, and one defaulting to Personal. */
const PUB = "proof-pic-public";
const PERS = "proof-pic-personal";

const fakeExtract = async (text: string, title?: string | null) => ({
  title: title ?? "note",
  rawText: text,
  summary: `S:${text}`,
  tags: [],
});
const noSplit = {
  messages: { create: async () => ({ content: [{ type: "text", text: "[]" }] }) },
};
/** A splitter that always returns three items, to prove split inheritance. */
const splitsThree = {
  messages: {
    create: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            { title: "part one", text: "First discrete point about the thing." },
            { title: "part two", text: "Second discrete point about the thing." },
            { title: "part three", text: "Third discrete point about the thing." },
          ]),
        },
      ],
    }),
  },
};

async function main() {
  const { ingestCustomText, deleteIngestedItem } = await import("@/lib/customIngest");
  const { saveIngestionSource, ENABLED_CLASSIFICATIONS, CLASSIFICATIONS } = await import(
    "@/lib/ingestionSources"
  );
  const { listIngestedItemsClassified, deleteIngestedData } = await import(
    "@/lib/ingestedItems"
  );
  const {
    resolveClassification,
    setItemClassification,
    sourceDefaultClassification,
  } = await import("@/lib/itemClassification");
  const { GenericIngestPanel } = await import("@/app/admin/GenericIngestPanel");
  const { prisma } = await import("@/lib/db");

  try {
    // ── 0. All four tiers are selectable ────────────────────────────────
    check(
      "all four classifications enabled",
      ENABLED_CLASSIFICATIONS.length === 4 &&
        CLASSIFICATIONS.every((c) => (ENABLED_CLASSIFICATIONS as readonly string[]).includes(c)),
      `enabled: ${ENABLED_CLASSIFICATIONS.join(", ")}`,
    );

    // A non-public source classification now saves rather than being refused.
    const err = await saveIngestionSource({
      key: PERS,
      label: "Proof PIC personal",
      description: "",
      systemPrompt: "",
      uploadMethod: "generic",
      storageKinds: "text+image",
      outputMethod: "x",
      classification: "personal",
      splitMode: "single",
    });
    check("a non-public source classification saves", err === null, String(err));
    check(
      "source default reads back as personal",
      (await sourceDefaultClassification(PERS)) === "personal",
    );

    await saveIngestionSource({
      key: PUB,
      label: "Proof PIC public",
      description: "",
      systemPrompt: "",
      uploadMethod: "generic",
      storageKinds: "text+image",
      outputMethod: "x",
      classification: "public",
      splitMode: "single",
    });

    // ── 1. No override → inherits the source's classification ───────────
    await ingestCustomText(PUB, { title: "pic inherit", text: "hello" }, fakeExtract, noSplit);
    let items = await listIngestedItemsClassified(PUB);
    check("ingest with no choice produced one item", items.length === 1, `${items.length}`);
    check(
      "inherits the source default (public)",
      items[0]?.classification === "public" && items[0]?.classificationOverridden === false,
      `${items[0]?.classification} overridden=${items[0]?.classificationOverridden}`,
    );

    // Inheritance is LIVE, not copied: re-classifying the source moves it.
    await saveIngestionSource({
      id: (await prisma.ingestionSource.findUnique({ where: { key: PUB } }))!.id,
      key: PUB,
      label: "Proof PIC public",
      description: "",
      systemPrompt: "",
      uploadMethod: "generic",
      storageKinds: "text+image",
      outputMethod: "x",
      classification: "close-friends",
      splitMode: "single",
    });
    items = await listIngestedItemsClassified(PUB);
    check(
      "re-classifying the source moves its un-overridden items",
      items[0]?.classification === "close-friends" && !items[0]?.classificationOverridden,
      `${items[0]?.classification}`,
    );
    const inheritedId = items[0]!.id;

    // ── 2. An ingest-time choice overrides the source default ───────────
    await ingestCustomText(
      PUB,
      { title: "pic override", text: "secret", classification: "personal" },
      fakeExtract,
      noSplit,
    );
    items = await listIngestedItemsClassified(PUB);
    const overridden = items.find((i) => i.title === "pic override");
    check(
      "an ingest-time choice overrides the source default",
      overridden?.classification === "personal" && overridden?.classificationOverridden === true,
      `${overridden?.classification} overridden=${overridden?.classificationOverridden}`,
    );
    check(
      "the override does not disturb its sibling",
      items.find((i) => i.id === inheritedId)?.classification === "close-friends",
    );

    // ── 3. Setting an item back to the source default CLEARS it ─────────
    await setItemClassification(PUB, overridden!.id, "close-friends");
    let r = await resolveClassification(PUB, overridden!.id);
    check(
      "setting an item to the source default clears the override",
      r.classification === "close-friends" && r.overridden === false,
      `${r.classification} overridden=${r.overridden}`,
    );
    // …and having been cleared, it follows the source again.
    await prisma.ingestionSource.update({
      where: { key: PUB },
      data: { classification: "contact" },
    });
    r = await resolveClassification(PUB, overridden!.id);
    check("a cleared item follows the source again", r.classification === "contact", r.classification);

    // An unknown value is treated as "no override", not stored.
    await setItemClassification(PUB, overridden!.id, "not-a-tier");
    r = await resolveClassification(PUB, overridden!.id);
    check("an unknown classification does not become an override", r.overridden === false);

    // ── 4. A split document's items all inherit the document's choice ───
    await prisma.ingestionSource.update({
      where: { key: PERS },
      data: { splitMode: "split" },
    });
    await ingestCustomText(
      PERS,
      { title: "pic split", text: "a".repeat(200), classification: "public" },
      fakeExtract,
      splitsThree,
    );
    const splitItems = await listIngestedItemsClassified(PERS);
    check("the document split into three items", splitItems.length === 3, `${splitItems.length}`);
    check(
      "every split item carries the document's choice, not the source default",
      splitItems.length === 3 &&
        splitItems.every((i) => i.classification === "public" && i.classificationOverridden),
      splitItems.map((i) => i.classification).join(","),
    );

    // ── 5. Deleting an item removes its override row ────────────────────
    const doomed = splitItems[0]!;
    await deleteIngestedItem(PERS, doomed.id);
    check(
      "deleting an item deletes its override row",
      (await prisma.itemClassification.count({ where: { itemId: doomed.id } })) === 0,
    );
    // Purging the source clears the rest.
    await deleteIngestedData(PERS);
    check(
      "purging a source clears every override it owned",
      (await prisma.itemClassification.count({ where: { sourceKey: PERS } })) === 0,
    );

    // ── 6. The panel offers the picker and shows each item's tier ───────
    const pubRow = (await prisma.ingestionSource.findUnique({ where: { key: PUB } }))!;
    const html = renderToStaticMarkup(
      h(GenericIngestPanel, {
        row: pubRow,
        items: await listIngestedItemsClassified(PUB),
      }) as React.ReactElement,
    );
    const pickers = html.match(/name="classification"/g)?.length ?? 0;
    check("every ingest form carries a classification picker", pickers >= 2, `${pickers} found`);
    check(
      "the picker defaults to inheriting the source",
      html.includes("Same as this source"),
    );
    check(
      "each listed item shows the tier it resolved to",
      html.includes("Co-worker"),
      "expected the source's current tier rendered as a badge",
    );
  } finally {
    for (const k of [PUB, PERS]) {
      await deleteIngestedData(k).catch(() => {});
      await prisma.itemClassification.deleteMany({ where: { sourceKey: k } }).catch(() => {});
      await prisma.ingestionSource.deleteMany({ where: { key: k } }).catch(() => {});
    }
    await prisma.$disconnect();
  }
}

main().then(
  () => {
    console.log(failures === 0 ? "\nPROOF PASS" : `\nPROOF FAIL (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
  },
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

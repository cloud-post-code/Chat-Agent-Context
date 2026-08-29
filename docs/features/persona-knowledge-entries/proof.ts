/**
 * Primary proof for persona-knowledge-entries (see PROOF.md).
 * Run: npx tsx docs/features/persona-knowledge-entries/proof.ts
 *
 * Fully offline. Both model calls are injected: the splitter takes a fake
 * FactClient, entity extraction takes IndexOpts.extract, and the embedding
 * provider keys are unset so the deterministic local embedder runs. Snapshots
 * the real Profile row and its persona chunks, then restores.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
// Force the local hashed embedder: no network, deterministic vectors.
// Set to "" rather than delete: Prisma Client loads .env itself when it is
// imported inside main(), which would otherwise re-populate a deleted key and
// send this proof at the real embeddings API. dotenv never overwrites a value
// that is already defined, and "" is falsy in embedModelName().
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Distinctive tokens so any match can only have come from this proof.
const PERSONA_TEXT =
  "Blake builds small Marrowlight tools and writes about them in public. He " +
  "decides by shipping a rough version first and distrusts Zephyrwind " +
  "roadmaps that promise more than a week out. He works alone in the evenings " +
  "and prefers reading source code to reading documentation. He would rather " +
  "rebuild a thing than argue about it, and he says so plainly.";

const FACTS = [
  { topic: "what he builds", text: "Blake builds small Marrowlight tools and writes about them in public." },
  { topic: "how he decides", text: "Blake decides by shipping a rough version first, and distrusts Zephyrwind roadmaps." },
  { topic: "how he works", text: "Blake works alone in the evenings and prefers reading source code to documentation." },
];

/** A fake FactClient returning `body`, counting calls. */
function fakeSplit(body: string) {
  const calls: unknown[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (p: unknown) => {
          calls.push(p);
          return { content: [{ type: "text", text: body }] };
        },
      },
    },
  };
}

function throwingSplit() {
  return {
    messages: {
      create: async () => {
        throw new Error("provider down");
      },
    },
  };
}

/** Extractor that names one entity + one edge per origin, keyed by its label. */
function fakeExtract() {
  const seen: string[] = [];
  return {
    seen,
    extract: async (_text: string, title: string | null) => {
      seen.push(title ?? "");
      return {
        entities: [{ name: "Marrowlight", type: "project" }, { name: "Blake", type: "person" }],
        edges: [{ from: "Blake", to: "Marrowlight", relation: "builds" }],
      };
    },
  };
}

async function main() {
  const { prisma, getProfile, getPersonaConfig } = await import("../../../lib/db");
  const {
    MAX_FACTS,
    MIN_SPLIT_CHARS,
    sanitizeFacts,
    slugify,
    splitPersonaFacts,
  } = await import("../../../lib/personaFacts");
  const { indexPersona, PERSONA_WHOLE_ID, PERSONA_FACT_PREFIX } = await import(
    "../../../lib/retrieval/origins"
  );
  const { dropOrigin } = await import("../../../lib/retrieval/indexer");
  const { LOCAL_EMBED_MODEL } = await import("../../../lib/retrieval/embed");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");

  const before = await getPersonaConfig();
  const snapshot = before.personaSections;

  const personaOrigins = async (): Promise<string[]> => {
    const rows = await prisma.chunk.findMany({
      where: { originKind: "persona" },
      distinct: ["originId"],
      select: { originId: true },
      orderBy: { originId: "asc" },
    });
    return rows.map((r) => r.originId);
  };
  const setPersona = (text: string) =>
    prisma.personaConfig.update({
      where: { id: 1 },
      data: { personaSections: JSON.stringify(text ? { persona: text } : {}) },
    });

  try {
    // 1 ── slugify.
    check("slugify makes a filename-safe id", slugify("How he decides") === "how-he-decides");
    check("slugify strips punctuation and repeats", slugify("  Tools & env!! ") === "tools-env");
    check("slugify returns empty for an unusable topic", slugify("!!! ???") === "");

    // 2 ── sanitizeFacts trusts nothing about the shape.
    const many = Array.from({ length: MAX_FACTS + 5 }, (_, i) => ({
      topic: `topic ${i}`,
      text: `A claim number ${i} long enough to keep.`,
    }));
    check("caps entries at MAX_FACTS", sanitizeFacts({ facts: many }).length === MAX_FACTS);
    check("accepts a bare array too", sanitizeFacts(many).length === MAX_FACTS);
    check(
      "drops an entry whose topic yields no slug",
      sanitizeFacts({ facts: [{ topic: "???", text: "A claim long enough to keep." }] }).length === 0,
    );
    check(
      "drops text too short to be a claim",
      sanitizeFacts({ facts: [{ topic: "fine topic", text: "no" }] }).length === 0,
    );
    check(
      "dedupes colliding slugs",
      sanitizeFacts({
        facts: [
          { topic: "How He Decides", text: "First version ships rough." },
          { topic: "how he decides", text: "A different sentence entirely." },
        ],
      }).length === 1,
    );
    check(
      "coerces non-string fields without throwing",
      sanitizeFacts({ facts: [{ topic: 42, text: 99999999999 }, null, "str"] }).length === 1,
    );
    for (const junk of [null, undefined, 5, "text", { facts: "no" }, {}]) {
      check(`malformed input (${JSON.stringify(junk)}) yields no entries`, sanitizeFacts(junk).length === 0);
    }

    // 3 ── splitPersonaFacts: guards and downgrades.
    const shortSplit = fakeSplit(JSON.stringify({ facts: FACTS }));
    const short = await splitPersonaFacts("Too short to bother splitting.", {
      client: shortSplit.client,
    });
    check("prose under MIN_SPLIT_CHARS is not split", short.length === 0);
    check("...and costs no model call", shortSplit.calls.length === 0);
    check("MIN_SPLIT_CHARS guard matches the constant", PERSONA_TEXT.length >= MIN_SPLIT_CHARS);

    const fenced = fakeSplit("Here you go:\n```json\n" + JSON.stringify({ facts: FACTS }) + "\n```");
    const parsed = await splitPersonaFacts(PERSONA_TEXT, { client: fenced.client });
    check("parses JSON wrapped in prose and fences", parsed.length === 3, `got ${parsed.length}`);
    check("keeps the topic as the label", parsed[0]?.topic === "what he builds");
    check("derives the slug from the topic", parsed[0]?.slug === "what-he-builds");
    check("one model call per split", fenced.calls.length === 1);

    check(
      "malformed JSON downgrades to no entries",
      (await splitPersonaFacts(PERSONA_TEXT, { client: fakeSplit("not json at all").client })).length === 0,
    );
    check(
      "empty completion downgrades to no entries",
      (await splitPersonaFacts(PERSONA_TEXT, { client: { messages: { create: async () => ({ content: [] }) } } }))
        .length === 0,
    );
    check(
      "a provider failure downgrades to no entries",
      (await splitPersonaFacts(PERSONA_TEXT, { client: throwingSplit() })).length === 0,
    );

    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const noKey = await splitPersonaFacts(PERSONA_TEXT);
    if (key !== undefined) process.env.ANTHROPIC_API_KEY = key;
    check("no API key downgrades to no entries", noKey.length === 0);

    // 4 ── indexPersona writes one origin per claim.
    await setPersona(PERSONA_TEXT);
    const ex1 = fakeExtract();
    await indexPersona({
      split: (p) => splitPersonaFacts(p, { client: fakeSplit(JSON.stringify({ facts: FACTS })).client }),
      extract: ex1.extract,
    });
    let ids = await personaOrigins();
    check("one origin per claim", ids.length === 3, ids.join(","));
    check(
      "origin ids are prefixed",
      ids.every((i) => i.startsWith(PERSONA_FACT_PREFIX)),
      ids.join(","),
    );
    check("the whole-paragraph origin is absent", !ids.includes(PERSONA_WHOLE_ID));
    check("entity extraction ran once per claim", ex1.seen.length === 3, ex1.seen.join(" | "));
    check(
      "each origin is labeled by its topic",
      ex1.seen.every((l) => l.startsWith("Persona — ")),
      ex1.seen.join(" | "),
    );
    const chunk = await prisma.chunk.findFirst({
      where: { originKind: "persona", originId: `${PERSONA_FACT_PREFIX}how-he-decides` },
      select: { text: true, originLabel: true },
    });
    check("the claim's text is what got indexed", chunk?.text === FACTS[1].text, chunk?.text);
    check("the label cites the topic", chunk?.originLabel === "Persona — how he decides");
    // Guards this proof against silently going online again: any provider key
    // leaking back in would change the stored model name.
    const models = await prisma.chunk.findMany({
      where: { originKind: "persona" },
      distinct: ["embedModel"],
      select: { embedModel: true },
    });
    check(
      "embeddings stayed local (proof made no network calls)",
      models.length === 1 && models[0].embedModel === LOCAL_EMBED_MODEL,
      models.map((m) => m.embedModel).join(","),
    );

    // 5 ── Each claim owns its own graph edges.
    const owned = await prisma.entityEdgeOrigin.findMany({
      where: { originKind: "persona", originId: { startsWith: PERSONA_FACT_PREFIX } },
      select: { originId: true },
    });
    check("edges are owned per claim", new Set(owned.map((o) => o.originId)).size === 3, String(owned.length));

    // 6 ── A shrinking claim set is swept.
    await indexPersona({
      split: (p) => splitPersonaFacts(p, { client: fakeSplit(JSON.stringify({ facts: FACTS.slice(0, 2) })).client }),
      extract: fakeExtract().extract,
    });
    ids = await personaOrigins();
    check("a removed claim's chunks are swept", ids.length === 2, ids.join(","));
    check(
      "the removed claim is the one that is gone",
      !ids.includes(`${PERSONA_FACT_PREFIX}how-he-works`),
      ids.join(","),
    );
    const stale = await prisma.entityEdgeOrigin.count({
      where: { originKind: "persona", originId: `${PERSONA_FACT_PREFIX}how-he-works` },
    });
    check("the removed claim's edge ownership is retracted", stale === 0, String(stale));

    // 6b ── Rewriting the persona leaves NONE of the old text behind.
    const REWRITTEN =
      "Blake restores Thornwick clocks and teaches the repair in evening " +
      "classes. He decides by asking what the previous owner would have done, " +
      "trusts a worn part over a new diagram, and refuses to quote a job he " +
      "has not opened up first. He answers slowly and in full sentences.";
    const NEW_FACTS = [
      { topic: "what he restores", text: "Blake restores Thornwick clocks and teaches the repair in evening classes." },
      { topic: "what he trusts", text: "Blake trusts a worn part over a new diagram when diagnosing a movement." },
    ];
    await setPersona(REWRITTEN);
    await indexPersona({
      split: (p) => splitPersonaFacts(p, { client: fakeSplit(JSON.stringify({ facts: NEW_FACTS })).client }),
      extract: fakeExtract().extract,
    });
    const after = await prisma.chunk.findMany({
      where: { originKind: "persona" },
      select: { originId: true, text: true },
    });
    check(
      "a rewritten persona keeps only the new claims",
      (await personaOrigins()).join(",") === `${PERSONA_FACT_PREFIX}what-he-restores,${PERSONA_FACT_PREFIX}what-he-trusts`,
      (await personaOrigins()).join(","),
    );
    check(
      "no chunk retains text from the replaced persona",
      after.every((c) => !/Marrowlight|Zephyrwind|source code/.test(c.text)),
      after.filter((c) => /Marrowlight|Zephyrwind|source code/.test(c.text)).map((c) => c.originId).join(","),
    );
    check(
      "the new claims are what is indexed",
      after.some((c) => c.text.includes("Thornwick clocks")),
    );
    const oldOwned = await prisma.entityEdgeOrigin.count({
      where: { originKind: "persona", originId: { in: FACTS.map((f) => `${PERSONA_FACT_PREFIX}${slugify(f.topic)}`) } },
    });
    check("the replaced claims own no edges any more", oldOwned === 0, String(oldOwned));

    // 7 ── Splitter unavailable: the paragraph is indexed whole, facts swept.
    await indexPersona({ split: (p) => splitPersonaFacts(p, { client: throwingSplit() }), extract: fakeExtract().extract });
    ids = await personaOrigins();
    check("a failed split falls back to one origin", ids.length === 1 && ids[0] === PERSONA_WHOLE_ID, ids.join(","));
    const wholeChunks = await prisma.chunk.findMany({
      where: { originKind: "persona", originId: PERSONA_WHOLE_ID },
      select: { text: true },
      orderBy: { seq: "asc" },
    });
    check(
      "the fallback origin carries the whole paragraph",
      wholeChunks.map((c) => c.text).join(" ").includes("answers slowly and in full sentences"),
    );

    // 8 ── The always-on prompt is unaffected by any of this.
    const prompt = await buildSystemPrompt();
    check("the prompt still carries the full paragraph", prompt.includes(REWRITTEN));

    // 9 ── Emptying the persona leaves nothing behind.
    await setPersona("");
    await indexPersona({ split: (p) => splitPersonaFacts(p, { client: throwingSplit() }), extract: fakeExtract().extract });
    check("an empty persona leaves no chunks", (await personaOrigins()).length === 0);
    const orphaned = await prisma.entityEdgeOrigin.count({ where: { originKind: "persona" } });
    check("an empty persona leaves no edge ownership", orphaned === 0, String(orphaned));
  } finally {
    // 10 ── Restore.
    for (const id of await prisma.chunk
      .findMany({ where: { originKind: "persona" }, distinct: ["originId"], select: { originId: true } })
      .then((r) => r.map((x) => x.originId))) {
      await dropOrigin("persona", id);
    }
    await prisma.entity.deleteMany({ where: { key: { in: ["marrowlight", "zephyrwind"] } } });
    await prisma.personaConfig.update({ where: { id: 1 }, data: { personaSections: snapshot } });
    const restored = (await getPersonaConfig()).personaSections;
    check("profile restored to its pre-proof state", restored === snapshot);
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Primary proof for universal-knowledge-index (see PROOF.md).
 * Run: npx tsx docs/features/universal-knowledge-index/proof.ts
 *
 * Snapshots the Profile row, seeds throwaway projects/photos/sources/chat rows
 * (ids prefixed "uniproof"), exercises the real indexing + retrieval path
 * against the local dev Postgres, asserts, then restores and cleans up.
 * Entity extraction is stubbed so the proof doesn't depend on live Claude.
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

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function para(marker: string, n: number): string {
  const filler =
    "Some additional context follows here describing the work, the people " +
    "involved, and what was learned along the way over several months. ";
  return `${marker} appears in paragraph ${n}. ${filler.repeat(5)}`;
}

// Distinctive markers so retrieval hits are unambiguous.
const BIO = para("QUILLHAVEN apprenticeship", 1);
// The profile origin now indexes the business-identity fields.
const PERSONA_TEXT = para("MARROWLIGHT directness", 1);
const PROJECT_DETAIL = para("TIDEGLASS renderer", 1);
const PHOTO_DESC = para("FERNWICK darkroom", 1);
const ANSWER = para("BELLWEATHER migration", 1);
const SOURCE_TEXT = [1, 2].map((n) => para("Quillhaven Studio collaboration", n)).join("\n\n");

const ENTITY_KEYS = ["quillhaven studio", "tideglass"];

async function main() {
  const { prisma, getProfile, getPersonaConfig } = await import("../../../lib/db");
  const { indexSource, dropOrigin } = await import("../../../lib/retrieval/indexer");
  const {
    indexProfile, indexPersona, indexProject, indexPhoto, indexApprovedAnswer,
  } = await import("../../../lib/retrieval/origins");
  const { retrieve } = await import("../../../lib/retrieval/search");
  const { buildSystemPrompt } = await import("../../../lib/knowledge");

  // Stub extraction: name the same entity the seeded source names, so we can
  // prove cross-origin linking converges on ONE entity row.
  const stub = {
    extract: async () => ({
      entities: [{ name: "Quillhaven Studio", type: "org" }],
      edges: [{ from: "Quillhaven Studio", to: "Tideglass", relation: "built" }],
    }),
    // Index the persona as one undivided origin, which is what this proof was
    // written against. Persona splitting has its own proof
    // (docs/features/persona-knowledge-entries); leaving the real splitter in
    // here would make a Claude call on every run and let a provider hiccup turn
    // an unrelated proof red.
    split: async () => [],
  };

  const before = await getProfile();
  const personaBefore = await getPersonaConfig();
  const baseChunks = await prisma.chunk.count();
  const baseMentions = await prisma.entityMention.count();

  const cleanup = async () => {
    await prisma.profile.update({
      where: { id: 1 },
      data: { company_name: before.company_name, owner_name: before.owner_name },
    });
    await prisma.personaConfig.update({
      where: { id: 1 },
      data: { personaSections: personaBefore.personaSections },
    });
    await prisma.source.deleteMany({ where: { id: { startsWith: "uniproof" } } });
    await prisma.project.deleteMany({ where: { id: { startsWith: "uniproof" } } });
    await prisma.photo.deleteMany({ where: { id: { startsWith: "uniproof" } } });
    await prisma.chatSession.deleteMany({ where: { id: { startsWith: "uniproof" } } });
    for (const kind of ["profile", "persona", "project", "photo", "activity"]) {
      await prisma.chunk.deleteMany({ where: { originKind: kind } });
    }
    await prisma.entity.deleteMany({ where: { key: { in: ENTITY_KEYS } } });
  };

  await cleanup();

  try {
    // ── Seed ──
    await prisma.profile.update({
      where: { id: 1 },
      data: {
        company_name: BIO.slice(0, 60),
        owner_name: "QUILLHAVEN Proofsmith",
      },
    });
    await prisma.personaConfig.update({
      where: { id: 1 },
      data: { personaSections: JSON.stringify({ persona: PERSONA_TEXT }) },
    });
    await prisma.project.create({
      data: {
        id: "uniproof-proj", name: "Tideglass", blurb: "A renderer.",
        detail: PROJECT_DETAIL, tags: "[]",
      },
    });
    await prisma.photo.create({
      data: { id: "uniproof-photo", filename: "fernwick.jpg", description: PHOTO_DESC },
    });
    await prisma.source.create({
      data: {
        id: "uniproof-src", type: "text", title: "Quillhaven writeup",
        rawText: SOURCE_TEXT, summary: "About Quillhaven Studio.", status: "scanned",
      },
    });
    const session = await prisma.chatSession.create({
      data: { id: "uniproof-sess", visitorKey: "uniproof-key", firstQuery: "How did the migration go?" },
    });
    await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "user", content: "How did the migration go?" },
    });
    const answer = await prisma.chatMessage.create({
      data: { sessionId: session.id, role: "assistant", content: ANSWER },
    });

    // ── 1-4. Each origin indexes ──
    await indexProfile(stub);
    await indexPersona(stub);
    await indexProject("uniproof-proj", stub);
    await indexPhoto("uniproof-photo", stub);
    await indexSource("uniproof-src", stub);

    const countOf = (kind: string) => prisma.chunk.count({ where: { originKind: kind } });
    check("profile indexed", (await countOf("profile")) > 0);
    check("persona indexed", (await countOf("persona")) > 0);
    check("project indexed", (await countOf("project")) > 0);
    check("photo indexed", (await countOf("photo")) > 0);

    const projChunk = await prisma.chunk.findFirst({ where: { originKind: "project" } });
    check("project chunk labelled with its name",
      projChunk?.originLabel === "Project: Tideglass", projChunk?.originLabel);

    const rBio = await retrieve("QUILLHAVEN apprenticeship");
    check("profile text is retrievable",
      rBio.chunks.some((c) => c.originKind === "profile"),
      JSON.stringify(rBio.chunks.map((c) => c.originKind)));
    const rPersona = await retrieve("MARROWLIGHT directness");
    check("persona text is retrievable",
      rPersona.chunks.some((c) => c.originKind === "persona"));
    const rProj = await retrieve("TIDEGLASS renderer");
    check("project detail is retrievable",
      rProj.chunks.some((c) => c.originKind === "project"));
    const rPhoto = await retrieve("FERNWICK darkroom");
    check("photo description is retrievable",
      rPhoto.chunks.some((c) => c.originKind === "photo"));

    // ── 5. Activity is approval-gated (the injection boundary) ──
    await indexApprovedAnswer(answer.id, stub);
    check("unrated answer is NOT indexed", (await countOf("activity")) === 0,
      `${await countOf("activity")} chunk(s) leaked in`);

    await prisma.chatMessage.update({ where: { id: answer.id }, data: { rating: "down" } });
    await indexApprovedAnswer(answer.id, stub);
    check("down-rated answer is NOT indexed", (await countOf("activity")) === 0);

    await prisma.chatMessage.update({ where: { id: answer.id }, data: { rating: "up" } });
    await indexApprovedAnswer(answer.id, stub);
    check("approved answer IS indexed", (await countOf("activity")) > 0);

    await prisma.chatMessage.update({ where: { id: answer.id }, data: { rating: null } });
    await indexApprovedAnswer(answer.id, stub);
    check("un-approving removes it again", (await countOf("activity")) === 0);

    // ── 6. Cross-origin entity linking ──
    const ent = await prisma.entity.findUnique({
      where: { key: "quillhaven studio" },
      include: { mentions: { select: { chunk: { select: { originKind: true } } } } },
    });
    const kinds = new Set(ent?.mentions.map((m) => m.chunk.originKind) ?? []);
    check("one entity row spans multiple origins",
      !!ent && kinds.size >= 2,
      `kinds: ${JSON.stringify([...kinds])}`);

    // ── 7. Idempotent, and isolated per origin ──
    const profBefore = await countOf("profile");
    const srcBefore = await countOf("source");
    await indexProfile(stub);
    check("re-index does not duplicate chunks", (await countOf("profile")) === profBefore,
      `${profBefore} -> ${await countOf("profile")}`);
    check("re-indexing one origin leaves others alone",
      (await countOf("source")) === srcBefore);

    // ── 8. Drop is scoped ──
    await dropOrigin("photo", "uniproof-photo");
    check("dropOrigin removes only that origin",
      (await countOf("photo")) === 0 && (await countOf("profile")) === profBefore);

    // ── 9. Prompt slimmed but still tool-capable ──
    const prompt = await buildSystemPrompt("TIDEGLASS renderer");
    check("prompt no longer dumps the full bio", !prompt.includes(BIO));
    check("prompt keeps the project id for show_project",
      prompt.includes("uniproof-proj"));
    check("prompt still carries the persona", prompt.includes("MARROWLIGHT"));
    check("prompt carries retrieved project detail", prompt.includes("TIDEGLASS"));

    // ── 10. Retrieval cites the origin ──
    const profileHit = rBio.chunks.find((c) => c.originKind === "profile");
    check("retrieved profile chunk is labelled Profile",
      profileHit?.ref === "Profile", profileHit?.ref);
  } finally {
    await cleanup();
    check("chunks cleaned up", (await prisma.chunk.count()) === baseChunks,
      `${baseChunks} -> ${await prisma.chunk.count()}`);
    check("mentions cleaned up", (await prisma.entityMention.count()) === baseMentions);
    const after = await getProfile();
    const personaAfter = await getPersonaConfig();
    check("profile restored", after.company_name === before.company_name &&
      personaAfter.personaSections === personaBefore.personaSections);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error("Proof run errored:", e);
  process.exit(1);
});

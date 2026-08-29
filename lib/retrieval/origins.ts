import { prisma, getProfile, getPersonaConfig } from "../db";
import { personaPromptBlock } from "../persona";
import { splitPersonaFacts, type PersonaFact } from "../personaFacts";
import { safeTags } from "../knowledge";
import { indexOrigin, dropOrigin, type IndexOpts } from "./indexer";

/**
 * Turns every admin surface into indexable text, so one graph covers
 * everything Blake curates instead of just the Knowledge tab's sources.
 *
 * Each function is best-effort at the call site: an indexing failure must
 * never fail the admin save that triggered it.
 *
 * ACTIVITY IS DELIBERATELY APPROVAL-GATED. Visitors type into the public chat
 * box, so their words are untrusted input. Indexing raw conversations would let
 * anyone write into the knowledge base and have it retrieved later as fact.
 * Only an assistant answer Blake has rated "up" is indexed, so nothing crosses
 * from a visitor into knowledge without him endorsing it.
 */

export const ORIGIN_KINDS = [
  "profile", "persona", "project", "photo", "source", "activity",
] as const;

/** Human label for the Graph tab's per-origin breakdown. */
export const ORIGIN_LABELS: Record<string, string> = {
  profile: "Profile",
  persona: "Persona",
  project: "Projects",
  photo: "Photos",
  source: "Knowledge",
  activity: "Approved answers",
  // Synthesized neighborhood overviews (lib/retrieval/clusters.ts) — not an
  // admin surface, but they appear in the Graph tab's per-origin breakdown.
  cluster: "Overviews",
};

/** The business identity from the Profile tab, as indexable prose. */
export async function indexProfile(opts: IndexOpts = {}): Promise<void> {
  const p = await getProfile();
  const lines: string[] = [];
  if (p.company_name) lines.push(`The business is ${p.company_name}.`);
  if (p.owner_name) lines.push(`It is owned and run by ${p.owner_name}.`);
  if (p.company_address) lines.push(`Address: ${p.company_address}.`);
  if (p.company_phone_number) lines.push(`Phone: ${p.company_phone_number}.`);
  if (p.company_email) lines.push(`Email: ${p.company_email}.`);
  if (p.company_hours) lines.push(`Hours: ${p.company_hours}.`);

  await indexOrigin(
    { kind: "profile", id: "profile", label: "Profile", text: lines.join("\n\n") },
    opts,
  );
}

/** Origin id used when the persona is indexed as one undivided paragraph. */
export const PERSONA_WHOLE_ID = "persona";
/** Prefix for a single parsed persona claim, so `fact:x` can't collide with it. */
export const PERSONA_FACT_PREFIX = "fact:";

/** Replaceable splitter, so a proof can index the persona without a model call. */
export type PersonaSplitter = (prose: string) => Promise<PersonaFact[]>;

export type PersonaIndexOpts = IndexOpts & { split?: PersonaSplitter };

/**
 * The persona, parsed into one origin per claim it makes.
 *
 * The paragraph is split (lib/personaFacts.ts) and each claim indexed
 * separately, so retrieval can match one specific thing rather than the
 * average of everything the persona says, and each claim owns its own graph
 * edges. When the split yields nothing — no API key, a failed pass, or a
 * paragraph too short to be worth dividing — the whole paragraph is indexed
 * under a single origin, exactly as it was before splitting existed.
 *
 * This does not change the always-on PERSONA block in the system prompt; the
 * full paragraph still ships verbatim on every message.
 */
export async function indexPersona(opts: PersonaIndexOpts = {}): Promise<void> {
  const p = await getPersonaConfig();
  const prose = personaPromptBlock(p.personaSections);
  const facts = await (opts.split ?? splitPersonaFacts)(prose);

  const written: string[] = [];
  for (const f of facts) {
    const id = `${PERSONA_FACT_PREFIX}${f.slug}`;
    await indexOrigin(
      { kind: "persona", id, label: `Persona — ${f.topic}`, text: f.text },
      opts,
    );
    written.push(id);
  }
  if (!facts.length) {
    // Empty prose lands here too, where indexOrigin retracts the origin.
    await indexOrigin(
      { kind: "persona", id: PERSONA_WHOLE_ID, label: "Persona", text: prose },
      opts,
    );
    written.push(PERSONA_WHOLE_ID);
  }

  await sweepPersonaOrigins(written);
}

/**
 * Drop every persona origin this pass didn't write.
 *
 * The set of claims changes shape whenever the paragraph is edited, and
 * indexOrigin only ever replaces the id it was handed. Without this sweep a
 * claim Blake deleted keeps its chunks and its graph edges forever — and
 * retrieve() scans the whole chunk table, so the deleted text would go on being
 * fed to the model as fact. Lives here rather than in the admin action so
 * scripts/reindex.ts and indexEverything are cleaned up too.
 */
async function sweepPersonaOrigins(keep: string[]): Promise<void> {
  const rows = await prisma.chunk.findMany({
    where: { originKind: "persona" },
    distinct: ["originId"],
    select: { originId: true },
  });
  for (const r of rows) {
    if (!keep.includes(r.originId)) await dropOrigin("persona", r.originId);
  }
}

/** One project card: name, blurb, the longer write-up, and its tags. */
export async function indexProject(id: string, opts: IndexOpts = {}): Promise<void> {
  const proj = await prisma.project.findUnique({ where: { id } });
  if (!proj) return dropOrigin("project", id);

  const tags = safeTags(proj.tags);
  const text = [
    `${proj.name}. ${proj.blurb}`.trim(),
    proj.detail?.trim() ?? "",
    tags.length ? `Tags: ${tags.join(", ")}.` : "",
    proj.githubUrl ? `Source code: ${proj.githubUrl}` : "",
    proj.liveUrl ? `Live at: ${proj.liveUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  await indexOrigin(
    { kind: "project", id, label: `Project: ${proj.name}`, text },
    opts,
  );
}

/** A photo's caption and its vision-generated description. */
export async function indexPhoto(id: string, opts: IndexOpts = {}): Promise<void> {
  const photo = await prisma.photo.findUnique({ where: { id } });
  if (!photo) return dropOrigin("photo", id);

  const text = [photo.caption?.trim() ?? "", photo.description?.trim() ?? ""]
    .filter(Boolean)
    .join("\n\n");

  await indexOrigin(
    { kind: "photo", id, label: `Photo: ${photo.filename}`, text },
    opts,
  );
}

/**
 * An answer Blake approved with 👍, indexed with the question it answered so
 * the pair reads as a self-contained fact. Any other rating drops it —
 * un-approving an answer removes it from knowledge.
 */
export async function indexApprovedAnswer(messageId: string, opts: IndexOpts = {}): Promise<void> {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.role !== "assistant" || msg.rating !== "up") {
    return dropOrigin("activity", messageId);
  }

  // The visitor's question is included only as context for an answer Blake
  // already vouched for — it is never indexed on its own.
  const question = await prisma.chatMessage.findFirst({
    where: { sessionId: msg.sessionId, role: "user", createdAt: { lt: msg.createdAt } },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  });

  const text = [question ? `Question: ${question.content.trim()}` : "", msg.content.trim()]
    .filter(Boolean)
    .join("\n\n");

  await indexOrigin(
    { kind: "activity", id: messageId, label: "Approved answer", text },
    opts,
  );
}

/**
 * Re-index every origin. Used by scripts/reindex.ts.
 *
 * Paced: a backfill fires one embedding request per origin back to back, which
 * trips entry-tier per-minute limits and leaves chunks unembedded. The pause
 * lives here rather than in the embedding layer on purpose — live chat embeds
 * the visitor's question on every message and must never be throttled.
 * Override with EMBED_PACE_MS (0 disables) when on a higher-limit plan.
 */
export async function indexEverything(
  opts: IndexOpts & { onProgress?: (label: string) => void; paceMs?: number } = {},
): Promise<number> {
  const { onProgress, paceMs, ...indexOpts } = opts;
  const pause = paceMs ?? Number(process.env.EMBED_PACE_MS ?? 21_000);
  let done = 0;
  const step = async (label: string, run: () => Promise<void>) => {
    if (done > 0 && pause > 0) await new Promise((r) => setTimeout(r, pause));
    await run();
    done++;
    onProgress?.(label);
  };

  await step("Profile", () => indexProfile(indexOpts));
  await step("Persona", () => indexPersona(indexOpts));

  for (const p of await prisma.project.findMany({ select: { id: true, name: true } })) {
    await step(`Project: ${p.name}`, () => indexProject(p.id, indexOpts));
  }
  for (const ph of await prisma.photo.findMany({ select: { id: true, filename: true } })) {
    await step(`Photo: ${ph.filename}`, () => indexPhoto(ph.id, indexOpts));
  }
  const approved = await prisma.chatMessage.findMany({
    where: { role: "assistant", rating: "up" },
    select: { id: true },
  });
  for (const m of approved) {
    await step("Approved answer", () => indexApprovedAnswer(m.id, indexOpts));
  }
  return done;
}

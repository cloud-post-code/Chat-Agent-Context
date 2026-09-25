import type Anthropic from "@anthropic-ai/sdk";
import { claude, claudeModel } from "../claude";
import { prisma, getProfile } from "../db";
import { tokenize } from "./chunking";
import { indexOrigin } from "./indexer";
import { entityKey } from "./entities";
import { mapPool } from "../pool";

/**
 * GraphRAG-lite: neighborhood overviews for broad questions.
 *
 * Chunk retrieval answers "where did Blake work?" well and "tell me about
 * Blake" badly — no single chunk answers a global question. So the entity
 * graph is partitioned into neighborhoods (remove the hub that connects to
 * everything, take connected components), each neighborhood is summarized
 * into one paragraph, and broad questions are served those paragraphs
 * instead of retrieval's grab-bag.
 *
 * Overviews are stored through the ordinary indexOrigin machinery as chunks
 * with originKind "cluster": no new table, embeddings for free, and stale
 * overviews sweep like any retracted origin. Extraction is passed as empty so
 * synthetic prose never writes into the graph it summarizes; retrieve()
 * skips cluster chunks so overviews never compete with the chunks they were
 * built from.
 *
 * Rebuilding is explicit (Graph tab button, scripts/reindex.ts --all) — up
 * to MAX_CLUSTERS Claude calls per rebuild is a spend decision, not a
 * side effect of every save.
 */

const CLUSTER_KIND = "cluster";

/// Only a genuinely everything-touching entity is a hub worth removing.
const HUB_MIN_DEGREE = 4;
const MIN_CLUSTER_SIZE = 2;
export const MAX_CLUSTERS = 6;
/// Cap on source text fed to one summary call.
const CLUSTER_TEXT_BUDGET = 8000;
/// A token this common across chunks selects nothing.
const DISTINCTIVE_DF_RATIO = 0.2;

export type ClusterEntity = { id: string; name: string; mentions: number };
export type ClusterEdge = { fromId: string; toId: string };
export type Cluster = { label: string; slug: string; memberIds: string[] };

/**
 * Partition the entity graph into neighborhoods. Pure and deterministic:
 * remove the top-degree entity when its degree reaches HUB_MIN_DEGREE (in
 * this graph that is Blake, who would otherwise glue every neighborhood into
 * one blob), take connected components of the rest, drop fragments below
 * MIN_CLUSTER_SIZE, label each component by its highest-mention member, and
 * keep the MAX_CLUSTERS heaviest.
 */
export function computeClusters(entities: ClusterEntity[], edges: ClusterEdge[]): Cluster[] {
  if (entities.length < MIN_CLUSTER_SIZE) return [];

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.fromId, (degree.get(e.fromId) ?? 0) + 1);
    degree.set(e.toId, (degree.get(e.toId) ?? 0) + 1);
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  const top = [...entities].sort(
    (a, b) =>
      (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.name.localeCompare(b.name),
  )[0];
  const hubId = top && (degree.get(top.id) ?? 0) >= HUB_MIN_DEGREE ? top.id : null;

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.fromId === hubId || e.toId === hubId) continue;
    if (!byId.has(e.fromId) || !byId.has(e.toId)) continue;
    (adj.get(e.fromId) ?? adj.set(e.fromId, []).get(e.fromId)!).push(e.toId);
    (adj.get(e.toId) ?? adj.set(e.toId, []).get(e.toId)!).push(e.fromId);
  }

  const seen = new Set<string>(hubId ? [hubId] : []);
  const components: string[][] = [];
  for (const e of entities) {
    if (seen.has(e.id)) continue;
    const comp: string[] = [];
    const queue = [e.id];
    seen.add(e.id);
    while (queue.length) {
      const id = queue.shift()!;
      comp.push(id);
      for (const n of adj.get(id) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    if (comp.length >= MIN_CLUSTER_SIZE) components.push(comp);
  }

  return components
    .map((memberIds) => {
      const members = memberIds.map((id) => byId.get(id)!);
      const label = [...members].sort(
        (a, b) => b.mentions - a.mentions || a.name.localeCompare(b.name),
      )[0].name;
      const weight = members.reduce((s, m) => s + m.mentions, 0);
      return { label, slug: entityKey(label).replace(/[^a-z0-9]+/g, "-"), memberIds, weight };
    })
    .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label))
    .slice(0, MAX_CLUSTERS)
    .map(({ weight: _weight, ...c }) => c);
}

export type ClusterSummarizer = (
  label: string,
  members: string[],
  text: string,
) => Promise<string>;

/** One grounded paragraph per neighborhood; the only model call here. */
export const summarizeCluster: ClusterSummarizer = async (label, members, text) => {
  const msg = await claude().messages.create({
    model: claudeModel(),
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content:
          `Below are excerpts from a personal website's knowledge base, all related to ` +
          `"${label}" (involving: ${members.join(", ")}). Write ONE paragraph (3-5 ` +
          `sentences) summarizing what this neighborhood of the owner's life or work is ` +
          `about, strictly grounded in the excerpts — no invented facts, no preamble, ` +
          `just the paragraph.\n\nEXCERPTS:\n${text}`,
      },
    ],
  });
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
};

export type BuildOverviewOpts = {
  summarize?: ClusterSummarizer;
  /// Clusters summarized at once. 1 unless the caller raises it (onboarding
  /// does); clusters share nothing but the final sweep, which waits for all.
  concurrency?: number;
};

/**
 * Recompute clusters and rewrite one overview chunk per cluster. A failed
 * summary call keeps that cluster's previous overview (deleting knowledge over
 * a provider hiccup would be a regression); overviews whose cluster no longer
 * exists are swept. Returns how many overviews were (re)written.
 */
export async function buildClusterOverviews(
  userId: string,
  opts: BuildOverviewOpts = {},
): Promise<number> {
  const [entities, edges] = await Promise.all([
    prisma.entity.findMany({
      where: { userId },
      select: { id: true, name: true, _count: { select: { mentions: true } } },
    }),
    prisma.entityEdge.findMany({
      where: { from: { userId } },
      select: { fromId: true, toId: true },
    }),
  ]);
  const clusters = computeClusters(
    entities.map((e) => ({ id: e.id, name: e.name, mentions: e._count.mentions })),
    edges,
  );
  const nameById = new Map(entities.map((e) => [e.id, e.name]));

  const keep: string[] = [];
  let written = 0;
  await mapPool(clusters, opts.concurrency ?? 1, async (c) => {
    const originId = `ov:${c.slug}`;
    const mentions = await prisma.entityMention.findMany({
      where: { entityId: { in: c.memberIds } },
      select: { chunk: { select: { id: true, text: true, originKind: true } } },
    });
    const seen = new Set<string>();
    let text = "";
    for (const m of mentions) {
      if (m.chunk.originKind === CLUSTER_KIND || seen.has(m.chunk.id)) continue;
      seen.add(m.chunk.id);
      if (text.length + m.chunk.text.length > CLUSTER_TEXT_BUDGET) break;
      text += `${m.chunk.text}\n\n`;
    }
    if (!text.trim()) return;

    let summary: string;
    try {
      summary = (
        await (opts.summarize ?? summarizeCluster)(
          c.label,
          c.memberIds.map((id) => nameById.get(id) ?? id),
          text.trim(),
        )
      ).trim();
    } catch {
      keep.push(originId); // provider hiccup: the previous overview survives
      return;
    }
    if (!summary) {
      keep.push(originId);
      return;
    }

    await indexOrigin(
      userId,
      { kind: CLUSTER_KIND, id: originId, label: `Overview — ${c.label}`, text: summary },
      // Empty extraction on purpose: synthetic prose must not feed the graph.
      { extract: async () => ({ entities: [], edges: [] }) },
    );
    keep.push(originId);
    written++;
  });

  await prisma.chunk.deleteMany({
    where: { userId, originKind: CLUSTER_KIND, originId: { notIn: keep } },
  });
  return written;
}

/**
 * Is this question broad? Broad = no distinctive token: nothing in it selects
 * a small slice of the corpus. The owner's name is never distinctive — "tell
 * me about Blake" is the flagship broad question. Unknown tokens (df 0) are
 * not distinctive either: wording the corpus has never seen deserves the
 * overview, not a grab-bag of weak matches. Pure, for testability.
 */
export function isBroadQuery(
  tokens: string[],
  df: Map<string, number>,
  docCount: number,
  ownerTokens: Set<string>,
): boolean {
  if (docCount === 0) return false;
  // Absolute floor of 2: a token found in exactly one chunk is selective in
  // any corpus, including a nearly-empty one where 20% rounds below a single
  // document.
  const ceiling = Math.max(2, docCount * DISTINCTIVE_DF_RATIO);
  return !tokens.some((t) => {
    if (ownerTokens.has(t)) return false;
    const n = df.get(t) ?? 0;
    return n >= 1 && n < ceiling;
  });
}

/**
 * The overview block for a broad question, or null when the question is
 * specific (let retrieval handle it) or no overviews exist yet.
 */
export async function broadOverviews(userId: string, query: string): Promise<string | null> {
  const q = query.trim();
  if (!q) return null;

  const overviews = await prisma.chunk.findMany({
    where: { userId, originKind: CLUSTER_KIND },
    orderBy: { originLabel: "asc" },
    select: { originLabel: true, text: true },
  });
  if (!overviews.length) return null;

  const docs = await prisma.chunk.findMany({
    where: { userId, originKind: { not: CLUSTER_KIND } },
    select: { text: true },
  });
  if (!docs.length) return null;

  const df = new Map<string, number>();
  for (const d of docs) {
    for (const t of new Set(tokenize(d.text))) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const ownerProfile = await getProfile(userId);
  const owner = new Set(tokenize(`${ownerProfile.company_name} ${ownerProfile.owner_name}`));
  if (!isBroadQuery(tokenize(q), df, docs.length, owner)) return null;

  return (
    "This is a broad question, so instead of individual excerpts here are the " +
    "curated overviews of each area of the owner's life and work:\n\n" +
    overviews.map((o) => `[${o.originLabel}]\n${o.text}`).join("\n\n")
  );
}

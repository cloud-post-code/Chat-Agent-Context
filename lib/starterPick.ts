/**
 * Which starter tabs one chat shows.
 *
 * An account's live preset questions are a pool, not a fixed row: every new
 * chat picks CHIP_COUNT of them, so two visitors — or one visitor's two chats —
 * open on different questions. The pick is led by the owner's goals: the pool
 * is grouped by the goal each question steers toward (CannedAnswer.goal), a
 * chat takes one question from each goal before any general question, and
 * which goal leads rotates from chat to chat, as does the question each goal
 * offers. A pool no bigger than the row is shown whole, in the owner's order —
 * there is nothing to rotate.
 *
 * Deterministic in the chat id on purpose: the public page renders on the
 * server and hydrates on the client with the same id, so both must agree on
 * the tabs, and a saved chat reopened from the sidebar shows the tabs it had.
 *
 * Pure on purpose: app/Chat.tsx is a client component and imports this, so
 * nothing here may reach for the database.
 */

import { CHIP_COUNT } from "@/lib/chipLabel";

/** One question in the pool: the whole question, its tab text, its goal. */
export type StarterOption = { q: string; label?: string; goal?: string };

/** FNV-1a over the seed: small, stable across runtimes, spread enough here. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The `count` tabs for the chat `seed` names, from `pool`.
 *
 * Blank and repeated questions are dropped first, so a caller can hand over
 * rows as they are. The result keeps each option object as given.
 */
export function pickStarters<T extends StarterOption>(
  pool: T[],
  seed: string,
  count: number = CHIP_COUNT,
): T[] {
  const seen = new Set<string>();
  const options = pool.filter((o) => {
    const key = o.q.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (count <= 0) return [];
  if (options.length <= count) return options;

  // Groups in the owner's order: each goal as its questions first appear,
  // then the general questions (no goal) as one group at the end.
  const byGoal = new Map<string, T[]>();
  const general: T[] = [];
  for (const o of options) {
    const goal = (o.goal ?? "").trim();
    if (!goal) {
      general.push(o);
      continue;
    }
    const group = byGoal.get(goal);
    if (group) group.push(o);
    else byGoal.set(goal, [o]);
  }
  const goalGroups = [...byGoal.values()];

  // Which goal leads rotates with the chat; the general group always trails,
  // so a chat only reaches it once every goal has had its turn.
  const h = hashSeed(seed);
  const lead = goalGroups.length ? h % goalGroups.length : 0;
  const order = [...goalGroups.slice(lead), ...goalGroups.slice(0, lead)];
  if (general.length) order.push(general);

  // Each group starts at its own chat-dependent offset, so the same goal
  // offers a different question next chat, and walks on in owner order.
  const cursor = order.map((group, i) => hashSeed(`${seed}#${i}`) % group.length);
  const taken = order.map(() => 0);

  const picked: T[] = [];
  while (picked.length < count) {
    let progressed = false;
    for (let i = 0; i < order.length && picked.length < count; i++) {
      const group = order[i];
      if (taken[i] >= group.length) continue;
      picked.push(group[(cursor[i] + taken[i]) % group.length]);
      taken[i]++;
      progressed = true;
    }
    if (!progressed) break; // every group exhausted (cannot happen past the size guard)
  }
  return picked;
}

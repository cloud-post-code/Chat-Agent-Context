import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads in dev to avoid connection exhaustion.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Two upserts on a row that doesn't exist yet can both miss the update
 * branch and both attempt the create; Postgres's unique constraint is what
 * actually serializes them, and the loser gets a P2002 throw instead of the
 * row. `buildSystemPrompt` and `runModel`'s tool/prompt assembly each await
 * several of these loaders together (`Promise.all`), so on a brand-new
 * account's first turn two calls for the SAME (table, userId) can land
 * inside that window. Rather than let that race reach Postgres at all —
 * catching the throw afterward still leaves Prisma's own `log: ["error"]`
 * line printed, since it logs at the point the query fails, not at the
 * catch — concurrent callers for the same key SHARE one in-flight upsert:
 * the first caller starts it and caches the promise; every other caller
 * within the same window awaits that same promise instead of starting its
 * own. The cache entry is removed once the upsert settles, so a later,
 * separate turn still gets a fresh read.
 */
function dedupedUpsert<T>(cache: Map<string, Promise<T>>, key: string, op: () => Promise<T>): Promise<T> {
  const inFlight = cache.get(key);
  if (inFlight) return inFlight;
  const started = op().finally(() => cache.delete(key));
  cache.set(key, started);
  return started;
}

type Profile = Awaited<ReturnType<typeof prisma.profile.upsert>>;
type PersonaConfig = Awaited<ReturnType<typeof prisma.personaConfig.upsert>>;
type ThemeConfig = Awaited<ReturnType<typeof prisma.themeConfig.upsert>>;

const profileUpserts = new Map<string, Promise<Profile>>();
const personaUpserts = new Map<string, Promise<PersonaConfig>>();
const themeUpserts = new Map<string, Promise<ThemeConfig>>();

/**
 * Load one user's Profile row (business identity), creating a default if
 * missing. Upsert, not find-then-create; `dedupedUpsert` collapses
 * concurrent callers for the same userId onto one upsert instead of racing.
 */
export async function getProfile(userId: string): Promise<Profile> {
  return dedupedUpsert(profileUpserts, userId, () =>
    prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } }),
  );
}

/** Load one user's PersonaConfig row (brand voice), creating a default if missing. */
export async function getPersonaConfig(userId: string): Promise<PersonaConfig> {
  return dedupedUpsert(personaUpserts, userId, () =>
    prisma.personaConfig.upsert({ where: { userId }, update: {}, create: { userId } }),
  );
}

/** Load one user's ThemeConfig row (site look), creating a default if missing. */
export async function getThemeConfig(userId: string): Promise<ThemeConfig> {
  return dedupedUpsert(themeUpserts, userId, () =>
    prisma.themeConfig.upsert({ where: { userId }, update: {}, create: { userId } }),
  );
}

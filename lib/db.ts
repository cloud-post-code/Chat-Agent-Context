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
 * Load one user's Profile row (business identity), creating a default if
 * missing. Upsert, not find-then-create: these three loaders run concurrently
 * (buildSystemPrompt awaits them together), so on an account whose rows don't
 * exist yet two of them raced and one threw a unique-constraint error —
 * failing the visitor's whole answer.
 */
export async function getProfile(userId: string) {
  return prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } });
}

/** Load one user's PersonaConfig row (brand voice), creating a default if missing. */
export async function getPersonaConfig(userId: string) {
  return prisma.personaConfig.upsert({ where: { userId }, update: {}, create: { userId } });
}

/** Load one user's ThemeConfig row (site look), creating a default if missing. */
export async function getThemeConfig(userId: string) {
  return prisma.themeConfig.upsert({ where: { userId }, update: {}, create: { userId } });
}

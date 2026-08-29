import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads in dev to avoid connection exhaustion.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Load one user's Profile row (business identity), creating a default if missing. */
export async function getProfile(userId: string) {
  const existing = await prisma.profile.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.profile.create({ data: { userId } });
}

/** Load one user's PersonaConfig row (brand voice), creating a default if missing. */
export async function getPersonaConfig(userId: string) {
  const existing = await prisma.personaConfig.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.personaConfig.create({ data: { userId } });
}

/** Load one user's ThemeConfig row (site look), creating a default if missing. */
export async function getThemeConfig(userId: string) {
  const existing = await prisma.themeConfig.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.themeConfig.create({ data: { userId } });
}

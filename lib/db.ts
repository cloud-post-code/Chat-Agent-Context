import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads in dev to avoid connection exhaustion.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Load the singleton Profile row (business identity), creating a default if missing. */
export async function getProfile() {
  const existing = await prisma.profile.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.profile.create({ data: { id: 1 } });
}

/** Load the singleton PersonaConfig row (brand voice), creating a default if missing. */
export async function getPersonaConfig() {
  const existing = await prisma.personaConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.personaConfig.create({ data: { id: 1 } });
}

/** Load the singleton ThemeConfig row (site look), creating a default if missing. */
export async function getThemeConfig() {
  const existing = await prisma.themeConfig.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.themeConfig.create({ data: { id: 1 } });
}

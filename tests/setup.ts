import { vi } from "vitest";

// Vitest runs pure tests: a test that reaches the database is a bug in the
// test, not a slow test. Every @/lib/db export throws on use.
vi.mock("@/lib/db", () => {
  const boom = (name: string) => () => {
    throw new Error(`tests must not touch the database (called lib/db.${name}); use a proof script under docs/features instead`);
  };
  const prisma = new Proxy({}, { get: (_t, model) => new Proxy({}, { get: (_m, op) => boom(`prisma.${String(model)}.${String(op)}`) }) });
  return {
    prisma,
    getProfile: boom("getProfile"),
    getPersonaConfig: boom("getPersonaConfig"),
    getThemeConfig: boom("getThemeConfig"),
  };
});

process.env.ANTHROPIC_API_KEY ??= "test-key-never-used";

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * lib/accountWipe.ts lists every per-user table by hand. This test reads the
 * schema and fails when a model with a `userId` column is added without the
 * wipe learning about it — the one way a "full reset" silently stops being full.
 */
const root = path.resolve(__dirname, "../..");
const schema = readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
const wipe = readFileSync(path.join(root, "lib/accountWipe.ts"), "utf8");

/** Survive on purpose: the login row (updated), the blanked profile (upserted), the Gmail link. */
const KEPT = new Set(["User", "Profile", "GmailAuth"]);

const bodies = new Map<string, string>();
for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) bodies.set(m[1], m[2]);
const perUserModels = () => [...bodies].filter(([, body]) => /^\s+userId\s/m.test(body)).map(([name]) => name);
const prismaName = (model: string) => model[0].toLowerCase() + model.slice(1);
const deletedDirectly = (model: string) => wipe.includes(`prisma.${prismaName(model)}.deleteMany`);
/** Rows that go with their parent: a relation to a wiped model with onDelete: Cascade. */
function deletedByCascade(model: string, seen = new Set<string>()): boolean {
  if (seen.has(model)) return false;
  seen.add(model);
  const body = bodies.get(model) ?? "";
  for (const rel of body.matchAll(/^\s+\w+\s+(\w+)\s+@relation\([^)]*onDelete: Cascade/gm)) {
    const parent = rel[1];
    if (parent === "User") continue;
    if (deletedDirectly(parent) || deletedByCascade(parent, seen)) return true;
  }
  return false;
}

describe("wipeAccountContent covers every per-user table", () => {
  const models = perUserModels();
  it("found the per-user models", () => {
    expect(models.length).toBeGreaterThan(20);
  });
  it.each(models.filter((m) => !KEPT.has(m)))("%s is deleted, directly or by cascade", (model) => {
    expect(deletedDirectly(model) || deletedByCascade(model)).toBe(true);
  });
  it("blanks the profile and keeps the user", () => {
    expect(wipe).toContain("prisma.profile.upsert");
    expect(wipe).toContain("prisma.user.update");
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Layering tripwires, checked statically from import statements:
 *  1. no "use client" component reaches lib/db.ts (the Prisma client) through
 *     value imports — that would ship the database client to the browser;
 *  2. nothing in lib/ imports a value from app/.
 * Type-only imports (`import type`) are ignored; they vanish at build time.
 */
const root = path.resolve(__dirname, "../..");
const EXT = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}
function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const e of ["", ...EXT]) if (existsSync(base + e) && statSync(base + e).isFile()) return base + e;
  return null;
}
/** Value imports only (type-only ones are dropped at build time). */
function valueImports(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const out: string[] = [];
  const re = /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) if (!m[1]) out.push(m[2]);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}
/** A "use server" module is an RPC boundary: the client bundle gets stubs, not its imports. */
function isServerActionModule(file: string): boolean {
  return /^\s*["']use server["']/m.test(readFileSync(file, "utf8").slice(0, 300));
}
function reaches(start: string, target: (p: string) => boolean, seen = new Set<string>()): string[] | null {
  if (seen.has(start)) return null;
  seen.add(start);
  if (isServerActionModule(start)) return null;
  for (const spec of valueImports(start)) {
    const next = resolveImport(start, spec);
    if (!next) continue;
    if (target(next)) return [start, next];
    const chain = reaches(next, target, seen);
    if (chain) return [start, ...chain];
  }
  return null;
}
const rel = (p: string) => path.relative(root, p);
const isDb = (p: string) => rel(p) === "lib/db.ts";

describe("layering", () => {
  it("no client component imports the database client, even transitively", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(root, "app"))) {
      const src = readFileSync(file, "utf8");
      if (!/^\s*["']use client["']/m.test(src.slice(0, 300))) continue;
      const chain = reaches(file, isDb);
      if (chain) offenders.push(chain.map(rel).join(" → "));
    }
    expect(offenders).toEqual([]);
  });

  it("lib/ never imports a value from app/", () => {
    const allowed = new Set<string>();
    const offenders: string[] = [];
    for (const file of walk(path.join(root, "lib"))) {
      for (const spec of valueImports(file)) {
        const next = resolveImport(file, spec);
        const edge = next ? `${rel(file)} → ${rel(next)}` : "";
        if (next && rel(next).startsWith("app/") && !allowed.has(edge)) offenders.push(edge);
      }
    }
    expect(offenders).toEqual([]);
  });
});

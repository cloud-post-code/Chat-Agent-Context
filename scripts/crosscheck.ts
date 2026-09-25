/**
 * Runs the feature proofs — the integration checks that need a live
 * Postgres, and sometimes a model or the network — one after another and
 * reports which passed. `npm test` (Vitest) covers the pure logic; this
 * covers everything the tests deliberately can't.
 *
 *   npm run crosscheck                    every "passing"/"done" feature's proof.ts
 *   npm run crosscheck -- --only menu-cart,booking-flow
 *   npm run crosscheck -- --needs db      only proofs tagged db (skip model/http)
 *   npm run crosscheck -- --list          show what would run and why
 *
 * What a proof needs is read from its imports and env lookups: a proof that
 * touches @/lib/db needs "db"; one that reads ANTHROPIC_API_KEY or calls a
 * live model needs "model"; one that fetches a server needs "http". A
 * status.json entry may override with `"proof_needs": ["db", "model"]`, and
 * name a script elsewhere with `"proof_script": "docs/features/x/proof/run.ts"`.
 * Model- and http-tagged proofs are skipped unless the environment can
 * serve them (ANTHROPIC_API_KEY / PROOF_BASE_URL set).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type Need = "db" | "model" | "http";
type Entry = { id: string; status: string; feature_dir?: string; proof?: string; proof_needs?: Need[]; proof_script?: string };

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = flag("--only")?.split(",").filter(Boolean);
const needsFilter = flag("--needs")?.split(",").filter(Boolean) as Need[] | undefined;
const listOnly = args.includes("--list");

const status = JSON.parse(readFileSync(path.join(root, "docs/features/status.json"), "utf8")) as { features: Entry[] };

function proofPath(e: Entry): string | null {
  const dir = e.feature_dir ?? `docs/features/${e.id}`;
  // `proof_script` in status.json names a script that isn't at the default
  // path (a proof/ subfolder, or scripts/proof-multi-tenant.ts).
  const candidates = [
    ...(e.proof_script ? [path.join(root, e.proof_script)] : []),
    path.join(root, dir, "proof.ts"),
    path.join(root, dir, "proof/run.sh"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function detectNeeds(file: string): Need[] {
  // The proof plus the sibling scripts it imports (booking-flow's
  // proof.sections.ts) — not every file in the folder, since live.ts /
  // crosscheck.ts are opt-in model runs the proof itself never touches.
  const dir = path.dirname(file);
  const seen = new Set<string>();
  const queue = [file];
  let src = "";
  while (queue.length) {
    const f = queue.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    src += "\n" + text;
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const base = path.resolve(path.dirname(f), m[1]);
      if (!base.startsWith(dir + path.sep)) continue; // lib/ imports are the app, not the proof's needs
      for (const cand of [base, base + ".ts", base + ".tsx"]) if (existsSync(cand)) queue.push(cand);
    }
  }
  const needs = new Set<Need>();
  if (/@\/lib\/db|lib\/db["']|new PrismaClient|prisma\./.test(src)) needs.add("db");
  if (/ANTHROPIC_API_KEY|--live|\bclaude\(\)|Anthropic\(/.test(src)) needs.add("model");
  if (/PROOF_BASE_URL|fetch\(\s*`?http/.test(src)) needs.add("http");
  return [...needs];
}

const canServe = (n: Need) =>
  n === "db" ? !!process.env.DATABASE_URL || existsSync(path.join(root, ".env")) : n === "model" ? !!process.env.ANTHROPIC_API_KEY : !!process.env.PROOF_BASE_URL;

const plan = status.features
  .filter((e) => (only ? only.includes(e.id) : ["passing", "done"].includes(e.status)))
  .map((e) => {
    const file = proofPath(e);
    const needs = e.proof_needs ?? (file ? detectNeeds(file) : []);
    const blocked = needs.filter((n) => !canServe(n));
    const filtered = needsFilter ? needs.some((n) => !needsFilter.includes(n)) : false;
    return { e, file, needs, skip: !file ? "no proof script" : blocked.length ? `needs ${blocked.join("+")}` : filtered ? "filtered by --needs" : null };
  });

if (listOnly) {
  for (const p of plan) console.log(`${p.skip ? "skip " : "run  "} ${p.e.id.padEnd(40)} ${p.needs.join(",").padEnd(14)} ${p.skip ?? ""}`);
  process.exit(0);
}

const results: { id: string; ok: boolean; ms: number; tail: string }[] = [];
for (const p of plan) {
  if (p.skip) {
    console.log(`SKIP  ${p.e.id} (${p.skip})`);
    continue;
  }
  const started = Date.now();
  const cmd = p.file!.endsWith(".sh") ? ["bash", [p.file!]] : ["npx", ["tsx", "--tsconfig", path.join(root, "tsconfig.proofs.json"), p.file!]];
  process.stdout.write(`RUN   ${p.e.id} ... `);
  const r = spawnSync(cmd[0] as string, cmd[1] as string[], { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const ok = r.status === 0;
  const ms = Date.now() - started;
  // The last lines that aren't stack frames: the assertion or error text.
  const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`
    .trim()
    .split("\n")
    .filter((l) => !/^\s+at /.test(l))
    .slice(-8)
    .join("\n");
  results.push({ id: p.e.id, ok, ms, tail });
  console.log(ok ? `PASS (${(ms / 1000).toFixed(1)}s)` : `FAIL (${(ms / 1000).toFixed(1)}s)`);
  if (!ok) console.log(tail.replace(/^/gm, "      "));
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${plan.filter((p) => p.skip).length} skipped`);
if (failed.length) {
  console.log("failed: " + failed.map((f) => f.id).join(", "));
  process.exit(1);
}

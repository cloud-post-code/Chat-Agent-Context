# Testing

Three layers, from cheapest to most real. Run the first two before every PR;
the third at the end of every cleanup phase and before a deploy.

| Layer | Command | Needs | What it covers |
|---|---|---|---|
| Unit (Vitest) | `npm test` | nothing | pure logic and server-rendered markup: `tests/**`, `lib/**/*.test.ts` |
| Proofs (crosscheck) | `npm run crosscheck` | Postgres via `.env`; a model key or a running server for some | one `docs/features/<id>/proof.ts` per feature, against the real local database |
| Smoke | `PROOF_BASE_URL=http://localhost:3120 npm run smoke` | a running dev server + Postgres | signup → admin → public page → llms.txt → A2A card → chat stream → booking → account wipe |

The gate (`~/.claude/scripts/gate`) runs `npm run lint` (ESLint **and** `tsc --noEmit`),
`npm test`, then `npm run build`. It does not run proofs or the smoke: those need a
database, so run them yourself and record the result in the PR.

## Unit tests

- `vitest.config.mts` aliases `@/` to the repo root and loads `tests/setup.ts`, which
  mocks `@/lib/db` so **any database call throws**. A test that needs Postgres is a
  proof, not a test.
- Server-rendered components are checked with `react-dom/server`
  (`renderToStaticMarkup`), asserting content rather than whole-HTML snapshots so a
  style refactor doesn't trip them but a broken card does.
- `tests/lib/price.test.ts` pins the current outputs of the codebase's several
  price / duration / money parsers in a snapshot. It exists so merging those parsers is
  a no-behaviour-change refactor; update the snapshot only when a behaviour change is
  intended (`npx vitest run -u`).
- Add a test beside the feature it covers: `tests/<area>/<thing>.test.ts(x)`.

## Proofs

Every feature folder carries `FEATURE.md`, `PROOF.md` and a `proof.ts`. The proof
seeds throwaway users in the local Postgres, exercises the real code, asserts, and
cleans up. Some double the model at the Anthropic client boundary; the ones that need
a live model, a running server, or the network say so and are skipped by the runner
unless the environment can serve them.

- Run one: `npx tsx --tsconfig tsconfig.proofs.json docs/features/<id>/proof.ts`
- Run all `passing`/`done` features: `npm run crosscheck`
  (`-- --only a,b`, `-- --needs db`, `-- --list` to see the plan and why things skip)
- `tsconfig.proofs.json` is the one tsconfig for every proof and script (JSX enabled);
  `npm run typecheck:proofs` typechecks them all. Don't add per-feature tsconfigs.
  As of the 2026-09-25 audit this typecheck is red for 47 proof files (most are the
  `stale` ones below; `tsx` runs proofs without typechecking, which is how they drifted).
  It is not in the gate until those are fixed or retired.
- The runner reads what a proof needs from its imports (`db`, `model`, `http`). A
  `status.json` entry can override with `"proof_needs": [...]` and point at a script
  elsewhere with `"proof_script": "..."`.

A proof that fails because the code moved on is **stale**, and its feature's entry in
`docs/features/status.json` says so. Fix or retire it when you touch that area; never
leave a green status over a red proof.

## Smoke

Stop the dev server before running the gate: `next dev` and `next build` share `.next`,
and a build that overlaps a running dev server fails with a missing vendor chunk.


`scripts/smoke.ts` is plain HTTP against a running server (no browser automation): it
creates a throwaway account, walks the surfaces a visitor and an owner hit, and deletes
the account. Start the server with `npx next dev -p 3120` (or the `dev-3120` launch
config) and run `PROOF_BASE_URL=http://localhost:3120 npm run smoke`. The chat step
makes one real model call when the server has `ANTHROPIC_API_KEY`.

## Local database

Postgres only (`prisma/migrations` is Postgres SQL). `DATABASE_URL` in `.env`;
`npx prisma migrate deploy` brings a fresh database to the current schema, which is
also what `npm start` does on Railway through `scripts/migrate.mjs`.

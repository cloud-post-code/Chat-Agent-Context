# docs/features — the feature queue and its proofs

One folder per feature: `FEATURE.md` (what to build), `PROOF.md` (how done is
proven), `proof.ts` (the executable proof). `status.json` is the machine-readable
queue the autonomy skills read.

## Rules
- A new feature gets all three files and a `status.json` entry before implementation.
- `proof.ts` runs with `npx tsx --tsconfig tsconfig.proofs.json <path>`. No per-feature
  tsconfig; the root `tsconfig.proofs.json` covers every proof and script.
- A proof seeds throwaway users and deletes them. It never depends on the founder
  account's data or on rows another proof made.
- Pure logic belongs in a Vitest test under `tests/`, not only in the proof
  (see `docs/TESTING.md`). Source-grep checks ("panels.tsx contains X") are wiring
  notes, not tests; keep them out of `tests/`.
- Status values: `spec`, `pending`, `blocked`, `passing` (proof green), `done`,
  `unverified` (folder found without an entry; run its proof), `unproven` (no proof
  exists), `stale` (proof no longer runs against the code), `retired`
  (superseded; `superseded_by` names the successor).
- `npm run crosscheck` runs every `passing`/`done` proof. Optional entry fields:
  `proof_needs: ["db"|"model"|"http"]` overrides detection; `proof_script` points
  at a proof that isn't at `<dir>/proof.ts`.
- Model-cost proofs (`live.ts`, `crosscheck.ts`, `--live`) are opt-in and documented in
  their `PROOF.md`; never wire them into the gate.

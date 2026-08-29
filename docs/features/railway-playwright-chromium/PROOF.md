# Proof Plan

## Definition Of Done
- `nixpacks.toml` exists and (a) runs
  `npx playwright install --with-deps --only-shell chromium` in a build
  phase after `install`, (b) pins `PLAYWRIGHT_BROWSERS_PATH=/app/.playwright`
  and `CRAWLER_NO_SANDBOX=1` as image variables.
- `railway.json` still builds with NIXPACKS and starts with `npm run start`;
  the `start` script still runs migrations before `next start`.
- With browsers present at the path named by `PLAYWRIGHT_BROWSERS_PATH` and
  `CRAWLER_NO_SANDBOX=1` (the production configuration), the crawler renders
  a JS-only page — content that exists only after script execution is
  extracted, which plain fetch can never produce.
- With `PLAYWRIGHT_BROWSERS_PATH` pointing at an empty directory (no
  browsers), the crawler still returns the static HTML via the fetch
  fallback and logs a warning naming the launch failure.

## Primary Proof
Type: integration

Command:
```bash
npx tsx docs/features/railway-playwright-chromium/proof.ts
```

The script checks the deploy config assertions, then serves a fixture page
whose marker text is injected only by an inline `<script>`, and runs the real
`Crawler` twice in subprocesses: once with the production env (browsers path
+ sandbox off) asserting the script-injected marker is extracted, and once
with an empty browsers path asserting the fetch fallback returns the static
marker only and a fallback warning is printed. Prints `PROOF PASS` or
exits 1.

Secondary guards:
- `npx tsc --noEmit` clean.

## Not provable locally
Actual Railway build-image size and build time; verify on the first deploy
(expect roughly +250–400 MB and +1–2 min for the headless shell + apt deps).

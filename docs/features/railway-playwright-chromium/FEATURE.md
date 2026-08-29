# Railway: Playwright Chromium in the production image

## Problem
The guided onboarding crawler (`lib/onboarding/crawl.ts`) renders pages with
Playwright Chromium and silently falls back to plain `fetch` when no browser
can launch. The Railway service builds with Nixpacks and nothing installs the
Chromium browser binaries, so production always takes the fetch fallback and
JS-rendered sites extract poorly.

## Desired behavior
- The Railway Nixpacks build installs Playwright's Chromium (headless shell)
  and its system libraries into the deploy image.
- Browser binaries live at a fixed path inside the app dir
  (`PLAYWRIGHT_BROWSERS_PATH=/app/.playwright`) so the runtime finds them
  regardless of `HOME`.
- Chromium can actually launch in the Railway container: containers run as
  root, where Chromium's setuid sandbox cannot start, so the crawler disables
  the sandbox when `CRAWLER_NO_SANDBOX=1` (set only in the deploy image;
  local dev keeps the sandbox).
- The fetch fallback stays intact for environments without browsers, but is
  no longer silent: it logs one warning with the launch error so a prod
  regression is visible in logs.
- The existing boot is untouched: `npm run start` still migrates then serves.

## Constraints
- Only the headless shell is installed (`--only-shell`) to keep image size
  down; `chromium.launch({ headless: true })` on Playwright ≥1.49 uses the
  headless shell, so that is exactly what the crawler needs.
- No change to extraction logic or the crawler's origin pinning.

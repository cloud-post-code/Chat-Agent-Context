# Proof Plan — Persona prompt handoff

## Definition Of Done
- The Persona tab shows an explanation plus **Copy prompt** and **View prompt**,
  above the field the answer is pasted into.
- The prompt body stays hidden until **View prompt** is pressed.
- The text served is exactly `docs/prompts/persona-extraction.md`, whole.
- The block makes no network calls.

## Primary Proof
Type: integration (renders the real component; no browser, no database)

Command:
```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/persona-prompt-handoff/proof.ts
```

The `--tsconfig` flag is required, not incidental: the app's `tsconfig.json`
sets `"jsx": "preserve"` because Next compiles the JSX itself, so under `tsx`
the component's JSX would emit `React.createElement` against a `React` binding
the component never imports (Next uses the automatic runtime). The proof-local
tsconfig turns on `"jsx": "react-jsx"` for this run only, leaving the app's
config and the component's idiomatic imports alone.

Expected evidence:
- `All proof assertions passed`, exit 0.

### Assertions
1. **Prompt file present** — non-empty and over 1000 chars.
2. **It is the extraction prompt** — starts with
   `# Personal Persona Extraction Prompt`.
3. **The whole document is there** — a marker from a late section
   (`Choose exactly three words that describe me`) is present, so a truncated
   file fails.
4. **The loader serves it verbatim** — `personaExtractionPrompt()` equals the
   file's trimmed contents.
5. **The loader caches** — a second call returns the identical string.
6. **The explanation names the assistants** — "ChatGPT, Claude or Gemini".
7. **It says where the answer goes** — paste it into the Persona field.
8. **Copy button rendered.**
9. **View button rendered.**
10. **Prompt hidden while collapsed** — the deep marker from assertion 3 does
    NOT appear in the collapsed markup. This is the one that would catch
    dumping 900 lines into the tab by default.
11. **No network calls** — no `fetch` / `XMLHttpRequest` / `axios` in the
    component; the prompt arrives as a prop.

Secondary guards:
- `$HOME/.claude/scripts/gate` (build + typecheck + lint).

## Red Expectation
Before implementation the script fails at import: `app/admin/PersonaPrompt.tsx`
and `lib/personaPrompt.ts` do not exist.

## Environment And Data
- No database, no API keys, no running server. The block is a pure function of
  the prompt file.
- `process.chdir(root)` in the proof, because `lib/personaPrompt.ts` resolves
  the file against `process.cwd()`.

## Anti-Gaming Constraints
- Assertion 10 must stay a negative check on the *collapsed* render. Asserting
  only that the buttons exist would pass on a block that shows the whole prompt
  unconditionally.
- Assertion 3's marker must come from late in the document, not the heading —
  a heading check alone passes on a truncated file.
- The component must be rendered, not string-matched as source. Only the
  no-network check reads source, and only because absence of a call is not
  observable in markup.

## Manual Gaps
- **Not clicked through in a browser.** `/admin/dashboard` is behind a password
  and Claude does not enter credentials, so the actual click on Copy/View — and
  the clipboard write itself — is unverified. `navigator.clipboard` also needs a
  secure context, which is worth one manual check on the deployed HTTPS site.
  The denied-clipboard path (expand the prompt instead of failing silently) is
  likewise unexercised. Same limitation as every other admin tab in this repo.

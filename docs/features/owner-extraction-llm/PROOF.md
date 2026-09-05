# Proof — Owner Extraction (LLM prompt, multi-owner)

## Primary proof
```
npx tsx docs/features/owner-extraction-llm/proof.ts
```
No server, DB, network, or model key required — the proof exercises
`lib/onboarding/owners.ts` directly with fixture pages and a stubbed crawler, with
`ANTHROPIC_API_KEY` unset so the deterministic path is what runs.

## What it proves
- **Prompt contract**: `OWNERS_SYSTEM_PROMPT` names the About/Team/Our Story/Staff/
  Contact page hint, allows many owners, forbids guessing, and pins the exact JSON
  shape `{"owners":[{"name":"","role":""}]}`.
- **Discovery**: with a stubbed crawler, `discoverOwnerPages` follows nav links whose
  text says About/Team/Our Story/Staff and the common paths; offsite links are
  excluded; no URL is loaded twice.
- **Fallback parsing** (`parsePageOwners`):
  - `Owner: Jane Smith` label form → Jane Smith / Owner.
  - "founded by Maria Lopez and Ana Lopez" prose → both names.
  - "owned and operated by Sam Green" prose → Sam Green.
  - `Priya Patel, Co-Owner` bio-heading form → Priya Patel / Co-Owner.
  - Text with no ownership language → empty list (never invents).
- **Multi-owner + dedupe**: `extractOwners` over several fixture pages returns every
  distinct owner once — the same name on two pages is one entry (case-insensitive).
- **Sanitizer**: malformed model JSON (non-array, entries without names, >12 entries)
  is reduced to a clean bounded `Owner[]`.
- **owner_name mapping**: `ownersToOwnerName` joins distinct names with ", " and is ""
  for an empty list.
- **No-key path**: with `ANTHROPIC_API_KEY` unset, `extractOwners` resolves without a
  network call and returns the fallback result.

## Secondary guards (not proof)
- `npx tsc --noEmit`, `npm run lint`
- Repo safety gate: `$HOME/.claude/scripts/gate`

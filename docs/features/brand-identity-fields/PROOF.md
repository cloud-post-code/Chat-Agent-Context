# Proof Plan — Brand identity fields

## Definition Of Done
- `extractBrandIdentity(pages, log, extract?)` returns `{tagline,
  taglineSource, values, tone}` with grounded-only semantics: an extracted
  tagline keeps `"extracted"`, a generated one is flagged `"suggested"`, an
  invalid source flag coerces to `"suggested"` (never `"extracted"`), an
  empty tagline forces the flag empty, values clamp to 5 trimmed strings,
  junk entries drop.
- `savePersonaBrand(userId, brand)` persists tagline/taglineSource/
  brandValues/toneOfVoice onto `PersonaConfig` (create and update paths).
- `buildSystemPrompt(userId)` includes brand values and tone of voice when
  set, and omits the blocks when empty.
- The onboarding theme stage carries `stepBrand` on the job payload and the
  save route accepts a `brand` key (exercised at module level; browser
  click-through is a manual gap).

## Primary Proof
Type: integration (local Postgres; model call injected — zero Anthropic
calls, zero network)

Command:
```bash
npx tsx docs/features/brand-identity-fields/proof.ts
```

Expected evidence: all assertions green. Red state before implementation:
module not found (`lib/onboarding/brand.ts`, `lib/brand.ts`).

Secondary guards:
- `npx tsc --noEmit`, `npm run lint`, `npm run build`
- Repo gate: `$HOME/.claude/scripts/gate`

## Environment And Data
- `DATABASE_URL` reachable; the proof uses a throwaway `proof-brand-<uuid>`
  user and deletes its rows after.
- No `ANTHROPIC_API_KEY` needed — the extract function is injected.

## Anti-Gaming Constraints
- Do not special-case proof inputs in product code.
- The coercion rules (invalid source → `"suggested"`, empty tagline → empty
  source) live in the product module, not the proof.
- Do not weaken FEATURE.md's suggested-vs-extracted labeling to pass.

## Manual Gaps
- The onboarding theme card and dashboard Theme tab rendering the fields
  needs an authenticated browser session (admin login; Claude does not enter
  passwords). Verified instead by server-rendered markup checks where
  feasible and by code review.

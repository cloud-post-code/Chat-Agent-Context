# Proof Plan — Social Media As Its Own Onboarding Extraction Step

## Definition Of Done
- `lib/onboarding/social.ts` exists following the sibling-extractor shape:
  `SOCIAL_SYSTEM_PROMPT`, candidate collection over crawled pages' offsite
  anchors, and `extractSocialLinks(pages, log, extract?)` where `extract` is
  the injectable model seam (defaulting to `llmExtract`).
- The sanitizer only keeps URLs copied exactly from the candidate list
  (hallucinated URLs are dropped), lowercases platforms, dedupes, caps, and
  never throws on junk shapes.
- Pages with no offsite anchors return `[]` without a model call.
- `lib/socialLinks.ts` persists reviewed links as JSON in the new
  `Profile.social_links` column; re-saving replaces, never stacks.
- Prompt + index integration: `lib/knowledge.ts` renders the links in the
  HOW TO CONNECT block and `indexProfile` includes them in profile prose.

## Primary Proof
Type: integration (repo-native proof script over the real DB; fixture Pages
built with cheerio; the model doubled only at the injectable `extract` seam)

Command:
```bash
npx tsx docs/features/social-media-extraction/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- A throwaway user's Profile row observed carrying the saved JSON, then
  cleaned up.
- Red run recorded before implementation: the script fails to import
  `lib/onboarding/social.ts`.

Secondary guards (not proof):
- `~/.claude/scripts/gate` (typecheck/lint/build) covers the flow wiring
  (jobs.ts stage gating — untestable under tsx because jobs pulls next/font —
  the advance route stage union, OnboardingFlow steps, admin textarea).

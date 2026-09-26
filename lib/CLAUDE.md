# lib/ — everything server-side

Nothing in `lib/` imports from `app/`. Client components import only
prisma-free modules from here (see the test in `tests/arch/`).

## Entry points
| Concern | Module |
|---|---|
| visitor chatbot: canned answer → prompt → tool loop | `brain.ts` (`answer()`), prompt in `knowledge.ts` |
| admin copilot (`/admin/chat`) | `adminBrain.ts`, elements in `adminElements.ts` / `adminElementsLoad.ts` |
| retrieval: chunk, embed, entities, graph, search | `retrieval/` (`indexer.ts` writes, `search.ts` reads) |
| onboarding: read a site into the account | `onboarding/jobs.ts` runs the stages; `onboarding/save.ts` writes; `onboarding/knowledgeLlm.ts` is the extraction helper |
| A2UI cards: hydrate tool blocks / card catalog / AI card builder | `cards.ts` / `uiCards.ts` / `cardBuilder.ts`; the filters behind the composable cards in `photoIndex.ts`, `projectIndex.ts`, `social.ts` (tokenizer `terms.ts`); first-run set `onboarding/cards.ts`; gap-fill `siteCards.ts` |
| ingestion sources and items | `ingestionSources.ts` (catalog), `ingestedItems.ts` (read), `customIngest.ts` (write) |
| accounts: passwords, sessions, login (`authenticate`), signup, operator tools, wipe | `auth.ts`, `users.ts`, `accountAdmin.ts`, `accountWipe.ts` (covered by `tests/lib/accountWipe.test.ts`) |
| Claude | `claude/index.ts` — the only Anthropic client (`claudeModel()`, `cardBuilderModel()`, `textOf`); `claude/retry.ts` — `modelCall`, the shared gate with 429/529 backoff |
| Prisma | `db.ts` — the only client, plus `getProfile` / `getPersonaConfig` / `getThemeConfig` upserts |
| theme, fonts, brand voice | `theme.ts`, `fonts.ts`, `brand.ts` (voice, not visuals) |
| A2A protocol | `a2a/` (`rpc.ts` dispatch, `run.ts` over `brain.ts`) |
| llms.txt | `llms.ts` |
| shared helpers (text, images, async) | `util/` — the only place for generic helpers; `util/index.ts` holds the request helpers (`clientIp`, `siteOrigin`, `safeJson`) |

## Invariants
- No new local copy of `str` / `flat` / `slugify` / `sniffImageType` / `sleep` /
  `textOf`: import them from `lib/util/*` or `lib/claude/` (`textOf`). `authSecret()` in
  `lib/auth.ts` is the one HMAC key accessor. `str`/`flat` take `(value, max)`: never
  pass them point-free to `.map` (the index would become the cap) — write `(v) => flat(v)`.
- Every tenant-scoped read or write takes `userId`. No query without it.
- `brain.ts` is the one brain; web chat and A2A are transports over it.
- Model calls take an injectable `deps.client` so proofs can double the model.
- `accountWipe.ts` must clear every per-user table (its proof seeds one row in each).

## Theme rules (from the retired BRAND.md; `theme.ts` enforces them)
- Three admin colors (background / primary / accent) are the source of truth; every
  other token derives from them. Flat solid fills, no gradients.
- One text color per fill: background, bg-soft, surface and accent each own exactly
  one foreground (`--on-*`). Secondary text is that same color in italics, never a
  fourth muted grey. `normalizeExtractedTheme` keeps extracted palettes readable.
- Fonts: heading / body / mono from `fonts.ts`; the tenant picks presets in the
  Theme panel.

## Testing
`npm test` covers the pure parts (`tests/lib/*`). Anything touching Postgres is a
feature proof: `npm run crosscheck -- --only <feature-id>`.

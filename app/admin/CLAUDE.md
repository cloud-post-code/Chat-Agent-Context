# app/admin — the owner's control room

Two entry pages share one panel set: `/admin/dashboard` (nav groups + sub-tabs) and
`/admin/chat` (the copilot reveals panels and single elements by key). `/admin` is
the login; `/admin/onboarding` the first-run flow; `/admin/sources/[key]` edits one
ingestion source behind a second password.

## Layout
| Concern | Where |
|---|---|
| server actions, one module per domain | `actions/{auth,accounts,profile,content,chat,graph,canned,directives,cards,ingestion,booking}.ts`; `actions/_shared.ts` holds `requireUser`, `revalidateAll`, `isUpload`, `reindex`, `toData` (not a `"use server"` file) |
| data every panel reads | `panels/queries.ts` → `loadAdminData(user, query)`; `AdminData` is its return type |
| panel composition (`buildAdminPanels`) | `panels/index.tsx`; Profile / Persona / Theme / Activity are their own components beside it, the rest are the `*Panel.tsx` files in this folder |
| nav registry (groups, sub-keys, aliases, deep links) | `lib/admin/contentTabs.ts` (shim at `./contentTabs.ts`); keys are the contract shared by `?tab=`, `flat[key]` and the copilot's `show_panel` |
| element reveal (one booking / order / goal / …) | `elements.tsx` over `lib/adminElements.ts` |
| copilot | `chat/AdminChat.tsx` over `lib/adminBrain.ts` |
| shared styles | `ui.tsx` (`panel`, `field`, `btn*`, `SectionTitle`, `Label`) |

## Rules
- A server action: `"use server"` file, `const user = await requireUser()` first,
  every query scoped by `user.id`, then `revalidateAll()` (never only
  `/admin/dashboard` — the chat renders the same panels and went stale).
- Add a panel: a component in this folder, data added to `loadAdminData`, the key
  registered in `NAV_GROUPS`, `flat[key] = …` in `panels/index.tsx`.
- Client components import only prisma-free modules (`lib/*.shared.ts`,
  `lib/*.parse.ts`, `lib/*.tools.ts`); `tests/arch/clientImports.test.ts` enforces it.
- No new style-object sets; use `ui.tsx`.

## Testing
`npm test` (`tests/admin/*`) covers the nav registry, SubTabs, home items, pagination,
the source builder and the persona prompt. Panels that need data: the proofs
(`admin-chat-a2ui`, `copilot-element-reveal`, `admin-nav-groups`) and `npm run smoke`.

# Composable card elements: small, filtered cards instead of fixed whole ones

## Summary
The visitor chat (`lib/brain.ts`) answers with cards, but almost every card tool draws a
fixed, whole element: `show_gallery` returns every curated photo, `show_services` every
service, `show_projects` every project, `show_booking` the whole wizard, and social links
never become a card at all (only prose in HOW TO CONNECT). Only `show_menu` is filtered
today (`keys`, `tags`, `category`, `title` over a MENU INDEX, `filterMenu` in code). This
feature makes every element small and variable by default, selected to the exact need of the
moment, and lets several small elements compose into one answer — the same pattern
`filterMenu` + MENU INDEX already proves, and the same shape as the admin copilot's element
registry (`lib/adminElements.ts`: facets, `selectElements`, `elementIndexLines`).

## Desired Behavior
- "pictures of nails" → a gallery card with a few matching nail photos, not the whole
  gallery.
- "red nails" → only the red ones (tag-filtered, ANDed against caption words too, so an
  untagged photo whose caption says "red gel nails" still matches).
- "book" two turns after seeing red nail photos → the booking wizard narrowed to the
  services closest to those photos (`narrowed: true`), never an empty wizard.
- "price for a gel manicure" → that service with its price, plus two or three similar ones
  under a "Similar" heading (`focusIds`).
- "instagram?" → only the Instagram link, not Facebook too.
- A filter that matches nothing draws no card; the tool result names what IS on file (tag
  vocabulary, or "no close matches; showing neighbours" for booking) so the model can retry
  or answer in text instead of showing an empty or wrong card.
- No arguments on a list tool still means "everything" (canned answers, starter chips, and
  `CannedAnswer.cardInput` depend on this): empty filter → all items, no limit.
- Several small cards can stack in one reply (e.g. matching photos + the services closest to
  them + a narrowed booking card) — composition is several small blocks in one bubble, not a
  new block type.
- Card memory: what a card showed on turn N (`shown`) rides in the message history sent back
  to the model on turn N+2, so "book that" after "red nails" can resolve to the nails
  services without re-asking.

## Scope
Implementation is out of scope for this file (owned by later phases). This spec fixes the
contract every phase builds to.

## Non-Goals
- No new composite block type — composition is several existing small blocks stacked in one
  chat bubble; `Chat.tsx`'s `Bubble` already renders blocks in order.
- No embeddings for "similar" — category match plus IDF term overlap only.
- No change to `show_menu` / `filterMenu` (already filtered) beyond reuse of its pattern.
- No change to how `CannedAnswer.cardInput` is interpreted: unchanged meaning, no filter =
  everything, no limit.

## Contract
This is the shared contract every implementing agent builds to exactly (verbatim from the
team's contract note).

Repo: Next 15, React 19, Prisma/Postgres, `@anthropic-ai/sdk`. Conventions: pure modules are
import-free (see `lib/menuTypes.ts`, `lib/adminElements.ts`); sanitizers never throw;
hydrators return `null` when nothing matches; tenant scoping by `userId`; ≤100 lines per
function; 100-char lines; zero tsc/lint warnings. No test runner — proofs are
`docs/features/<id>/proof.ts` run with `npx tsx`.

### `lib/terms.ts` — pure
```ts
export function meaningfulWords(text: string): string[]
  // lowercase; split on non-letters/digits; drop stopwords and words < 3 chars; light stem
  // (trailing "ies"->"y", "es", "s", "ing"); dedupe, first-seen order.
export function idfWeights(docs: string[][]): Map<string, number>   // log((N+1)/(df+1))+1
export function overlapScore(query: string[], doc: string[], idf?: Map<string, number>): number
  // sum of idf (or 1) over shared terms
```
(`lib/booking/matchImages.ts` keeps working; it may import `meaningfulWords` from here.)

### `lib/photoIndex.ts` — pure, imports only `lib/terms.ts`
```ts
export type PhotoMeta = { id: string; src: string; caption: string; description: string; tags: string[] };
export type PhotoFilter = { ids?: string[]; tags?: string[]; query?: string; limit?: number };
export function parsePhotoTags(raw: unknown): string[]          // JSON string or array -> lowercase trimmed unique strings, never throws
export function isEmptyPhotoFilter(f: PhotoFilter): boolean       // no ids, no tags, no query
export function filterPhotos(items: PhotoMeta[], f: PhotoFilter): PhotoMeta[]
  // EMPTY FILTER => return ALL items, NO limit (canned rows depend on this).
  // ids: caller order, unknown dropped. tags: ANDed; a tag matches if in item.tags OR in meaningfulWords(caption+description).
  // query: overlapScore(meaningfulWords(query), meaningfulWords(caption+" "+description) ∪ tags) > 0, sorted by score desc then original order.
  // limit applies only when filter non-empty: default 6, max 12, min 1.
export function photoIndexLines(items: PhotoMeta[], cap = 3000): string  // "" when none; lines "- <id> | <caption ≤60 chars> | tag1, tag2"; "- … and N more" tail when over cap
export function tagVocabulary(items: PhotoMeta[]): string[]     // unique tags, by frequency desc, max 40
```

### `lib/serviceIndex.ts` — pure, imports only `lib/terms.ts`
```ts
export type ServiceMeta = { id: string; name: string; description: string; category?: string; priceLabel?: string; priceAmount?: number | null; tags?: string[] };
export type ServiceFilter = { ids?: string[]; category?: string; query?: string; limit?: number };
export function serviceTerms(s: ServiceMeta): string[]   // words(name) ∪ words(description.slice(0,200)) ∪ tags
export function isEmptyServiceFilter(f: ServiceFilter): boolean
export function filterServices<T extends ServiceMeta>(items: T[], f: ServiceFilter): T[]
  // empty filter => all, no limit. ids ordered/unknown dropped; category case-insensitive exact; query = idf-weighted overlapScore > 0 sorted desc; limit only with a filter (default 6, max 12).
export function similarServices<T extends ServiceMeta>(items: T[], focus: T[], n: number): { items: T[]; close: boolean }
  // score = 3*[same non-empty category] + 2*Σidf(shared name terms) + Σidf(shared description terms) + 0.5*[both priceAmount and within ±40%]; excludes focus; stable by catalog order; never empty when n>0 and other items exist: if all scores 0 -> next n in catalog order with close=false.
export function serviceIndexLines(items: ServiceMeta[], cap = 3000): string  // "- <id> | <name> | <category> | <priceLabel> | term1, term2" (≤6 terms); "" when none; "… and N more" tail
export type ProjectFilter = { ids?: string[]; tags?: string[]; query?: string; limit?: number };
export function filterProjects<T extends { id: string; name: string; blurb: string; tags: string[] }>(items: T[], f: ProjectFilter): T[]  // same semantics as filterPhotos
```

### `lib/social.ts` — imports `lib/db` + `lib/socialLinks`
```ts
export type SocialBlock = { type: "social"; title?: string; items: { platform: string; url: string }[] };
export function normalizePlatform(p: string): string   // lowercase trim; aliases: ig|insta->instagram, fb->facebook, x->twitter, yt->youtube, li->linkedin, tt->tiktok
export function filterSocialLinks(links: SocialLink[], platforms?: string[]): SocialLink[]  // empty/undefined => all; else platform in normalized set
export async function socialBlock(userId: string, input: Record<string, unknown>): Promise<SocialBlock | null>  // null when no links match
export async function hasSocialLinks(userId: string): Promise<boolean>
```

### `UiBlock` changes (`lib/cards.ts`, mirrored in `app/cards/Cards.tsx`)
All new fields OPTIONAL.
```
gallery:  { type:"gallery"; layout:"carousel"|"filmstrip"; title?: string; items: PhotoCard[] }  PhotoCard gains tags?: string[]
services: { type:"services"; title?: string; focusIds?: string[]; items: ServiceCard[]; booking: ServiceBooking|null }  (booking.flow.services narrowed to items when focusIds present)
projects: { type:"projects"; title?: string; items: ProjectCard[] }
booking:  { type:"booking"; fields; flow; narrowed?: boolean; allServicesCount?: number }
social:   SocialBlock (from lib/social.ts, re-exported by lib/cards.ts)
```

### Tool inputs (`lib/brain.ts`)
```
show_gallery  { layout (required, enum), ids?: string[], tags?: string[], query?: string, limit?: integer, title?: string }
show_services { ids?: string[], category?: string, query?: string, similar?: integer(0-4), limit?: integer, title?: string }
show_projects { ids?: string[], tags?: string[], query?: string, limit?: integer, title?: string }
show_booking  { service?: string, services?: string[], query?: string }
show_social   { platforms?: string[], title?: string }   // gated on hasSocialLinks(userId)
```
`hydrate()` returns `{ block: UiBlock | null; summary: string }`. Tool-result strings:
`"Rendered N photos: <id> (<caption>), …"` | `"No photos match. Tags on file: a, b, c"` |
`"Rendered N services: <id> (<name>, <price>), …"` | `"…; no close matches, showing
neighbours"` | `"Rendered booking with N of M services"` | `"Rendered N social links:
instagram, …"` | `"No social links for: tiktok"`.

### Wire / card memory
```ts
export type ShownCard = { type: string; ids?: string[]; tags?: string[]; title?: string };   // lives in lib/brain.ts
Msg = { role: "user"|"assistant"; content: string; shown?: ShownCard[] }
```
`Chat.tsx` derives `shown` from each assistant message's cards: gallery -> ids of items;
services -> ids; projects -> ids; social -> ids = platforms; booking -> `{type:"booking"}`;
cap 4 cards/message, 12 ids/card. `route.ts` sanitizes `shown` (types string ≤20, ids strings
≤64 chars, caps). `runModel` renders history assistant content as:
```
content + "\n\n[shown: gallery ids=p1,p2 tags=red,gel · services ids=s1]"   (only when shown non-empty)
```
Never displayed or logged.

### Prompt sections (`lib/knowledge.ts`)
- `"PHOTO INDEX (id | caption | tags):"` whenever curated photos exist — exactly when
  `show_gallery` is offered (replaces the count-only PHOTOS block).
- `"SERVICE INDEX (id | name | category | price | terms):"` whenever services are on file.
- `"COMPOSING CARDS:"` paragraph appended by `cardRulesSection` (present even when only
  booking/social tools exist).

## Scenarios
1. **Nails photos.** Visitor: "show me pictures of nails". Model calls
   `show_gallery {layout, tags:["nails"]}` (or `query:"nails"`). A gallery card renders a few
   matching photos, not all 8 in the fixture.
2. **Red nails.** Visitor: "just the red ones". Model calls
   `show_gallery {layout, tags:["nails","red"]}`. Gallery card ids are exactly the red-tagged
   nail photos plus the untagged photo whose caption says "red gel nails" — four ids total in
   the fixture.
3. **Book after red nails.** Two turns later the visitor says "book that". The history sent to
   the model carries `[shown: gallery ids=…]` for the red-nails turn; the model calls
   `show_booking {query:"red gel nails"}` (or `services:[...]` copied from the shown ids). The
   booking card's `flow.services` is narrowed to the nails-category services, `narrowed: true`.
4. **Price of gel manicure + similar.** Visitor: "how much is a gel manicure?". Model calls
   `show_services {ids:["<gel id>"], similar:2}`. Services card `focusIds` is `["<gel id>"]`,
   `items` is the gel manicure plus two other "nails"-category services, none from other
   categories.
5. **Instagram only.** Visitor: "do you have instagram?". Model calls
   `show_social {platforms:["instagram"]}` (offered because the profile has
   links). The social card has exactly one item, the
   Instagram link.

## Constraints
- Empty filter on any list tool means "everything", no limit — canned answers and starter
  chips depend on this and must keep working unmodified.
- Tag/category matching is case-insensitive; `query` matching is deterministic IDF-weighted
  term overlap, not the model's own judgment of similarity.
- A filter that matches nothing never renders an empty or wrong card; the tool result gives
  the model enough information (tag vocabulary, "no close matches") to retry once or explain.
- Card memory is server-side text folded into history, never displayed, never logged raw
  (`recordTurn` logs `spoken` only).
- `similarServices` is never empty when other services exist and `n > 0`, even if no service
  shares a category or term — it falls back to the next `n` in catalog order with
  `close: false`.
- Every new field on every block/tool type is optional so stored canned-answer card inputs
  keep working without changes.
- Follows `lib/brain.ts` conventions: injectable model client, bounded loop, NDJSON events.

## Implementation Routing
- Required skills: coding-frontend, coding-python-backend (n/a — TS backend, use
  coding-feature-execute), coding-proof-author.

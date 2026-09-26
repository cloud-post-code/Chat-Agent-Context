# Proof Plan — Canonical URLs and per-host correctness

## Definition Of Done
- `canonicalOrigin(user)` exists in `lib/customDomains.ts` and returns the
  tenant's `live` custom domain origin when one exists, else
  `<platform origin>/a/<slug>`. Every absolute URL about a tenant is built from
  it — no route constructs one by hand.
- `siteOrigin()` in `lib/util.ts` only trusts a host-derived origin when that
  host is the configured platform domain or a `live` custom domain. An
  unrecognized `X-Forwarded-Host` no longer produces an arbitrary origin.
- `app/layout.tsx` no longer calls `siteOrigin()` with no arguments; the agent
  page supplies its own `metadataBase` and `openGraph.url` from
  `canonicalOrigin(user)`.
- `/a/<slug>` emits `<link rel="canonical">` to the custom domain when the
  tenant has a live one, and keeps serving normally (no redirect).
- A custom domain serves a `robots.txt` and `sitemap.xml` describing only that
  tenant; the platform domain serves its own.
- The `/.well-known/*` discovery documents, `/api/a2a` GET and `/agent` describe
  the host's tenant on a live custom domain, and the founding user on the
  platform domain — replacing the unconditional `foundingUser()` at those call
  sites.
- Admin's "view your agent" link and the directory entry show the custom domain
  once live.

## Primary Proof
Type: api (black-box HTTP against a running dev server, driving real `Host`
headers and reading the real documents the server returns) with an integration
block for `canonicalOrigin`/`siteOrigin` over the real DB

Command:
```bash
npx tsx docs/features/custom-domain-canonical-urls/proof.ts
```

Expected evidence:
- All `PASS` lines, exit code 0.
- Persisted rows observed then cleaned up: two throwaway users, one with a
  `live` custom domain and one without.
- `canonicalOrigin` asserted for: a tenant with a live domain, a tenant with
  none, and a tenant whose domain is not `live` (must fall back to the platform
  path).
- `siteOrigin` asserted to reject an unrecognized `X-Forwarded-Host` while
  honoring the platform host and a live custom domain.
- Against a running server:
  - the agent card at `/.well-known/agent-card.json` fetched with the custom
    domain's `Host` names **that** tenant, with interface URLs on that host;
  - the same path on the platform host still names the founding user;
  - `/a/<slug>` for a tenant with a live domain contains a `rel="canonical"`
    pointing at the custom domain, and still returns 200;
  - `/a/<slug>` for a tenant without one contains no foreign canonical;
  - `robots.txt` and `sitemap.xml` on the custom domain mention only that
    tenant, and the sitemap contains no other tenant's slug;
  - a request with `X-Forwarded-Host: evil.invalid` does not produce a card
    advertising `evil.invalid`.
- Red run recorded before implementation: the script fails to import
  `canonicalOrigin` from `lib/customDomains`.

Secondary guards:
- `npx tsc --noEmit` clean.
- `npx tsx docs/features/a2a-agent-interface/proof.ts` still green — the
  existing A2A contract must not regress.
- `grep` shows no remaining `siteOrigin()` call with no arguments in
  `app/layout.tsx`.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), loaded by the script itself.
- `PROOF_BASE_URL` (default `http://localhost:3100`) for the HTTP block. When no
  server is reachable, the HTTP block reports `SKIP`; the integration block must
  still pass, so the script never reports success on an empty run.
- The HTTP block requires a server started **without** `NEXT_PUBLIC_SITE_URL`
  pinned to a fixed value, since a pinned configured origin deliberately
  short-circuits host derivation. The script asserts this precondition and
  `SKIP`s the host-derived assertions if it does not hold, naming the reason.
- All rows are created under throwaway users
  (`proof-canonical-a@example.invalid`, `…-b@example.invalid`) and deleted in a
  `finally`.

## Anti-Gaming Constraints
- The card, robots, sitemap and canonical assertions must read what the real
  server returned over a real `Host` header. Calling `agentCardV1()` directly
  does not prove per-host tenant selection.
- The spoofed-host assertion must observe the served document, not a unit call
  to `siteOrigin`.
- The "founding user unchanged on the platform host" assertion is mandatory —
  a per-host card that broke the legacy A2A surface would not be done.
- `canonicalOrigin` must read the domain row; the proof may not stub it.
- Do not weaken `FEATURE.md`: in particular, do not satisfy the canonical
  requirement by 301-redirecting `/a/<slug>`, which the spec excludes because it
  would break the directory and existing bookmarks.
- The proof must not tighten or change `/api/uploads/[name]` behavior; that
  surface is explicitly out of scope and left exactly as permissive as it is.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Real Open Graph rendering by a third-party scraper (Slack, iMessage, X) against
  a real custom domain — not reproducible locally; the proof asserts the emitted
  metadata, not the remote renderer's interpretation.
- Google's actual OAuth `redirect_uri` acceptance, which requires the live
  client configuration; the proof asserts the URI we build is the platform's and
  host-independent.
- Search-engine canonical consolidation, which is observable only over weeks.

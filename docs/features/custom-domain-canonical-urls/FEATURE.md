# Feature — One agent, one address: canonical URLs and per-host correctness

## Why

Once a custom domain serves a tenant's agent, the same page is reachable at two
addresses: `https://smilecare.com/` and `https://platform.com/a/smilecare`. Left
alone, that duplication leaks in several directions at once.

Search engines index both and split the ranking. Open Graph previews built from
`app/layout.tsx:18` use `metadataBase: new URL(siteOrigin())` — called with **no
headers argument**, so it resolves to `NEXT_PUBLIC_SITE_URL` or, unset, to
`http://localhost:3000`; either way a link shared from `smilecare.com` shows the
platform's image, not the tenant's. The A2A agent card at
`app/.well-known/agent-card.json/route.ts:21` advertises `siteOrigin(req.headers)`
for the **founding user** regardless of which host asked, so a custom domain
publishes a card describing someone else's agent. And visitor chat
history lives in `localStorage` keyed `chats:<slug>` (`lib/chatStore.ts:43`) —
which is per-origin, so moving a tenant to a custom domain silently strands
every returning visitor's conversations.

None of these break the page. All of them make the product feel wrong in ways
that are hard to diagnose later. This feature makes every absolute URL, every
piece of metadata, and every host-derived decision correct for the host that
actually served the request.

## Summary

The tenant's live custom domain becomes the canonical public address for their
agent. Metadata, canonical links, sitemap, robots, the A2A agent card, and OAuth
redirects all reflect the host that served the request and the tenant that host
belongs to — and the platform's `/a/<slug>` path points search engines at the
custom domain rather than competing with it.

## Desired Behavior

- **A per-tenant canonical origin.** `lib/customDomains.ts` gains
  `canonicalOrigin(user)`: the tenant's live custom domain when one exists,
  otherwise `<platform origin>/a/<slug>`. Every absolute URL about a tenant is
  built from this one function.
- **`siteOrigin()` becomes host-aware and safe.** It keeps preferring an
  explicitly configured origin for the platform's own surfaces, but the
  host-derived branch only trusts a hostname that is either the configured
  platform domain or a `live` custom domain. An arbitrary `X-Forwarded-Host` no
  longer produces an arbitrary advertised origin — closing the existing weakness
  at `lib/util.ts:32` rather than widening it.
- **OG and metadata follow the host.** `app/layout.tsx` stops calling
  `siteOrigin()` with no arguments; the agent page supplies its own
  `metadataBase` and `openGraph.url` from `canonicalOrigin(user)`, so a link
  shared from `smilecare.com` previews as SmileCare with SmileCare's logo.
- **`/a/<slug>` defers to the custom domain.** When a tenant has a live domain,
  the platform-path page emits `<link rel="canonical">` to the custom domain.
  The path keeps working — bookmarks and the directory must not break — it
  simply stops competing for the same content in search results.
- **Robots and sitemap per host.** A custom domain serves a `robots.txt` and a
  `sitemap.xml` describing that tenant's agent only, and never the platform's
  directory or other tenants' pages. The platform domain keeps serving its own.
- **The A2A card describes the right agent.** On a live custom domain, the
  `/.well-known/` discovery documents and `/agent` describe **that host's
  tenant**, with every interface URL, `provider.url`, `documentationUrl` and
  logo built from that host — not the founding user's. On the platform domain
  they keep describing the founding user exactly as today. This finally uses the
  `userId` the `A2ATask` model already carries for "a future per-slug A2A
  surface" (`prisma/schema.prisma:658`).
- **Visitor chat history survives the move.** The `localStorage` key stays
  `chats:<slug>` — the slug, not the host — and the agent page passes the same
  slug on both addresses, so history is at least consistent per origin. Where a
  tenant switches to a custom domain, the visitor's prior history on the old
  origin is unreachable by design; the panel says so plainly rather than the
  product pretending otherwise.
- **Absolute URLs the tenant is shown are the canonical ones.** The admin
  dashboard's "view your agent" link, the directory entry, and any copyable
  share URL show the custom domain once it is live.

## Scope

- `canonicalOrigin(user)` in `lib/customDomains.ts` and its adoption at every
  absolute-URL site: `lib/a2a/card.ts`, `lib/a2a/facts.ts`, `app/layout.tsx`,
  `app/a/[slug]/page.tsx`, `app/opengraph-image.tsx`.
- A host-validating rewrite of `siteOrigin()` in `lib/util.ts`.
- Per-host `robots.txt` and `sitemap.xml`.
- Host-aware tenant selection for `/.well-known/*`, `/api/a2a`, and `/agent`,
  replacing the unconditional `foundingUser()` at those eight call sites.
- The admin-visible canonical link in the dashboard and directory.

## Non-Goals

- The domain model, host resolution, and admin panel — `custom-domains`.
- Verification and status lifecycle — `custom-domain-verification`.
- **Migrating existing visitors' chat history across origins.** Named above as a
  known, disclosed consequence rather than solved.
- Per-tenant analytics splits, custom `favicon`/`apple-touch-icon` per domain,
  and per-tenant A2A credentials (`A2A_API_KEY` stays deployment-wide).
- 301-redirecting `/a/<slug>` to the custom domain. A canonical link is enough,
  and a redirect would break the directory and existing bookmarks.

## Scenarios

- **Shared link preview.** A tenant with a live domain shares
  `https://smilecare.com`. The preview shows their name, tagline and logo, with
  every URL on their own domain.
- **Search duplication.** Both `smilecare.com` and `platform.com/a/smilecare`
  are crawled. The platform path declares the custom domain canonical; the
  custom domain's sitemap lists only itself.
- **No custom domain.** A tenant without a domain is completely unaffected:
  canonical is `platform.com/a/<slug>`, metadata and the directory behave
  exactly as they do today.
- **A2A discovery on a custom domain.** An agent fetches
  `https://smilecare.com/.well-known/agent-card.json` and receives SmileCare's
  card, with RPC and REST interface URLs on `smilecare.com`. The same fetch
  against the platform domain still returns the founding user's card.
- **Spoofed host header.** A request to the platform arrives with
  `X-Forwarded-Host: evil.example`. The advertised origin does not become
  `evil.example`; an unrecognized host resolves to no tenant and the discovery
  document is not served for it.
- **Domain goes away.** A tenant removes their domain, or it falls out of
  `live`. Canonical, metadata, sitemap and the admin's "view your agent" link
  all revert to `/a/<slug>` on the next request, with nothing left pointing at a
  hostname that no longer serves.
- **Logo URL.** `lib/a2a/card.ts:169` turns a relative upload path absolute
  against the origin. On a custom domain the logo resolves against that domain,
  and `/api/uploads/<name>` answers there, so the image loads.

## Constraints

- **One origin helper, one canonical function.** No route may build an absolute
  URL by hand; adding a second host-derivation path is what created this
  feature's bug surface in the first place.
- **Host validation is a lookup, not a guess.** "Is this host ours" is answered
  by the same `resolveHost` the sibling feature owns — never by a regex over the
  hostname or a substring match on the platform domain.
- **Never serve a tenant for an unverified host**, including in metadata,
  discovery documents, robots and sitemap. Fail closed everywhere.
- **`/api/uploads/[name]` is tenant-blind today** (a flat shared `UPLOAD_DIR`,
  no ownership check — `lib/uploads.ts:47` guards only path traversal). This
  feature must not deepen that: serving uploads on custom domains stays exactly
  as permissive as it is now, and tightening it is called out as separate work,
  not silently bundled here.
- **The platform's own surfaces must not regress.** The founding user's A2A
  card, the directory, OG images and `/agent` behave identically when no custom
  domain exists — the existing A2A proof
  (`docs/features/a2a-agent-interface/proof.ts`, which pins
  `NEXT_PUBLIC_SITE_URL`) must stay green.
- No new dependency; no new env var beyond what the sibling features introduce.

## Implementation Routing

- Required skills: coding-frontend, coding-proof-author

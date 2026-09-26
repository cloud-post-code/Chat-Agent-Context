# Feature — Custom domains: a tenant's own hostname serves their agent page

## Why

Every agent page lives at `/a/<slug>` on the platform's domain. That address is
fine for a directory listing and useless on a business card. A dentist who
already owns `smilecare.com` wants the agent to *be* their site, not a link to
someone else's.

The app is already closer to this than it looks. `app/a/[slug]/page.tsx:34`
resolves a tenant from a slug and hands `slug` to `<Chat>`, which sends it back
with every `/api/chat`, `/api/booking`, and `/api/order` call. Nothing about
the page depends on the *host* it was served from. So a custom domain does not
require rewiring tenancy — it requires one new thing: a way to turn an incoming
`Host` header into the slug the app already knows how to serve.

This feature builds that: the domain record, the host→tenant resolution, and the
admin surface to add and remove a domain. Verification and certificate lifecycle
are the sibling feature (docs/features/custom-domain-verification); URL,
canonical and OAuth correctness are the third
(docs/features/custom-domain-canonical-urls).

## Summary

A tenant registers a hostname they own. Once that hostname is verified and
live, requests arriving on it serve that tenant's agent page at `/`, with every
public API call still resolving to the same tenant — while `/admin`, `/signup`
and the directory remain on the platform domain only.

## Desired Behavior

- A `CustomDomain` row maps one hostname to one `User`. Hostname is globally
  unique and stored normalized (lowercase, no port, no trailing dot, no scheme,
  no path). A user may hold more than one domain; a hostname belongs to exactly
  one user.
- `lib/customDomains.ts` exposes `resolveHost(host): Promise<User | null>` — the
  single place a hostname becomes a tenant. It returns a user only for a domain
  in the `live` status; every other status resolves to null.
- A request to `https://smilecare.com/` serves exactly what `/a/smilecare`
  serves: the same profile, persona, theme, starter chips and chat. It is the
  same page component, not a copy.
- The visitor's browser stays on `smilecare.com` — the root path is *rewritten*
  to the tenant's page, never redirected to `/a/<slug>`.
- The chat works on the custom domain with no client change: the page passes
  the resolved tenant's real `slug` to `<Chat>`, so `/api/chat`, `/api/booking`
  and `/api/order` keep receiving the slug they already require.
- On a custom domain, platform surfaces are not served: `/admin`, `/signup`,
  `/agent` and the directory at `/` (the platform's own root) return a redirect
  to the same path on the platform domain. `/api/*`, `/api/uploads/*` and
  `/.well-known/*` continue to answer, since the agent page depends on them.
- An unknown or unverified hostname reaching the app is not silently served as
  some default tenant. It renders a plain "this domain isn't set up yet" page,
  404, so a dangling DNS record can never show a stranger's agent.
- Admin gains a **Domains** panel: add a hostname, see each domain's status and
  the DNS records it needs, remove a domain. Removal is immediate and frees the
  hostname for any other tenant to claim.

## Scope

- `CustomDomain` Prisma model + migration (`prisma migrate`, never `db push` —
  the repo moved off `db push` in the multi-tenant migration).
- `lib/customDomains.ts`: normalization, validation, add/list/remove, and
  `resolveHost`, all scoped by `userId` the way every other lib module is.
- A root `middleware.ts` — the repo's first — that reads the request host and
  rewrites custom-domain traffic onto the tenant's existing route.
- A Domains panel in `app/admin/panels.tsx`, built once and shown in both the
  dashboard and admin chat, matching the `IngestionSource`/Booking panel idiom.
- Server actions in `app/admin/actions.ts` behind `requireUser()`.

## Non-Goals

- **DNS verification and certificate status lifecycle** — sibling feature
  `custom-domain-verification`. This feature defines the status column and
  honors it; that feature drives rows through it.
- **Canonical URLs, OG metadata, the A2A agent card, and
  `robots`/`sitemap`** on custom domains — sibling feature
  `custom-domain-canonical-urls`.
- **Admin on the custom domain.** `/admin` stays on the platform domain, so the
  session cookie is never issued to a tenant-controlled hostname and one login
  keeps working across all of a user's agents.
- **Automated certificate issuance.** The operator adds the verified hostname in
  Railway, which issues the certificate. No Railway API token is introduced.
- Subdomain-per-tenant (`*.platform.com`), domain transfer between accounts,
  apex-vs-www redirect preferences, and email on the custom domain.

## Scenarios

- **Happy path.** Tenant opens Domains, enters `smilecare.com`, saves. A row
  appears with status `pending_dns` and the records to create. (The rest of that
  journey belongs to the verification feature.) Once the row is `live`,
  `https://smilecare.com/` serves their agent, the address bar keeps saying
  `smilecare.com`, and asking a question returns an answer built from that
  tenant's knowledge.
- **Someone else's domain.** A second tenant tries to add `smilecare.com`. The
  add is rejected with "that domain is already connected to another agent" — the
  error must not disclose which account holds it.
- **Input the tenant fumbles.** `HTTPS://SmileCare.com/contact?x=1`, ` smilecare.com. `,
  and `smilecare.com:443` all normalize to `smilecare.com` or are rejected with a
  readable reason. `localhost`, bare IPs, single-label hosts, hostnames longer
  than 253 characters, and the platform's own domain are all rejected.
- **Dangling DNS.** A tenant removes `smilecare.com` from the app but leaves the
  CNAME pointing at the platform. The next request on that host resolves to no
  tenant and returns the 404 "not set up" page — never another tenant's agent.
- **Not yet live.** DNS is correct but the certificate is not in place, so the
  row is still `pending_certificate`. `resolveHost` returns null and the host is
  not served, so a half-configured domain never serves a broken page.
- **Platform surface on a custom domain.** A visitor hits
  `https://smilecare.com/admin`. They are redirected to the platform domain's
  `/admin`, so the tenant's own login still works and the session cookie is only
  ever set on the platform host.
- **Platform domain unaffected.** With any number of custom domains configured,
  `/`, `/a/<slug>`, `/admin` and `/agent` on the platform domain behave exactly
  as they do today.
- **Slug changes underneath.** An operator renames a tenant's slug
  (`lib/accountAdmin.ts:112`). The custom domain keeps working, because
  `resolveHost` returns the `User` and the page reads `user.slug` live rather
  than caching the slug on the domain row.

## Constraints

- **The host is untrusted input.** `middleware.ts` must read the hostname the
  platform's proxy actually terminated, and a client-supplied `X-Forwarded-Host`
  must not be able to make the app serve a different tenant. Resolution takes
  the first host value only, strips the port, and lowercases before lookup.
  (`lib/util.ts:32` trusts `x-forwarded-host` unconditionally today; that is a
  known weakness this feature must not widen — see the sibling spec.)
- **No new dependency.** Normalization and validation are stdlib string work and
  a regex; the repo consistently avoids dependencies when stdlib suffices.
- **Middleware runs on every request.** Host→tenant lookup must not add a DB
  query to requests on the platform domain: when the host equals the configured
  platform domain (or no custom domain exists), middleware falls through with no
  I/O. The rewrite decision must stay well under a few milliseconds.
- **Middleware must be Node-runtime.** Prisma cannot run on the edge runtime;
  the resolution path either declares the Node runtime or resolves through a
  route handler rather than importing Prisma into an edge middleware.
- **Fail closed.** Any error resolving a host (DB down, malformed record) serves
  the "not set up" page, never a fallback tenant. `foundingUser()` must never be
  the fallback for an unrecognized host.
- Multi-tenant isolation as established in `docs/features/multi-tenant-conversion`
  holds unchanged: a custom domain grants no access to any other tenant's data.
- The platform domain is configuration, not a hardcoded string — it comes from
  env (the existing `NEXT_PUBLIC_SITE_URL` is the natural source) so local dev,
  preview and production each know their own name.

## Implementation Routing

- Required skills: coding-frontend, coding-proof-author

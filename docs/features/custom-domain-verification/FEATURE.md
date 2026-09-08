# Feature — Proving a tenant owns the domain, and driving it to live

## Why

The sibling feature (docs/features/custom-domains) makes a `live` domain serve
its tenant's agent. It deliberately leaves one question unanswered: how a row
ever becomes `live`.

That question is a security boundary, not a formality. Without proof of
ownership, anyone could type `google.com` into the Domains panel and — the
moment DNS happened to point our way — have the platform answer for it. And
because the app is hosted on Railway, where the certificate for a custom
hostname is issued by an operator adding that hostname to the service, a domain
also has to wait for a certificate before it can serve anything at all.

So the lifecycle has two gates: *the tenant proves they control the domain*, and
*the platform confirms it can serve it over TLS*. This feature builds both, plus
the honest status reporting that keeps a tenant from staring at a page that says
nothing.

## Summary

A tenant is shown the exact DNS records to create. The app checks those records
on demand, records what it actually saw, and moves the domain through an
explicit status lifecycle — `pending_dns` → `pending_certificate` → `live` —
with `failed` and a human-readable reason whenever a check does not pass. A
domain that stops verifying does not silently keep serving.

## Desired Behavior

- **Two records, both shown verbatim.** On add, the domain row carries a
  generated `verificationToken` (unguessable, per-domain, stable across
  re-checks) and the panel shows:
  - a **TXT** record at `_agent-verify.<domain>` whose value is that token —
    this is the ownership proof;
  - a **CNAME** at the domain itself pointing at the platform's ingress
    hostname — this is what routes traffic.
  Each is shown as name/type/value with a copy control, because the tenant is
  pasting them into a registrar's form.
- **Ownership check.** "Check DNS" resolves the TXT record and passes only when
  one of the returned values equals the row's token exactly. A missing record, a
  wrong value, and an NXDOMAIN are three distinguishable failures with three
  different messages.
- **Routing check.** The CNAME (or the A/AAAA the tenant used instead — an apex
  domain often cannot hold a CNAME) must resolve toward the platform ingress.
  A domain that proves ownership but is not yet pointed at us is a distinct,
  reportable state, not a generic failure.
- **Status lifecycle**, stored on the row and the only thing `resolveHost`
  consults:
  - `pending_dns` — created; records not yet observed.
  - `pending_certificate` — TXT and routing both verified; awaiting the operator
    adding the hostname in Railway so a certificate exists.
  - `live` — certificate confirmed serving; this is the only status that serves
    traffic.
  - `failed` — a check did not pass; carries `lastError` and `lastCheckedAt`.
  Every transition stamps `lastCheckedAt`, and the panel shows when it last
  looked and what it saw.
- **The tenant can retry.** "Check DNS" is available on demand from the panel
  and is safe to press repeatedly. DNS propagation means the first several
  checks legitimately fail, so the copy must frame a failure as "not yet",
  including the practical note that propagation can take up to 48 hours.
- **The operator has a queue.** Domains sitting in `pending_certificate` are
  listable, so the operator knows exactly which hostnames to add in Railway.
  Once added, a certificate check promotes the row to `live`.
- **Re-verification.** A `live` domain is re-checked periodically. A domain whose
  DNS has been repointed away or whose TXT record was deleted moves back out of
  `live` and stops being served, so a hostname that has left our control cannot
  keep resolving to a tenant's agent.
- **Every check is rate limited** per user and per domain, so the panel's button
  cannot be used to aim DNS traffic at a third party.

## Scope

- `verificationToken`, `status`, `lastCheckedAt`, `lastError`, and `verifiedAt`
  on the `CustomDomain` model from the sibling feature.
- `lib/customDomains/verify.ts`: token generation, the TXT check, the routing
  check, the certificate check, and the single `advance(domain)` function that
  owns every legal transition.
- A DNS-resolution seam — `node:dns/promises` behind a small injectable
  interface, the same idiom `lib/customIngest.ts` and `lib/onboarding/services.ts`
  use for their model calls — so the proof runs offline and deterministically.
- The Domains panel gains per-row status, the two records with copy controls,
  a "Check DNS" action, and the last-checked/last-error line.
- Re-verification of `live` domains driven from the existing boot/bootstrap path
  or a scheduled check, best-effort and never blocking a request.

## Non-Goals

- **Issuing certificates.** The operator adds the hostname in Railway; the app
  observes the result. No ACME client, no Railway API token, no new secret.
- **Registrar integrations.** No one-click DNS setup for Cloudflare/GoDaddy;
  the tenant copies records by hand.
- **Email or MX verification**, DNSSEC validation, and CAA record management.
- **Automatic www↔apex handling.** If a tenant wants both, they add both.
- Serving traffic — the sibling feature owns `resolveHost` and the rewrite.

## Scenarios

- **Happy path.** Tenant adds `smilecare.com`, copies both records into their
  registrar, waits, presses "Check DNS". Both checks pass; status becomes
  `pending_certificate` and the panel says the platform is finishing setup. The
  operator adds the hostname in Railway; the next check finds a valid
  certificate and the row goes `live`. `https://smilecare.com` serves the agent.
- **Too early.** Tenant presses "Check DNS" a minute after saving the records.
  The TXT lookup returns nothing. Status stays `pending_dns`, and the message
  says the record was not found yet and propagation can take up to 48 hours —
  not "verification failed".
- **Typo in the token.** The TXT record exists but its value does not match. The
  message says the record was found with an unexpected value, and shows what was
  expected, so the tenant can spot the truncation their registrar introduced.
- **Ownership proved, traffic not pointed.** TXT matches but the domain still
  resolves to the tenant's old website host. Status does not advance to
  `pending_certificate`; the message names the CNAME as the missing piece.
- **Apex domain.** The tenant's registrar refuses a CNAME at the apex and they
  use an A record (or ALIAS/ANAME) instead. The routing check accepts a record
  that resolves toward the platform ingress, so a correctly-pointed apex verifies.
- **Hostile claim.** A tenant adds a domain they do not control. The TXT record
  never appears, so the row never leaves `pending_dns` and the hostname is never
  served. The domain also stays unavailable to no one else — a claim that cannot
  be proven does not lock the hostname against its real owner indefinitely.
- **Domain repointed away.** A `live` domain's owner moves it elsewhere and
  deletes the TXT record. Re-verification observes this, the row leaves `live`,
  and the app stops answering for that hostname.
- **DNS is down.** The resolver times out. The check reports a transient
  lookup failure and leaves the status untouched — a resolver outage must not
  demote a `live` domain or mark a valid domain `failed`.
- **Button mashing.** Repeated "Check DNS" presses beyond the limit return a
  "try again in a moment" message without performing a lookup.

## Constraints

- **DNS answers are untrusted input.** A TXT value is compared by exact string
  equality against the stored token, never by substring or prefix. Records are
  length-capped before comparison and never interpolated into any prompt, page
  or log without escaping.
- **Timeouts are mandatory.** Every lookup has a short, bounded timeout; a
  hostile or slow nameserver must not hold a server action open.
- **Comparison is constant-time** for the token, matching the repo's existing
  treatment of secrets in `lib/auth.ts` and `lib/a2a/guard.ts`.
- **The token is unguessable** — `randomBytes` from `node:crypto`, the same
  source the session and password code already uses. It is per-domain, and it
  does not change when a check fails, so a tenant's copied record stays valid.
- **No new dependency**: `node:dns/promises` and `node:crypto` cover this.
- **Fail closed on every ambiguity.** Any state that is not a confirmed pass
  leaves the domain unserved. `resolveHost` reads exactly one field, `status`.
- **Every write is scoped by `userId`** through `requireUser()`, and a tenant may
  only check or remove a domain their own account holds.

## Implementation Routing

- Required skills: coding-frontend, coding-proof-author

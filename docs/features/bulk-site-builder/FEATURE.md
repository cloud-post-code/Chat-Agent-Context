# Bulk site builder (operator)

## Summary
An operator pastes many business website links at once. For every link the
system creates a tenant account with a temporary username and password (no
email address involved), runs the full onboarding extraction against the site,
and saves everything the model extracted exactly as it came back — no human
review of any stage. When the run ends the operator sees, per site, the
credentials, the public page link and the outcome, ready to hand over.

## Desired Behavior
- A **Bulk builder** panel under Settings, visible to operators only (same
  gate as the Users tab). Non-operators never see it and its API refuses them.
- The panel takes any number of links (one per line; commas and whitespace
  also separate them). Links are normalized (`https://` added when missing),
  invalid ones are dropped with a note, and duplicates collapse to one.
- **Build sites** starts one build for the whole list. Sites are processed a
  few at a time (`BULK_BUILD_CONCURRENCY`, default 2, capped) so one run
  cannot exhaust the crawler or the model gate; the rest wait in a queue.
- For each site, in order:
  1. An account is created: display name from the site's hostname, a
     **username** of the form `<host-slug>-<4 random chars>` (no `@`, no
     real mailbox; internally stored under a reserved non-routable domain so
     the existing unique-email schema is untouched), and a random temporary
     password of at least 12 characters. The slug follows the hostname.
  2. The whole onboarding pipeline runs unattended: contact info, locations,
     social links, gallery photos, theme + brand voice, then every knowledge
     extractor (blog, testimonials, team, services + booking, sitemap sweep),
     which itself files the graph, derives goals, writes starter questions
     and designs cards — the same stages the guided flow runs, in the same
     order.
  3. Each stage's result is **auto-approved**: it is persisted through the
     same save path the review cards use, with the model's values verbatim
     (contact → profile, locations → address/hours text, social links,
     gallery photos, theme + logo, brand identity). When the model found a
     company name, the account's display name becomes that name.
  4. When the pipeline finishes the account is stamped onboarded, so logging
     in lands on the dashboard, not the onboarding flow.
- Failure isolation: an unreachable site (contact stage fails) marks that
  site **failed** and removes the account it had just created, so no empty
  tenants pile up; the other sites continue. A later stage that fails logs
  the error, that stage's save is skipped, and the run continues; the site
  ends **done with warnings**. A build never aborts the whole list because of
  one site.
- The panel shows a live table while the build runs and after it: URL,
  status (queued / building / done / done with warnings / failed), current
  stage, company name, username, temporary password, `/a/<slug>` link, last
  activity line, and any error. A **Copy credentials** control copies all
  `url,username,password,slug` rows as CSV. Reopening the panel reattaches
  to builds this server still holds (in memory, like onboarding jobs).
- **Login by username**: the login form accepts an email *or* a username; a
  value without `@` is looked up as a bulk-built username. Temporary
  passwords can be replaced later from the Users tab as today.

## Scope
- Operator-only Bulk builder panel + Settings nav entry, its start/status API,
  and an in-memory build registry keyed like onboarding jobs.
- An unattended runner over the existing onboarding stages, with a per-stage
  hook the bulk orchestrator uses to save results.
- The review-save logic moved out of the onboarding save route into a
  request-free module so both the route and the bulk orchestrator call it.
- Username-based accounts (`lib` helper), login-by-username, login page copy.

## Non-Goals
- No email delivery, no password reset flow, no persistence of builds across
  a server restart (a lost build's accounts remain and can be managed from
  the Users tab).
- No per-site option picking (every extractor runs on every site).
- No changes to what any extractor reads or writes, or to the guided flow's
  behavior for ordinary users.
- No database migration.

## Scenarios
- Operator pastes 5 links, two of them duplicates of each other and one
  malformed: the build shows 4 sites, 1 note about the dropped link; with
  concurrency 2, two start immediately and two wait; all four end done, each
  row shows username + password + a working `/a/<slug>` link, the account's
  name is the extracted company name, and logging in with the username and
  password opens the dashboard directly.
- One of the links points at a dead domain: that row ends failed with the
  crawler's message, no account for it exists afterwards, and the other rows
  are unaffected.
- A site's theme extraction throws: the row ends done with warnings, the
  profile/locations/knowledge are still saved, theme stays at defaults.
- A non-operator calls the start API: 403 (or 401 signed out), and no
  account is created. A non-operator's dashboard shows no Bulk builder tab.
- The operator refreshes mid-run: the panel reattaches to the running build
  and keeps updating.

## Constraints
- Reuse: onboarding stages, `saveOnboardingReview` (extracted), account
  creation (`createUser` / `provisionUserDefaults`), operator gate
  (`isOperator`), pool helpers. No new dependencies.
- Temporary passwords are only ever held in the build's process memory and
  shown to the operator; the database stores only the scrypt hash.
- Every write is scoped to the account being built; nothing touches other
  tenants or the operator's own data.
- `ANTHROPIC_API_KEY` is required for a real run, exactly as for onboarding.

## Implementation Routing
- Required skills: coding-frontend, coding-proof-author

# Proof — LLM-readable site

> **2026-09-26 — booking removed.** Booking, Service, the menu and the cart no longer exist in the product (commit `b4d06cf` on main is the last state with them). The checks below that seeded or asserted bookings, services, menu items or orders were removed from `proof.ts`; the rest stand as written.

## Definition Of Done

- `lib/llms.ts` gathers one tenant's public facts and renders a spec-shaped
  `llms.txt` index and an `llms-full.txt` document; empty sections vanish.
- The routes serve them per tenant and for the platform as `text/markdown`.
- Admin-only content never appears in either document.
- `robots.txt` allows the named AI agents and blocks the admin surfaces.
- Markdown negotiation rewrites `Accept: text/markdown` and `.md` requests.

## Primary Proof

Type: integration (real Postgres under a throwaway tenant; no model calls)

Command:

```bash
npx tsx docs/features/llm-readable-site/proof.ts
```

Runs against the local dev Postgres (`DATABASE_URL` from `.env`, loaded by the
script). Creates one throwaway user with a profile, persona, services source,
menu items, a project, canned answers (one blank, one disabled), a scanned
source and a directive, renders both documents through the real route handlers,
checks the assertions below, and deletes the user (cascade) afterwards.

Expected evidence: every line `PASS`, `All checks passed.`, exit 0.

### Assertions

1. Index starts with `# <name>` then a `> ` blockquote; H2 sections contain
   only `- [title](absolute url)` lines; the full document, chat page and chat
   API are linked; the A2A card is linked only for the founding tenant.
2. Full document carries About, Contact, Services (each service name), Menu
   (each item with its displayed price), Projects (name and links), FAQ (the
   answered enabled question only), Sources (title, url, summary), Booking,
   and How to talk to this agent.
3. Neither document contains the blank canned answer's question, the disabled
   one, the directive text, or the word `admin` outside the robots block.
4. Route handlers answer 200 with `text/markdown; charset=utf-8`, an ETag and
   `Access-Control-Allow-Origin: *`; an unknown slug answers 404.
5. Platform `llms.txt` links the throwaway tenant's index; platform
   `llms-full.txt` contains its H1.
6. `robots.txt` has an `Allow: /` group for each named agent and a
   `Disallow: /admin` for `*`; the sitemap lists the tenant's llms files.
7. Middleware: `Accept: text/markdown` on `/a/<slug>` rewrites to
   `/a/<slug>/llms-full.txt`; `/a/<slug>.md` too; `/` to `/llms.txt`; an HTML
   request passes through.

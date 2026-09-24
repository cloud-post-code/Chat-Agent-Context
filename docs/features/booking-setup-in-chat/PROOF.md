# Proof — Booking setup in the onboarding chat, one clean flow

## Primary proof command
```
npx tsx --tsconfig docs/features/booking-flow/tsconfig.proof.json docs/features/booking-setup-in-chat/proof.ts
```
Exit 0 and `All N checks passed.` Runs against the local dev Postgres
(`.env` `DATABASE_URL`) under throwaway users, deleted at the end. Zero model
calls, no network: the image downloader is the one doubled boundary.

## Assertions (all must pass)

### A. The rules
1. Image matching: a one-word overlap with a page heading is no match; a
   caption that names the service is; one or two words need all, more need
   most; a photo already matched is never handed out again.
2. `trimIntake`: with a service step and providers the card is asked only
   what the flow has no step for; an older tenant's stored service or staff
   question stays only while the flow lacks that step.
3. The plan never asks for the service or the person.

### B. The store
1. The block `show_booking` draws carries only the trimmed intake, never
   name/email/phone/staff again; the services card's Book carries the same
   flow; booking off is no block.
2. Seeding merges by name (a row on file is left as it is, new ones added,
   never a duplicate); a photo attaches only where a caption names the
   service, and only once; providers merge by name too and a bio's opening
   title becomes the role.
3. The chat's booking review reads what was seeded; edits land as partial
   patches (price, length, on/off change, the photo stays; a service removed
   in the chat is gone, a foreign id is ignored; providers renamed, removed,
   added; the provider rule saved); the flow the visitor gets then offers
   only enabled services and requires a provider.
4. A restart leaves no service, provider, location, rule, question,
   appointment, menu item or order; the profile is blank with booking back
   on, onboarding is due again, and the defaults are back.

### C. The card and the editors, rendered
1. The service step is a list: a thumbnail only where there is a photo, no
   placeholder blocks.
2. The service editor's known-answer fields are dropdowns; the category is a
   dropdown of the tenant's categories with a way to add one; variants and
   add-ons are rows posting the same lines the action parses; no
   pipe-separated textarea is left.
3. Hours & rules: advance window, gaps, default length, confirmation and
   provider picking are dropdowns, each under its own label; holidays are
   date rows.
4. The chat's services review: price kind, length and bookable are
   dropdowns; the providers review asks whether visitors pick who they see.

### Z. No proof users left behind.

## Also green
- `docs/features/booking-flow/proof.ts` (updated: the card's no-flow state
  fetches rather than asking its own questions; the service step is a list).
- `docs/features/booking-form-planner/proof.ts` (updated: the plan is the
  intake alone; services and providers are rows).

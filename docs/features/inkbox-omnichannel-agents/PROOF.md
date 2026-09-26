# Proof: Inkbox omnichannel agents

## Definition of done
Every `User` can be reached at two Inkbox addresses. The external one answers anyone from
the public brain; the internal one answers only the owner from the admin brain. Web cards
are byte-for-byte unchanged, and cards that cannot be painted are rendered as text instead
of vanishing.

## Primary proof
```
npx tsx docs/features/inkbox-omnichannel-agents/proof.ts
```
Red before implementation, green after. No network: Inkbox is faked at the boundary, and
the model client is injected via `BrainDeps.client` the way the existing proofs do.

## What the proof asserts

### Card coexistence (the load-bearing requirement)
1. `answer({channel: "web"})` still yields `{t:"card"}` events — the web contract is
   untouched.
2. `answer({channel: "a2a"})` still yields `{t:"card"}` — the A2A artifact path survives.
3. `answer({channel: "email"})` yields **no** `card` events, and the card's content
   appears in the text stream. This is the regression that separates "rendered" from
   today's silent drop.
4. Every `UiBlock` variant renders non-empty text: `projects`, `project`, `gallery`,
   `custom`, `html`, `contact`, `booking`.
5. Every `CustomElement` kind renders: heading, text, list, badges, stats, buttons,
   image, quote, divider.
6. `contact` and `booking` render a link to the web surface, not a description of a form.
7. `gallery` and `project` image URLs are absolute in text output.
8. `html` output contains no `<` markup.

### Internal vs external routing
9. Inbound mail to an external identity routes to `answer()`.
10. Inbound mail to an internal identity **from the owner** routes to `adminAnswer()`.
11. Inbound mail to an internal identity **from anyone else** produces no model call and
    no reply — asserted by a model client that throws if invoked.
12. Sender matching is case- and whitespace-insensitive, and compares the authenticated
    address rather than a display name.

### Admin event degradation
13. `panel` becomes a link to `/admin/chat`, never a rendered panel.
14. `approve` becomes a link and **never executes the ingestion** — asserted by an
    executor that throws if called.
15. `goal` is confirmed in prose.

### Webhook safety
16. A delivery with a bad signature is rejected with no model call.
17. A replayed delivery (same `event_id`) is accepted once; the second is a no-op.
18. An unknown recipient address is rejected without creating anything.

### Provisioning
19. Provisioning is idempotent: running it twice yields one identity pair per user.
20. A handle collision (409) falls back to a discriminated handle and persists what it got.
21. A user with no Inkbox config still answers on the web — every Inkbox surface is
    absent-safe.

## Non-goals for this proof
Live Inkbox API calls, DNS/custom-domain verification, voice, and vault.

## Gate
```
~/.claude/scripts/gate
```

## Manual verification (after deploy, not part of the proof)
- Email the external address from an unrelated account; expect a threaded reply.
- Email the internal address from the owner account; expect an admin-copilot reply.
- Email the internal address from any other account; expect silence, and confirm Inkbox
  shows the message stored-but-undelivered.

# Proof — Contacts from sent mail

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/gmail-sent-contacts/proof.ts
```

Local dev Postgres via `.env`. **Zero model calls and zero network calls**: a
fake `SentMailReader` returns fixture messages and a fake note extractor
returns canned text, both injected. `proof-gsc-` markers on every row written,
`finally` cleanup.

The fake reader is the same interface the real Gmail client implements, so the
proof exercises the actual sync path — only the transport is swapped.

## Assertions (all must pass)

1. **Email is the identity, not the name.** Two different addresses sharing one
   display name produce two contacts. Three spellings of one address produce
   one contact.
2. **Canonicalization is correct and correctly narrow.**
   `A.B+tag@Gmail.com` and `ab@gmail.com` are one contact;
   `googlemail.com` folds to `gmail.com`; and
   `john.smith@company.com` and `johnsmith@company.com` stay **two** contacts —
   dot-folding must not leak past Google's domains.
3. **Name is found in the header, and the most frequent variant wins.** An
   address seen as `Jane Doe` twice and `Doe, Jane` once resolves to
   `Jane Doe`. `Jane Doe (Acme)` has its org tag stripped. An address that
   never carries a display name falls back to its local part.
4. **Robots are filtered.** `noreply@`, `no-reply@`, `donotreply@`,
   `support@`, `notifications@`, `mailer-daemon@`, and suppressed domains
   produce no contacts.
5. **Recipients come from To, Cc, and Bcc** — all three, with encoded-word and
   quoted display names parsed correctly rather than regex-mangled.
6. **First sync takes everything.** No `lastSyncedAt` → every fixture message
   is read.
7. **Second sync is incremental.** With a cursor set, only messages newer than
   it are read; already-known contacts are not duplicated.
8. **The cursor advances only on success.** A reader that throws mid-pass
   leaves `lastSyncedAt` unchanged, so the next run re-reads that window.
9. **Enrichment, not duplication.** Re-syncing an existing contact bumps
   `messageCount`, extends `lastContacted`, preserves `firstContacted`, and
   **appends** to `details` rather than replacing it. A hand-edited note
   survives a sync.
10. **Trust is never auto-assigned.** Ingested contacts are `public`; a
    manually promoted contact keeps its tier across a re-sync.
11. **Bodies are never persisted.** After a sync whose fixture bodies contain a
    unique sentinel string, no row in any table contains that sentinel.
12. **A failed note extraction does not fail the sync.** An extractor that
    throws still leaves the contact written with correct counts and dates.
13. **The note prompt is buildable without a model** — `buildContactNotePrompt`
    is exported and returns a string containing the subjects and counts it was
    given.
14. **Auth is gated.** The connect and callback routes and the sync action
    reject an unauthenticated caller.
15. **`state` is verified on callback.** A callback with a missing or forged
    `state` is refused without exchanging the code.

## Red expectation

Before implementation, `lib/gmail/contacts.ts` does not exist — the proof's
import fails with MODULE_NOT_FOUND and exits non-zero. To be re-confirmed by
moving the module aside after implementation.

## Secondary checks (not proof)

- `npx tsc --noEmit` clean.
- `~/.claude/scripts/gate`.
- The neighboring address-book and ingestion proofs still pass.
- Browser, once the OAuth client is live: Connect Gmail, sync, confirm
  contacts appear with names and notes; sync again and confirm counts rise
  without duplicate rows.

## Not proven here

- **The live Google round trip.** The proof injects a fake reader, so it
  proves the sync and derivation logic, not that the OAuth client, scopes,
  and redirect URIs are configured correctly in Google Cloud. That is
  verified in the browser, once.
- **Refresh-token longevity.** Google's docs do not settle whether an
  unverified-but-Production app holds a long-lived refresh token when a
  *restricted* scope is involved. If it expires, the symptom is auth failing
  roughly a week after connecting, and the remedy is the Connect button —
  which is why the token lives in Postgres rather than an env var.
- **Cross-address identity merging.** Out of scope (see FEATURE.md).

# Proof Plan — Home screen refresh

## Definition Of Done
- `homePhotos(userId)` returns the owner's curated photos in `order`, as
  `/api/uploads/<filename>` sources; excludes `ingest:*` and `profile` kinds; respects
  its limit (default 12); never returns another tenant's rows.
- The rendered home screen has the company name alone in the `<h1>`, contains
  `Ask me anything.`, and contains neither `Hey, I` nor `Talk to me`.
- With photos, every photo `src` is in the rendered strip
  (`data-home-strip="photos"`). With none, a fallback band renders
  (`data-home-strip="glow"`) and the page has no `<img>` when there is also no logo;
  the initial badge shows instead.
- With a logo, the home screen renders it.
- An empty tagline renders no tagline paragraph.
- The footnote is the one-line version; the composer placeholder is
  `Type your question…`.
- Title, chips, composer and strip carry `home-rise`; `globals.css` defines it and
  disables it under `prefers-reduced-motion`.
- `app/opengraph-image.tsx` and `app/admin/ThemePicker.tsx` no longer contain
  `Talk to me`, and the OG image uses `Ask me anything.`.
- The database returns to baseline.

## Primary Proof
Type: integration (real `homePhotos` against the database plus a server render of the
real `Chat` component — same style as remove-default-starter-questions)

Command:
```bash
npx tsx docs/features/home-screen-refresh/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`; the script loads `.env`
itself). Creates throwaway users prefixed `homerefreshproof`, seeds `Photo` rows,
asserts, then deletes everything it made.

Expected evidence: every line `PASS`, final line `All proof assertions passed`,
exit 0.

Secondary guards: repo gate `$HOME/.claude/scripts/gate` stays green. Wheel-to-sideways
scrolling and the visual result are checked in the browser preview (no DOM test
harness exists in this repo).

## Environment And Data
Local Postgres reachable via `.env`. No model calls, no network.

## Anti-Gaming Constraints
- The render assertions run the real `app/Chat.tsx`, not a copy.
- Photo sources asserted in the markup come from rows the proof inserted with random
  filenames, so they cannot be hardcoded.
- Do not weaken or delete assertions to get green.

# Proof Plan — Starter tabs

## Definition Of Done
- `chipLabel` never returns more than three words; a written label wins, clamped;
  an unlabelled question derives a label that drops its lead-in ("What nail services
  do you offer?" → "Nail services") and never ends on a connector.
- Generation asks for three `{label, question}` items, writes exactly three rows even
  when the model returns more, and stores labels clamped to three words. A reply of
  bare strings still writes three (unlabelled) rows.
- `starterChipsFor` returns at most three chips — first three *enabled* rows in
  order — each `{ q: whole question, label: ≤ 3 words }`.
- `saveCannedAnswer` clamps an over-long label.
- The rendered home screen has one `data-starter-tabs="home"` grid with exactly
  three equal columns and three buttons; each button's text is ≤ 3 words and its
  `title` is the whole question; no whole question appears as button text. Given
  more than three starters the component still renders three. Given none, no tab
  row renders.
- The database returns to baseline.

## Primary Proof
Type: integration (real generation/save/read paths against the database with an
injected model client, plus a server render of the real `Chat` component).

```bash
npx tsx docs/features/starter-tabs/proof.ts
```

Runs against local dev Postgres (`DATABASE_URL` from `.env`). Creates throwaway users
prefixed `startertabsproof` and deletes them.

Expected evidence: every line `PASS`, final line `All proof assertions passed`, exit 0.

Secondary: `npx tsc --noEmit`; the one-row layout checked in the browser preview at
desktop and 375px widths (three tabs share one `top`, no horizontal overflow, composer
on the first screen).

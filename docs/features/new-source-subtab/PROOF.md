# Proof — New ingestion source builder as a Content sub-tab

## Primary proof command

```
npx tsx --tsconfig docs/features/new-source-subtab/tsconfig.json docs/features/new-source-subtab/proof.ts
```

Offline: pure `resolveAdminTab` calls, a server-rendered `SubTabs` markup
check, and source-level wiring reads. No DB, no model calls, nothing seeded.

## Assertions (all must pass)

1. **`resolveAdminTab(NEW_SOURCE_TAB_KEY)` resolves to Content → the builder
   sub-tab**, with or without live source keys passed, and
   `NEW_SOURCE_TAB_KEY === "new-source"`.
2. **Existing deep links are untouched**: `projects` → content, `answers` →
   agent, `theme` → profile, `activity` → activity, unknown keys pass
   through.
3. **`SubTabs` opened on the builder key renders it selected with its panel
   below the tab bar** (server-rendered markup: `aria-selected="true"` on
   the "+ New ingestion source" tab, panel content present, sibling panel
   absent).
4. **`NewSourcePanel` carries the whole builder**:
   `app/admin/NewSourcePanel.tsx` renders `SourceBuilder` and the manual
   fallback form (`createIngestionSourceAction`, `name="panelHtml"`,
   `name="splitMode"`, `ClassificationSelect`).
5. **The dashboard mounts the panel as a Content sub-tab**: it renders
   `NewSourcePanel`, keys the tab by `NEW_SOURCE_TAB_KEY`, labels it
   "+ New ingestion source", and no longer links out to
   `/admin/sources/new`.
6. **No dead link**: `app/admin/sources/new/page.tsx` redirects to
   `/admin/dashboard?tab=new-source`, and `createIngestionSourceAction`'s
   error redirect lands on `tab=new-source` too.
7. **No shadowing**: `saveIngestionSource` suffixes a source keyed
   `new-source` like any taken key, so a user-made source can never shadow
   the builder tab.

## Red expectation

Before implementation, `app/admin/NewSourcePanel.tsx` does not exist and
`contentTabs.ts` exports no `NEW_SOURCE_TAB_KEY` — the imports fail and the
proof exits non-zero.

## Secondary checks (not proof)

- `npx tsc --noEmit`, `npx next lint`, gate PASS
- Browser: open Content, click "+ New ingestion source", create a test
  source, see it appear as its own sub-tab.

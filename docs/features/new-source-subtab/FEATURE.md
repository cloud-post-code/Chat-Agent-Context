# New ingestion source builder as a Content sub-tab

## What

The "new ingestion source" builder opens as a sub-page inside the Content
section of the admin dashboard — selected like any other Content sub-tab,
with the builder form populating below the sub-tab bar — instead of
navigating away to the standalone `/admin/sources/new` page.

## Behavior

- The Content sub-tab strip gains a "+ New ingestion source" entry after the
  source tabs. Selecting it renders the existing builder (`SourceBuilder`
  chat + the manual fallback form) below the sub-tab bar, structurally
  consistent with the other Content sub-tabs.
- The builder body (error alert, `SourceBuilder`, manual `<details>` form)
  is extracted verbatim into a shared `app/admin/NewSourcePanel.tsx`;
  `SourceBuilder` and the form logic are reused, not forked.
- Deep link: `?tab=new-source` resolves to Content → the builder sub-tab via
  `resolveAdminTab` (`NEW_SOURCE_TAB_KEY` in `app/admin/contentTabs.ts`).
- `/admin/sources/new` redirects to `/admin/dashboard?tab=new-source`
  (carrying an `error` query param through) so no old link dies.
- `createIngestionSourceAction`'s validation-error redirect lands back on
  the dashboard sub-tab (`/admin/dashboard?tab=new-source&error=…`), and the
  dashboard passes `?error` into the panel.
- Submitting still creates the source; the new source then appears as its
  own Content sub-tab (unchanged `contentTabsFromSources` path).

## Out of scope

- No changes to the other sections (Activity, Agent Behavior, Me) or their
  tab keys; no changes to `SourceBuilder` internals or the edit page.

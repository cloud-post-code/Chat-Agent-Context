# Feature — The Content tab strip renders from the IngestionSource table

## What

The admin dashboard's Content section stops hardcoding its sub-tabs. The tab
strip — which tabs exist, their labels, and their **display order** — comes
from `IngestionSource` rows (seeded on first load, same bootstrap shape as
cards and canned answers):

- `contentTabsFromSources(rows, panels)` in `app/admin/contentTabs.ts` is the
  pure mapping: enabled rows, in row order, each paired with its panel by
  `key`; rows with no panel are dropped (custom sources get a generic panel
  in a later feature). Disabled rows disappear from the strip without losing
  their data.
- `app/admin/dashboard/page.tsx` fetches the rows alongside the other
  dashboard queries and renders `<SubTabs tabs={contentTabs}/>` from the
  mapping instead of a literal array. Reordering rows in the DB reorders the
  tabs; no code change.
- `resolveAdminTab(tab, contentKeys?)` accepts the live key list so deep
  links to custom sources resolve into the Content section; without a list it
  falls back to the seven built-in keys.

## Why

Display order and tab existence become data, editable from the admin (later
features), matching how cards already work.

## Also

The stale `admin-content-tabs` proof (written for the old 3-tab world, red
today) is rewritten against the current 7-source reality and this wiring.

## Out of scope

Generic panels for custom sources, create/edit UI, reorder UI.

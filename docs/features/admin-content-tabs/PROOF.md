# Proof — Combined Content section: SubTabs switcher + deep-link resolution

> Updated twice since first written: the Content section is now the seven
> ingestion-source tabs rendered from the `IngestionSource` table
> (ingestion-driven-dashboard), and the legacy `knowledge`→`links` deep-link
> shim was pruned (deploy-db-bootstrap). This contract matches the current
> proof.ts.

## Definition Of Done

- A `SubTabs` client component renders a horizontal tab strip and shows exactly
  the active tab's panel; the initial prop picks the starting tab and an
  unknown initial falls back to the first tab.
- `CONTENT_TAB_KEYS` names the seven built-in ingestion sources;
  `resolveAdminTab` maps each into the Content nav entry with the right
  sub-tab and passes every other key (including the retired `knowledge`)
  through untouched.
- The dashboard wires the Content panels through the IngestionSource mapping
  (`contentTabsFromSources` → `tabs={contentTabs}`), with all seven builtin
  panels present in the mapping, and the profile entry is labeled "Me".

## Primary Proof

Type: component + unit (the feature is nav restructure; the panels themselves
are unchanged server-action forms, so the proof renders the new switcher and
exercises the deep-link mapping rather than standing up auth + Postgres)

Command:

```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/admin-content-tabs/proof.ts
```

(The local tsconfig switches `jsx` to `react-jsx` so tsx can compile the
imported `.tsx` component; the app's own tsconfig uses Next's `preserve`.)

No network, no database. `SubTabs` is rendered with `renderToStaticMarkup`
(client components render fine server-side), so tab-strip markup and
which-panel-shows are observed directly.

### Assertions (all must pass)

1. `CONTENT_TAB_KEYS` is exactly the seven ingestion sources
   `experience, projects, links, pdfs, text, photos, persona`.
2. `resolveAdminTab(<each builtin key>)` → nav `content` with that sub-tab;
   the pruned `knowledge` passes through untouched;
   `resolveAdminTab(undefined)` → no nav, no sub.
3. `SubTabs` with three tabs and no initial renders all three tab buttons,
   shows the first panel only, and marks exactly one tab `aria-selected`.
4. `SubTabs` with `initial="photos"` shows the Photos panel only.
5. `SubTabs` with an unknown initial falls back to the first panel.
6. The dashboard page source mounts `SubTabs`, has a `content` nav entry,
   labels the profile entry "Me", resolves the initial tab through
   `resolveAdminTab`, renders the Content strip from the IngestionSource
   mapping (`tabs={contentTabs}` via `contentTabsFromSources`), and wires
   all seven builtin panels into that mapping.

## Secondary checks

- Gate (`~/.claude/scripts/gate`): typecheck + lint clean.

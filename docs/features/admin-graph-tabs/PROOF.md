# Proof — Graph section reorganized into 5 sub-tabs

## Definition Of Done

- `SubTabs` accepts React-node labels and a configurable tablist `aria-label`
  (defaulting to the Content section's current one), and still renders exactly
  the active tab's panel.
- `GraphPanel` mounts `SubTabs` with the five tabs Graph / Test / Entities /
  Relationships / Overviews in that order: Graph holds the stats and the
  visual canvas, Test holds the retrieval playground, Entities and
  Relationships hold the editing panes (with count badges in the labels), and
  Overviews holds the overview list + rebuild button.
- The strip sits above the panels (SubTabs is the section's top-level
  element, like Content), and every tab's content is its own titled panel:
  Knowledge graph / Test retrieval / Entities / Relationships / Overviews.
- `GraphView.tsx` no longer has its own pane switcher; it exports the
  `EntitiesPane` and `RelationsPane` that the sub-tabs mount.

## Primary Proof

Type: component + source (the panes are server-action forms that need auth +
Postgres to exercise, so the proof renders the switcher — the part that
changed — and verifies the Graph panel's wiring at source level, same split as
the admin-content-tabs proof)

Command:

```bash
npx tsx --tsconfig tsconfig.proofs.json docs/features/admin-graph-tabs/proof.ts
```

No network, no database. `SubTabs` is rendered with `renderToStaticMarkup`.

### Assertions (all must pass)

1. `SubTabs` renders a React-node label (text + count span) inside its tab
   button.
2. The tablist `aria-label` defaults to "Content sections" and is overridable.
3. `SubTabs` with the five graph tabs shows the Graph panel by default, shows
   only the requested panel for `initial="overviews"`, and marks exactly one
   tab selected.
4. `GraphPanel.tsx` mounts `SubTabs` with keys graph, test, entities,
   relations, overviews in order, and each tab's content wires the right
   component: GraphCanvas + stats on Graph, RetrievalPlayground on Test,
   EntitiesPane on Entities, RelationsPane on Relationships, rebuildOverviews
   on Overviews.
5. The Entities and Relationships labels carry count badges (`Count`), with
   the merge-warning badge on Entities.
6. `GraphView.tsx` exports `EntitiesPane` and `RelationsPane` and no longer
   contains the old three-pane switcher ("Visual graph" pill / `PaneTab`);
   `GraphPanel` no longer imports `GraphView`.
7. The dashboard still mounts `GraphPanel` under the `graph` nav entry.

## Secondary checks

- Gate (`~/.claude/scripts/gate`): typecheck + lint clean.
- Existing admin-content-tabs proof stays green (SubTabs changes are
  backward-compatible).

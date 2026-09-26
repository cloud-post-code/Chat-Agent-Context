# Feature — Ingestion sources as data (the `IngestionSource` table)

## What

Each admin Content tab — Experience, Projects, Links, PDFs, Text, Photos,
Persona — becomes an **ingestion source**: a database row rather than code.
The row holds everything that defines the source:

- `key` — the source's stable code (`"experience"`, `"links"`, …), unique,
  slugified, used for deep links and dispatch.
- `label`, `description` — what the tab is called and what it ingests.
- `systemPrompt` — the per-source extraction/guidance prompt (its own system
  prompt).
- `uploadMethod` — how content gets in, from a closed vocabulary:
  `resume | github | url | file | textarea | image | form | generic`.
- `storageKinds` — the uniform storage rule: `text`, `image`, or
  `text+image`. Every piece of ingested information is one of the two.
- `outputMethod` — where ingested data lands (which model/store), recorded as
  data so the dashboard can show it.
- `builtin` — the seven seeded tabs render their bespoke panels; custom rows
  (later feature) render the generic panel.
- `enabled`, `order` — display gate and display order (order is data).

`lib/ingestionSources.ts`: `listIngestionSources()`
(ordered by `order` then `createdAt`), `saveIngestionSource()` (validates
vocabulary, slugifies keys, suffixes key collisions for new rows, appends new
rows at `max(order)+1`), `deleteIngestionSource()`, and
`seedStarterIngestionSources()` which seeds the seven built-in tabs **only
into an empty table** — re-seeding must never resurrect deliberate deletions.

## Why

Which ingestion sources exist should be data, not code — the same principle
the README states for cards. This table is the foundation the next features
build on: DB-driven tab order, the create-source page, and the edit button.

## Out of scope

Rendering the dashboard from these rows (ingestion-driven-dashboard), the
create page (create-ingestion-source), edit gating (edit-ingestion-source).

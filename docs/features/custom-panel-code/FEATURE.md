# Feature — Vibe-code the ingestion page itself, not just its fields

## What

An ingestion source can now carry its own **page code** — custom HTML +
inline CSS that formats its Content tab. Nothing specified means the default page, unchanged.

- **`IngestionSource.panelHtml`** (default `""`). Validated at every save
  by the `safeHtml` rule (`lib/util/html.ts`): no script/iframe/object/embed/link/
  meta/base/form tags, no `javascript:`/`on*=`, 40KB cap. Invalid code is
  rejected with an error, never stored.
- **Rendering** (`app/admin/PanelHtml.tsx` + `GenericIngestPanel`): the
  code renders inside the same sealed sandboxed iframe as coded cards
  (CSP `default-src 'none'`, no scripts, theme variables injected so it
  stays on-palette). A `{{items}}` placeholder is substituted server-side
  with the source's ingested items (titles/text HTML-escaped, images from
  `/api/uploads/` only). The functional controls — ingest forms, and a
  "Manage items" section with the paginated list and per-item Delete —
  stay native below the custom page, so custom code can never break
  ingestion or deletion.
- **The builder chat generates it**: the draft carries `panelHtml`, the
  system prompt teaches when (only when the admin asks for custom
  layout/design), the format rules, and the `{{items}}` placeholder;
  unsafe generated code is dropped to `""` at validation. The test pane
  previews the custom page live with the test items substituted. Editing
  an existing source through the chat carries its current page code
  forward for refinement.
- **Manual escape hatch**: the create and edit forms get a "Page code
  (advanced, optional)" textarea.

## Why

The admin could vibe-code a source's *config* but its page always looked
the same. Now "make this tab look like a press-clippings board" is a chat
message; the default remains for everyone who never asks.

## Out of scope

Custom code for the built-in tabs; scripts/interactivity inside the custom
page (the sandbox forbids them by design).

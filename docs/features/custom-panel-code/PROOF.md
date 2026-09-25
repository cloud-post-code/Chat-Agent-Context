# Proof — Vibe-codeable ingestion pages

## Primary proof command

```
npx tsx --tsconfig tsconfig.proofs.json docs/features/custom-panel-code/proof.ts
```

Local dev Postgres via `.env`; zero model calls. `proof-cpc-` markers,
`finally` cleanup.

## Assertions (all must pass)

1. **Save validation**: `saveIngestionSource` stores safe page code,
   and rejects `<script>`, `<form>`, and >40KB code with an error string
   (nothing stored).
2. **Builder validation**: a draft's safe `panelHtml` survives
   `validateDraft`; unsafe generated code drops to `""` (reply intact).
3. **Custom render**: with `panelHtml` set, `GenericIngestPanel` renders a
   sandboxed iframe (`sandbox` attribute, CSP meta in `srcDoc`) whose
   document contains the custom markup with `{{items}}` substituted; an
   item title containing `<script>` arrives HTML-escaped. The default
   description/prompt block is replaced, but the ingest form and the
   native "Manage items" list with per-item Delete are still rendered.
4. **Default unchanged**: with empty `panelHtml` there is no iframe and
   the page renders exactly the default layout.
5. **Builder wiring** (source-level): the system prompt teaches
   `panelHtml` + `{{items}}`; the test pane previews via `PanelHtml`;
   edit-mode (`SourceBuilderInitial`/`draftFrom`) carries existing page
   code into the chat.
6. **Form wiring** (source-level): create and edit manual forms post a
   `panelHtml` textarea; create/update/built-save actions forward it.

## Red expectation

Before implementation, `panelHtml` is not a column and
`app/admin/PanelHtml.tsx` does not exist — the proof exits non-zero.

## Secondary checks (not proof)

- Prior proofs still green (pagination, delete-items, create-source)
- `npx tsc --noEmit`, gate PASS
- Browser: a source with custom page code renders its custom layout with
  items inside, controls below.

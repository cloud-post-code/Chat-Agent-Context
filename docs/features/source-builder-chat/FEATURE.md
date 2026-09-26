# Feature — Build new ingestion sources by chat, test-only until saved

## What

`/admin/sources/new` becomes a split builder page (the ingestion-source
sibling of the card builder):

- **Left half — builder chat.** A conversation where you describe the
  ingestion source you want ("a tab for press mentions, text plus a
  screenshot…") and refine it turn by turn. Each turn goes to an auth-gated
  API route (`app/api/admin/build-source/route.ts`) that calls the model
  through `lib/ingestionBuilder.ts` and returns a reply plus an updated
  **draft** of the source config (label, key, description, system prompt,
  upload method, storage kinds, output method).
- **Right half — the sample test page.** The draft renders live as the
  ingestion panel it would become: description, system prompt, and the
  text/image ingest forms its storage kinds allow. The panel is **test
  only**: submitting adds simulated items to a local list (images preview
  via object URLs) — nothing touches the database or the upload dir. A
  banner says so. Only the explicit "Save ingestion source" button persists
  the draft (thin `saveBuiltSourceAction` over `saveIngestionSource`) and
  returns you to the Content tabs.
- A collapsed "Manual setup" fallback keeps the plain form (same
  `createIngestionSourceAction`) for when you already know the fields.

`lib/ingestionBuilder.ts` owns the model exchange: the system prompt teaches
the vocabulary (upload methods, text/image storage kinds — custom sources
default to `generic` + `text`), the model answers as JSON
`{reply, draft|null}`, and parsing is defensive — non-JSON becomes a plain
reply with no draft, out-of-vocabulary fields coerce to safe defaults, a
draft without a label is no draft. The client is injectable so the proof
runs with zero model calls. Model: `builderModel()` (the `BUILDER_MODEL` env
knob).

## Why

Building a new ingestion process becomes a conversation you can watch work
in the sample pane, and trying the form can never write junk data — test
mode until the deliberate save.

## Out of scope

Streaming/thinking display (single reply per turn is enough here), editing
existing sources through the chat (the edit page stays the gated form).

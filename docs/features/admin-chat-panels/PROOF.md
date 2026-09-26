# Proof Plan — Chat-first admin: the dashboard as inline panels

## Definition Of Done
- `lib/adminBrain.ts` exists and exports the admin tool loop (`adminAnswer`), the live
  panel-key derivation (`adminPanelKeys`), the ingestion routing (`ingestPlanFor`), and
  the approval executor (`approveIngestion`), all with an injectable model client per
  `lib/brain.ts` conventions.
- A scripted model turn calling `show_panel {key:"goals"}` yields a panel event for
  `goals`; an unknown key yields no panel event and the loop still terminates.
- A scripted `save_goal {text}` turn persists a real `AgentDirective` (kind `goal`,
  enabled) for the user and yields a goal event.
- A scripted `propose_ingestion` turn yields an approval payload whose source is a live
  enabled `IngestionSource` and whose classification defaults from that row; executing
  `approveIngestion` on it writes the real ingested item (`Source` row marked
  `ingest:<sourceKey>` for custom sources).
- Panel keys derive from live `IngestionSource` rows plus the dashboard's constants:
  custom source keys appear, hidden sources disappear, `users` appears only for
  operators.
- `/admin/chat` page and `/api/admin/chat` transport exist behind `currentUser()` /
  auth, with a header Dashboard link to `/admin/dashboard`; authed `/admin`
  redirects to `/admin/chat`.

## Primary Proof
Type: integration (repo-native proof script over the real DB, model doubled only at the
Anthropic client boundary)

Command:
```bash
npx tsx docs/features/admin-chat-panels/proof.ts
```

Expected evidence:
- All `PASS` lines, `failures: 0`, exit code 0.
- Persisted rows observed and then cleaned up: throwaway user, `AgentDirective` goal
  row created by the `save_goal` tool, custom `IngestionSource`, and the
  `ingest:<key>`-marked `Source` row created by `approveIngestion`.

Secondary guards:
- `npx tsc --noEmit` clean (gate build also type-checks).
- Red run recorded before implementation: the script fails to import
  `lib/adminBrain.ts`.

## Environment And Data
- Local dev Postgres from `.env` (`DATABASE_URL`), same as sibling proofs.
- No network: the model client is a scripted double implementing `ModelClient`;
  ingestion extraction is injected as a fake extractor through the existing
  `lib/customIngest.ts` injection points.
- All rows are created under a throwaway user (`proof-admin-chat-panels@example.invalid`)
  and deleted in a `finally` block.

## Anti-Gaming Constraints
- Only the outermost Anthropic client / extractor boundaries may be doubled; the tool
  loop, panel-key derivation, directive and ingest write paths must be the real code.
- No assertion may rely on model-authored text; assertions read events and DB rows.
- Do not weaken `FEATURE.md` scope to make the proof pass; the panel-reuse constraint
  (no forked panel markup) is checked in review, not gamed by new bespoke panels.

## Repo Safety Gate
Command:
```bash
$HOME/.claude/scripts/gate
```

## Manual Gaps
- Visual click-through of `/admin/chat` in a browser (login required): panels render
  inline, Approve completes an ingestion, Dashboard link opens the classic page. The page
  is a thin composition of already-proven pieces; verified via browser preview when
  possible.

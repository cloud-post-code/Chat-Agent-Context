# Feature — Index everything into the knowledge graph

## Why
Only `Source` rows are chunked, embedded and entity-extracted. Everything else
the admin curates — Profile, Persona, Projects, Photos, Activity — bypasses the
index entirely and is instead **dumped into every system prompt in full**.

That is backwards on both goals:
- **Tokens.** The bio, the experience list, every project blurb, and the whole
  persona ship on every single message whether or not they're relevant.
- **Quality.** The graph can't relate a person named in the bio to the same
  person named in a source, because the bio was never extracted. Today's live
  graph proves it: one source (a repo README), so the graph describes the
  codebase's tech stack and "Blake" is a leaf node with a single relation.

## What
Make the chunk/entity index **origin-agnostic**, so every admin surface feeds
one graph.

### Origins indexed
| Origin | Text indexed | Label |
|---|---|---|
| `profile` | bio, experience summary, experience entries, other, location | Profile |
| `persona` | the filled persona + agent-behavior sections | Persona |
| `project` | name, blurb, detail, tags | Project: *name* |
| `photo` | caption + description | Photo: *filename* |
| `source` | raw text (unchanged) | source title/url/filename |
| `activity` | **admin-approved answers only** — see below | Approved answer |

### Activity is deliberately restricted
Visitor-typed text is untrusted. Indexing raw conversations would let any
visitor write into the knowledge base and have their words retrieved later as
fact — knowledge-base poisoning through the public chat box. Only assistant
answers Blake has explicitly rated 👍 on the Activity tab are indexed, together
with the question they answered. Nothing crosses from a visitor into knowledge
without Blake endorsing it.

### Prompt slims down
The always-on core keeps only what must always be true or must exist for tool
calls: identity, contact, the persona, a compact `id — name` project index (so
`show_project` can be called), the photo count, the card instructions, the
rules, and the admin corrections. Bio, experience, project blurbs/details,
photo descriptions and approved answers all become **retrieved** rather than
always-present.

## Boundaries
- `Chunk` gains `originKind` / `originId` / `originLabel`; `sourceId` becomes
  optional so source-derived chunks keep their cascade delete.
- Re-indexing is triggered inline by the existing admin save actions, and is
  best-effort — an indexing failure must never fail the save.
- No change to how chunks are embedded, ranked, or expanded.

## Acceptance
- Editing the profile, persona, a project, a photo, or approving an answer
  makes that content retrievable without any manual reindex.
- The entity graph links entities across origins (a name in the bio and the
  same name in a source resolve to one entity).
- The system prompt no longer contains the full bio, experience list, or
  project blurbs, but still contains every project id so cards still render.
- Deleting a project or photo removes its chunks.

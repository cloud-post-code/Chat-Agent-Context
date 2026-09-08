# Onboarding tags its rows with starter source keys

## Problem

Guided onboarding writes every extraction as `Source { type: "link" }` with
`kind` set to `article` / `other` / `services`. The Content tab strip is
driven by `IngestionSource` rows, and a source's panel lists exactly the rows
marked `kind = "ingest:<key>"` (`listIngestedItems`, default branch in
`lib/ingestedItems.ts`).

Those two vocabularies never meet: the four starter tabs — `blog`,
`testimonials`, `about-team`, `services` — start empty even after a full
onboarding run, because nothing onboarding writes carries an `ingest:` mark.
The tabs are ready to receive manual ingests; onboarding's own output does not
flow into them.

## Desired behavior

Each onboarding extractor marks its Source rows with the `ingest:` key of the
starter tab that mirrors it, so a finished onboarding fills the Content tabs:

| Extractor (`lib/onboarding/`) | Source `kind` written |
| --- | --- |
| `extractBlog` (per post) | `ingest:blog` |
| `extractTestimonials` | `ingest:testimonials` |
| `extractTeam` | `ingest:about-team` |
| `extractServices` (`services.ts`) | `ingest:services` |
| `sweepSitemap` (catch-all pages) | `ingest:services` |

The sweep joins `services` deliberately: `GENERAL_SYSTEM_PROMPT` distills a
page into discrete customer-answerable facts — services, pricing, hours,
policies, FAQs — which is verbatim what the `services` starter describes. An
untagged sweep would otherwise leave those facts invisible in the dashboard.

## Constraints

- The mapping is one exported function, not five string literals, so the
  extractor → tab relationship is stated once and provable offline.
- Rows keep landing in the same place otherwise: same `type: "link"`, same
  upsert-by-url identity, same chunk/embed pipeline. Only `kind` changes.
- `saveKnowledgeRecord`'s upsert `update` branch must also set `kind`, so a
  re-onboard (or a site already ingested before this change) re-tags rows in
  place rather than leaving stale `article`/`other` marks behind.
- The built-in Knowledge tabs (Links / PDFs / Text) exclude `ingest:*` rows by
  design — onboarding output moving out of "Links" and into the four starter
  tabs is the intended effect, not a regression.
- No schema change: `kind` is already a free-text column.

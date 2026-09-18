# Home screen refresh: simpler title and a bottom photo strip

## Summary
The public agent page (`/a/<slug>`) opens on a plain centered column: a hardcoded
`Hey, I'm {name}. / Talk to me.` heading, chips and a composer, and nothing else.
It reads as boring and the title is wordy. Every business already has a logo, theme
colors and curated gallery photos that the home screen never uses.

Make the home screen look like the business, with no new settings, onboarding steps
or visitor-facing complexity. It must look finished for every tenant, including ones
with no logo, no tagline or no photos.

## Desired Behavior
- Title block: the logo (or a badge with the name's initial when there is no logo),
  then the company name alone as the `<h1>`, then a short accent line
  `Ask me anything.`, then the tagline. `Hey, I'm` and `Talk to me.` are gone.
  An empty tagline renders no paragraph.
- A full-width photo strip runs along the bottom of the home screen showing the
  business's own curated photos (never `ingest:*` or `profile` kinds), at most 12.
  The rest of the content sits higher, and the composer is narrower.
- The mouse wheel moves the strip sideways. The wheel is only taken over when the
  pointer is over the strip or the page has no vertical overflow, so a short viewport
  still scrolls down normally. Touch swipe and trackpad scrolling work natively.
- A business with no photos gets a same-height band of soft brand-color glow
  (`--accent`, `--primary`) instead, so the layout is identical.
- Title, chips, composer and strip fade and rise in on load, staggered. Disabled under
  `prefers-reduced-motion`.
- The footnote is one line: `An AI host answers as {name}, using only what they've
  shared.` The composer placeholder becomes `Type your question…` so it does not repeat
  the accent line.
- The share image (`app/opengraph-image.tsx`) and the admin theme preview
  (`app/admin/ThemePicker.tsx`) use the same new title text.

## Scope
- `lib/cards.ts`: `homePhotos(userId, limit = 12)` next to `galleryBlock`.
- `app/a/[slug]/page.tsx`: fetch photos, pass to `Chat`.
- `app/Chat.tsx`: empty-state branch, `PhotoStrip`, styles.
- `app/globals.css`: `.home-rise`.
- `app/opengraph-image.tsx`, `app/admin/ThemePicker.tsx`: title strings.

## Non-Goals
- No change to the conversation view, sidebar, cards, onboarding, schema or admin
  settings. No per-tenant toggle for the strip. Photos are not clickable.

## Implementation Routing
Required skills: `coding-frontend`.

# Local checks — custom-booking-form

## Commands

```bash
npx tsx docs/features/custom-booking-form/reader-proof.ts
npx tsx docs/features/custom-booking-form/proof.ts
npx tsc --noEmit
npx next lint
```

`reader-proof.ts` is the primary proof for the reader and the transcriber: it
drives a fake four-screen widget (`reader.html`, a MoonLight-shaped booking
flow) in headless Chromium with the same `snapshotFrame`/`advanceFrame`
functions `readBookingForm` uses, runs the static cheerio fallback over the
same HTML, exercises the serializer's caps, the sanitizer's caps and its
refusal to merge or rename anything, and runs `transcribeForm` against a
scripted model reply. Fully offline: no real site, no real model call, no
database. `proof.ts` covers `lib/booking/formSpec.ts` `writeFormSpec` against
the real database (the untouched-form gate, the key/role/screen writes, the
one options-less-choice coercion, the staff-selection rule) and the
services-and-booking stage's wiring (`ServicesReport.formFound`/
`formScreens`/`formHow`).

## The Chromium note

This container's Playwright package (1.62.1) expects a newer Chromium
revision than the one already installed at `/opt/pw-browsers`. `chromium
.launch()` fails outright in that state — **never run `npx playwright
install`** to "fix" it; it has no network access here and will hang or fail,
and it is not needed. `reader-proof.ts`'s `launch()` catches that failure and
falls back to whichever Chromium build is actually sitting under
`PLAYWRIGHT_BROWSERS_PATH` (`chromium-<n>/chrome-linux64/chrome`, newest
revision first), the same way `lib/onboarding/crawl.ts`'s browser launch
does in production. If a future container has no Chromium under
`PLAYWRIGHT_BROWSERS_PATH` at all, the proof's `launch()` will throw the
original error — that means the browsers directory itself needs restoring
(an environment/image fix), not a `playwright install`.

## `crosscheck.ts` needs outbound HTTPS

A live cross-check — a real crawl of a real business's booking page plus a
real model call, matched by hand against that business's actual booking
flow — is the strongest evidence the reader and transcriber behave on a page
neither was written against. It needs outbound HTTPS to the open internet,
which this sandbox does not have; run it from an environment that does, with
`ANTHROPIC_API_KEY` set, before trusting the transcriber against a business
the reader-proof fixture didn't already cover.

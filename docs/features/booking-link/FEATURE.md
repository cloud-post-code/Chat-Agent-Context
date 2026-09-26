# Feature — An external booking link, on the contact card and as its own card

## Why

The native booking card (docs/features/booking-card) is the best path to a
meeting — but it only exists once Google is connected and availability is
configured. Plenty of people run their scheduling somewhere else entirely
(Calendly, Cal.com, SavvyCal), and today the site has nowhere to put that link:
the contact card collects a message and stops.

A single admin field closes both gaps: paste one URL and the contact card gains
a "book a time directly" path, and the chat gains a card it can draw whenever a
visitor wants to schedule.

## What gets built

1. **`Profile.bookingLink`** — one URL, default empty. Empty means the feature
   does not exist anywhere on the site.
2. **A place to put it**: a "Booking link" input on the admin Profile tab,
   saved with the rest of the profile by `saveProfile`.
3. **The contact card shows it**: the `contact` block gains an optional
   `bookingLink`, hydrated from the profile, and the contact form renders a
   "book a time directly" link under the send button when it is set.
4. **A `booking_link` card**: `{ type: "booking_link", url, name }` — a
   card with a button that opens the booking page in a new tab.
5. **A `show_booking_link` tool**, offered to the model only when the link is
   set (same withholding pattern as `show_booking`), hydrated through the same
   `hydrate()` path so canned answers and the A2A channel get it for free —
   and guarded there too, so a canned answer naming the tool after the link is
   cleared draws nothing rather than a card pointing nowhere.
6. **Prompt guidance** in `lib/knowledge.ts`: when only the link exists, it is
   the way to book; when the native booking card is also live, the live card is
   preferred and the link is for visitors who want a URL to use later.
7. **The Answers tab dropdown** picks it up automatically from `CARD_TOOLS`.

## Scope decisions

- **Independent of the native booking system.** `bookingEnabled` gates the live
  card; `bookingLink` gates the link card. Both can be on at once — the prompt
  ranks them rather than the code forbidding the combination.
- **No URL validation beyond trimming.** The admin is the only writer, and a
  reject-list of "invalid" schedulers would be guessing. What is stored is what
  is rendered.
- **The card carries the URL in the block.** Unlike live slots, a URL does not
  go stale; a scrolled-back card that still opens the booking page is correct.

# Feature — A booking card, backed by the real Google Calendar

## Why

The chat already has one way to convert interest into contact: `show_contact_form`
writes a `Contact` row and Blake replies whenever he next opens the admin. That
is a message queue, not a meeting. Every actual conversation still costs a
round-trip of "when are you free?" — and the visitor, who was interested for
about ninety seconds, is gone by then.

A booking card closes that loop inside the chat: real open slots from Blake's
actual calendar, one click, a confirmed event with a Meet link in both calendars.
The contact form stays — a lot of visitors have a question, not a meeting.

## What gets built

1. **A `booking` card block** and a `show_booking` tool alongside
   `show_contact_form`, hydrated through the same `hydrate()` path, so canned
   answers and the A2A channel get it for free.
2. **A Google Calendar boundary** (`lib/google.ts`): OAuth refresh-token → access
   token, `freeBusy` for real busy blocks, `events.insert` for the confirmed
   event with a Google Meet link and an emailed invite to the visitor.
3. **Slot math** (`lib/booking/slots.ts`): pure, no I/O — weekly availability
   windows in Blake's timezone, meeting length, lead time, horizon, buffers, and
   busy-interval subtraction.
4. **Two endpoints**: `GET /api/booking/slots` (open slots) and
   `POST /api/booking` (claim one).
5. **A `Booking` table** — Blake's own record of what was booked, independent of
   whatever later happens to the calendar row.
6. **An admin Booking tab**: availability settings, connection status, and the
   list of what's been booked.
7. **A one-time authorization script** (`scripts/google-auth.mjs`) that produces
   the refresh token.

## Scope decisions

- **OAuth refresh token, not a service account.** The calendar being booked is a
  personal `@gmail.com` account. A service account can only reach it via
  Workspace domain-wide delegation (not available on personal accounts) or an
  explicit calendar share, and a shared-in robot cannot send invitations *as*
  Blake. A refresh token is the only mechanism that makes the site act as him.

- **Two scopes, deliberately narrow: `calendar.freebusy` + `calendar.events`.**
  Not `calendar.readonly`, and not the full `calendar` scope. The consequence is
  worth stating plainly: **the site can see that Blake is busy 2–3pm and can add
  events, but cannot read the titles, guests, or contents of his meetings.** A
  compromised token leaks a shape, not a life. This costs nothing — the card
  never needed to know what the busy blocks are.

- **No Google SDK.** `googleapis` is a very large dependency for three HTTP
  calls. The repo already talks to a REST API with bare `fetch` (`lib/github.ts`);
  this does the same.

- **The server never trusts a submitted slot.** `POST /api/booking` recomputes
  the open slots from scratch and rejects anything that isn't currently on that
  list. The start time being on the wire does not make it bookable.

- **The unique constraint is the race guard.** Between reading free/busy and
  writing the event, two visitors can pick the same slot. `Booking.startsAt` is
  unique, and the row is claimed *before* the Google call: the loser hits the
  constraint and is told the slot just went, rather than both being confirmed.
  If the Google call then fails, the claim is released.

- **Free/busy is cached for 60s on the read path, and never on the write path.**
  A popular card should not turn into a Google quota incident, and sixty seconds
  of staleness is invisible to a human picking a slot next week. But the check
  that decides whether a booking is allowed always calls Google: the unique
  constraint below guards only against this site's own bookings, so a cached
  answer at that moment would hand out a slot a meeting had just taken in Google
  itself. One extra API call per booking buys that.

- **Fail closed, always.** Google unreachable, token rejected, `freeBusy`
  returning a per-calendar `errors` entry, booking disabled, credentials unset —
  every one of these yields *no slots*, never *all slots*. The single worst
  outcome for this feature is offering a time Blake is already busy, and the
  most likely cause of that is treating an error as an empty busy list.

- **The card is off until it is configured.** `bookingEnabled` defaults false and
  the tool is withheld from the model when Google is not connected, so a
  half-configured deploy cannot show visitors a broken booker.

- **Times move as instants.** The API speaks ISO-8601 UTC; the card renders in
  the *visitor's* timezone (from `Intl`) and labels Blake's; the calendar event
  carries Blake's IANA zone. No wall-clock string is ever passed between layers.

## Out of scope

- Cancellation and rescheduling from the site. The visitor gets a real Google
  invite and can decline through it; Blake cancels in Google Calendar. Building
  a second, weaker cancellation UI over the top invites the two views to drift.
- Multiple calendars, multiple meeting types/durations, round-robin, paid
  bookings, per-date overrides and holidays.
- Reminder emails. Google's own event reminders already do this.

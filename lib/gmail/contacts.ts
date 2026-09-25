/**
 * Deriving address-book contacts from sent mail.
 *
 * Pure functions over already-parsed messages — no Gmail client, no Prisma, no
 * Anthropic import — so the whole derivation is provable offline. The transport
 * lives in lib/gmail/client.ts and the persistence in lib/gmail/sync.ts.
 *
 * The organizing rule: **the address is the identity, the name is an attribute
 * of it.** Two addresses under one display name are two people; one address
 * under three spellings is one person.
 */

/** A sent message, reduced to what contact derivation needs. */
export type SentMessage = {
  id: string;
  /// Epoch millis, from Gmail's internalDate.
  date: number;
  subject: string;
  /// Every To/Cc/Bcc recipient, display name already parsed out of the header.
  recipients: { name: string; address: string }[];
  /// Plain-text body. Reaches the note extractor; never persisted.
  body: string;
};

/** What one address accumulated across every message it appeared in. */
export type ContactDraft = {
  /// The address as it most recently appeared, for display.
  email: string;
  /// The identity key — see canonicalize().
  canonicalEmail: string;
  name: string;
  messageCount: number;
  firstContacted: Date;
  lastContacted: Date;
  subjects: string[];
  bodies: string[];
};

/**
 * Local parts that are machines, not people. Matched exactly against the
 * lowercased local part, so a human named `support.jane@` is unaffected.
 */
const ROBOT_LOCAL_PARTS = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
  "automated",
  "auto-reply",
  "autoreply",
]);

/**
 * Shared-inbox local parts. Real humans read these, but the address does not
 * identify a person, and an address book of `support@` rows is noise.
 */
const SHARED_LOCAL_PARTS = new Set([
  "support",
  "help",
  "info",
  "contact",
  "sales",
  "billing",
  "admin",
  "hello",
  "team",
  "careers",
  "jobs",
  "hr",
  "security",
  "abuse",
  "feedback",
]);

/** Whole domains that never contain a personal correspondent. */
const SUPPRESSED_DOMAINS = new Set([
  "bounce.email",
  "amazonses.com",
  "sendgrid.net",
  "mailgun.org",
  "resend.dev",
  "notifications.google.com",
  "reply.github.com",
  "sg.actionnetwork.org",
]);

/** Domains where Google guarantees dots and +tags address one mailbox. */
const GOOGLE_MAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Split an address once on the LAST "@" — a quoted local part may contain one. */
function splitAddress(address: string): { local: string; domain: string } | null {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  return { local: address.slice(0, at), domain: address.slice(at + 1) };
}

/**
 * The identity key. Lowercased throughout; dots stripped and +tags dropped
 * ONLY for Google's mail domains.
 *
 * The narrowness is the point. Google canonicalizes gmail.com that way and
 * nobody can register a dotted variant, so folding is safe there. Everywhere
 * else it merges distinct humans — `john.smith@company.com` and
 * `johnsmith@company.com` are routinely two employees, and that holds for
 * Google Workspace custom domains too, where dots *do* matter.
 *
 * Returns "" for anything unparseable, which callers treat as not ingestable.
 */
export function canonicalize(address: string): string {
  const trimmed = address.trim().toLowerCase();
  const parts = splitAddress(trimmed);
  if (!parts) return "";
  let { local } = parts;
  const { domain } = parts;
  if (!local || !domain.includes(".")) return "";

  if (GOOGLE_MAIL_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replaceAll(".", "");
    if (!local) return "";
    // googlemail.com is an alias of gmail.com; fold so both spellings are one
    // person rather than two.
    return `${local}@gmail.com`;
  }
  return `${local}@${domain}`;
}

/**
 * Whether an address belongs in the address book at all. Robots and shared
 * inboxes are filtered here — without this, a sent-mail address book fills
 * with transactional senders and ticket queues.
 */
export function isIngestable(address: string): boolean {
  const canonical = canonicalize(address);
  if (!canonical) return false;
  const parts = splitAddress(canonical);
  if (!parts) return false;
  const { local, domain } = parts;

  if (SUPPRESSED_DOMAINS.has(domain)) return false;
  if (ROBOT_LOCAL_PARTS.has(local)) return false;
  if (SHARED_LOCAL_PARTS.has(local)) return false;
  // Catches noreply-marketing@, no.reply.service@ and friends without
  // rejecting a person whose name merely contains "reply".
  if (/^(no[._-]?reply|do[._-]?not[._-]?reply)\b/.test(local)) return false;
  return true;
}

/**
 * Strip a trailing parenthetical or bracketed org tag: "Jane Doe (Acme)" and
 * "Jane Doe [External]" are both Jane Doe.
 */
function stripOrgTag(name: string): string {
  return name.replace(/\s*[([][^)\]]*[)\]]\s*$/, "").trim();
}

/**
 * Clean one display name as it appeared in a header. Returns "" for names that
 * carry no information — empty, or a mail client echoing the address back.
 */
function cleanName(raw: string, address: string): string {
  let name = (raw ?? "").replace(/\s+/g, " ").trim();
  // Some clients quote the whole display name; mailparser usually unwraps this
  // but a raw header may not have been through it.
  name = name.replace(/^"(.*)"$/s, "$1").trim();
  name = stripOrgTag(name);
  if (!name) return "";
  // A name that is just the address (or its local part) says nothing that the
  // address does not already say.
  const lower = name.toLowerCase();
  const addrLower = address.trim().toLowerCase();
  if (lower === addrLower) return "";
  const parts = splitAddress(addrLower);
  if (parts && lower === parts.local) return "";
  if (name.length > 120) return "";
  return name;
}

/** "jane.doe" / "jane_doe-smith" → "Jane Doe Smith". The fallback name. */
export function nameFromLocalPart(address: string): string {
  const parts = splitAddress(address.trim().toLowerCase());
  const local = parts ? parts.local : "";
  if (!local) return address.trim();
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    // Drop digit-only fragments — "jane.doe.1985" is Jane Doe.
    .filter((w) => !/^\d+$/.test(w));
  if (!words.length) return local;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

/**
 * The display name seen MOST OFTEN for an address, not the most recent.
 *
 * The same person arrives as "Jane", "jane doe", "Doe, Jane", "Jane Doe
 * (Acme)". Frequency is the better signal: the spelling their mail client
 * actually sends is the one that repeats, while one-off variants are typos and
 * manual entries. Ties break toward the longer name ("Jane Doe" over "Jane"),
 * then alphabetically so the result is deterministic.
 *
 * `variants` are raw header names in the order seen. Returns "" if none carry
 * information — the caller falls back to nameFromLocalPart.
 */
export function pickName(variants: string[], address: string): string {
  const counts = new Map<string, { display: string; n: number }>();
  for (const v of variants) {
    const clean = cleanName(v, address);
    if (!clean) continue;
    // Count case-insensitively so "jane doe" and "Jane Doe" are one variant,
    // but display the first casing seen for it.
    const key = clean.toLowerCase();
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { display: clean, n: 1 });
  }
  if (!counts.size) return "";
  return [...counts.values()].sort(
    (a, b) =>
      b.n - a.n ||
      b.display.length - a.display.length ||
      a.display.localeCompare(b.display),
  )[0].display;
}

/** Bodies kept per contact for the note prompt. Bounds prompt size. */
const MAX_BODIES_PER_CONTACT = 8;
/** Subjects kept per contact for the note prompt. */
const MAX_SUBJECTS_PER_CONTACT = 25;

/**
 * Fold a batch of sent messages into one draft per distinct person.
 *
 * Messages may arrive in any order; first/last contact are computed by
 * comparison rather than by assuming a sort.
 */
export function draftContacts(messages: SentMessage[]): ContactDraft[] {
  const byCanonical = new Map<
    string,
    ContactDraft & { nameVariants: string[] }
  >();

  for (const msg of messages) {
    const when = new Date(msg.date);
    // One message to the same person twice (To and Cc) counts once.
    const seenHere = new Set<string>();

    for (const rcpt of msg.recipients ?? []) {
      const address = (rcpt?.address ?? "").trim();
      if (!address || !isIngestable(address)) continue;
      const canonical = canonicalize(address);
      if (seenHere.has(canonical)) continue;
      seenHere.add(canonical);

      let draft = byCanonical.get(canonical);
      if (!draft) {
        draft = {
          email: address,
          canonicalEmail: canonical,
          name: "",
          messageCount: 0,
          firstContacted: when,
          lastContacted: when,
          subjects: [],
          bodies: [],
          nameVariants: [],
        };
        byCanonical.set(canonical, draft);
      }

      draft.messageCount++;
      if (when < draft.firstContacted) draft.firstContacted = when;
      if (when > draft.lastContacted) {
        draft.lastContacted = when;
        // Display the address spelling they most recently used.
        draft.email = address;
      }
      draft.nameVariants.push(rcpt?.name ?? "");
      const subject = (msg.subject ?? "").replace(/\s+/g, " ").trim();
      if (subject && draft.subjects.length < MAX_SUBJECTS_PER_CONTACT) {
        draft.subjects.push(subject);
      }
      const body = (msg.body ?? "").trim();
      if (body && draft.bodies.length < MAX_BODIES_PER_CONTACT) {
        draft.bodies.push(body);
      }
    }
  }

  return [...byCanonical.values()].map((d) => {
    const { nameVariants, ...rest } = d;
    return {
      ...rest,
      name: pickName(nameVariants, rest.email) || nameFromLocalPart(rest.email),
    };
  });
}

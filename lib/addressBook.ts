import { prisma } from "@/lib/db";
import { canonicalize } from "@/lib/gmail/contacts";

/**
 * Blake's hand-curated address book, edited on the Agent Behavior → Contacts
 * tab. Each entry is a person reachable by email and/or phone, tagged with a
 * trust tier that mirrors the ingestion classifications so one vocabulary
 * covers "who is this content for" and "how much do I trust this person".
 *
 * Data + pure helpers only, so it stays provable offline. Distinct from the
 * `Contact` model, which stores in-chat contact-form submissions.
 */

/** Trust tiers, stable slugs; labels are presentation. Ordered least→most. */
export const TRUST_TIERS = ["public", "co-worker", "close-friend", "personal"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];
export const TRUST_LABELS: Record<TrustTier, string> = {
  public: "Public",
  "co-worker": "Co-worker",
  "close-friend": "Close friend",
  personal: "Personal",
};

/**
 * Trust tiers and ingestion classifications render the same four labels under
 * different slugs (`co-worker` vs `contact`, `close-friend` vs
 * `close-friends`). Rather than unify them — a rename across stored rows — the
 * mapping is stated once here so no call site has to assume it.
 */
export const TRUST_FROM_CLASSIFICATION: Record<string, TrustTier> = {
  public: "public",
  contact: "co-worker",
  "close-friends": "close-friend",
  personal: "personal",
};

export type AddressBookRow = {
  id: string;
  name: string;
  details: string;
  email: string;
  phone: string;
  trust: string;
  order: number;
  createdAt: Date;
  /// Set for contacts derived from sent mail; null for hand-added ones.
  canonicalEmail: string | null;
  source: string;
  messageCount: number;
  firstContacted: Date | null;
  lastContacted: Date | null;
};

export async function listAddressBook(userId: string): Promise<AddressBookRow[]> {
  return prisma.addressBookEntry.findMany({
    where: { userId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Write one contact from the admin form. A blank id creates; a blank name is
 * refused — a nameless contact is meaningless. Trust falls back to "public"
 * when the posted value isn't a known tier.
 *
 * Returns an error message, or null on success. (It used to return void and
 * no-op silently; sent-mail ingestion needs to say why a contact was skipped,
 * so this now matches `saveIngestionSource`.)
 *
 * A hand-typed email gets the same canonical key sent-mail ingestion uses, so
 * a later sync enriches this person instead of adding a second row for them.
 */
export async function saveAddressBookEntry(userId: string, input: {
  id?: string;
  name: string;
  details: string;
  email: string;
  phone: string;
  trust: string;
  order?: number;
}): Promise<string | null> {
  const name = input.name.trim();
  if (!name) return "A contact needs a name.";
  const trust = (TRUST_TIERS as readonly string[]).includes(input.trust)
    ? input.trust
    : "public";
  const email = input.email.trim();
  // Null rather than "" — @unique would collide across every contact without
  // an email address.
  const canonicalEmail = email ? canonicalize(email) || null : null;

  if (canonicalEmail) {
    const clash = await prisma.addressBookEntry.findUnique({
      where: { userId_canonicalEmail: { userId, canonicalEmail } },
    });
    if (clash && clash.id !== input.id) {
      return `${clash.name} already uses that email address.`;
    }
  }

  const data = {
    name,
    details: input.details.trim(),
    email,
    phone: input.phone.trim(),
    trust,
    order: input.order ?? 0,
    canonicalEmail,
  };
  if (input.id) {
    await prisma.addressBookEntry.updateMany({ where: { id: input.id, userId }, data });
  } else {
    await prisma.addressBookEntry.create({ data: { ...data, userId } });
  }
  return null;
}

export async function deleteAddressBookEntry(userId: string, id: string): Promise<void> {
  await prisma.addressBookEntry.deleteMany({ where: { id, userId } });
}

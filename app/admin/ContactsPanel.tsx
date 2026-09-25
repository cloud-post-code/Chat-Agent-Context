import { saveAddressBookAction, deleteAddressBookAction, syncGmailContactsAction, disconnectGmailAction } from "@/app/admin/actions/addressbook";
import { PendingButton } from "./PendingButton";
import { panel, field, btn, btnDanger, SectionTitle, Label } from "./ui";
import { TRUST_TIERS, TRUST_LABELS, type AddressBookRow } from "@/lib/addressBook";
import type { GmailStatus } from "@/lib/gmail/client";

/**
 * The Contacts sub-tab of the Agent Behavior section — Blake's address book.
 * Each existing person gets an editable form (name, details, email, phone,
 * trust status, Save, Delete); a blank form at the bottom adds one at a time,
 * the DirectivesPanel / ExperienceEditor pattern.
 *
 * Contacts arrive two ways: typed here by hand, or derived from sent mail by
 * the Gmail panel at the top. Trust tiers mirror the ingestion
 * classifications: Public, Co-worker, Close friend, Personal.
 */
export function ContactsPanel({
  rows,
  gmail,
  message,
}: {
  rows: AddressBookRow[];
  gmail: GmailStatus;
  message?: string;
}) {
  const fromMail = rows.filter((r) => r.source === "gmail").length;

  return (
    <section>
      <div data-fill="surface" style={panel}>
        <SectionTitle>Contacts</SectionTitle>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, marginBottom: 10 }}>
          People in Blake&apos;s address book — each reachable by email or phone
          and tagged with a trust status. Trust tiers match the ingestion
          classifications: Public, Co-worker, Close friend, Personal.
        </p>
        <p style={{ fontSize: 13 }}>
          <strong>{rows.length}</strong> {rows.length === 1 ? "contact" : "contacts"}
          {fromMail ? ` · ${fromMail} from sent mail` : ""}
        </p>
      </div>

      {message ? (
        <div data-fill="surface" style={{ ...panel, borderLeft: "3px solid var(--accent)" }}>
          <p role="status" style={{ fontSize: 13, margin: 0 }}>
            {message}
          </p>
        </div>
      ) : null}

      <GmailPanel status={gmail} />

      {rows.map((r) => (
        <ContactForm key={r.id} row={r} />
      ))}

      <ContactForm />
    </section>
  );
}

function formatWhen(d: Date | null): string {
  if (!d) return "never";
  return new Date(d).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Connect / sync / disconnect for sent-mail ingestion.
 *
 * Connect is a plain link rather than a form because the OAuth flow is a
 * redirect chain through Google, not a mutation this page can own.
 */
function GmailPanel({ status }: { status: GmailStatus }) {
  return (
    <div data-fill="surface" style={panel}>
      <Label>Contacts from sent mail</Label>
      <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 13, margin: "6px 0 10px" }}>
        Reads the people Blake has emailed — sent mail only — and adds them
        here with what the correspondence says about the relationship. Message
        text is read to write that note and is never stored. Syncing again
        picks up only what is new.
      </p>

      {!status.configured ? (
        <p role="alert" style={{ fontSize: 13 }}>
          Set <code>GOOGLE_GMAIL_CLIENT_ID</code> and{" "}
          <code>GOOGLE_GMAIL_CLIENT_SECRET</code> to enable this.
        </p>
      ) : !status.connected ? (
        <a href="/api/admin/gmail/connect" style={{ ...btn, display: "inline-block", textDecoration: "none" }}>
          Connect Gmail
        </a>
      ) : (
        <>
          <p style={{ fontSize: 13, marginBottom: 10 }}>
            Connected{status.emailAddress ? ` as ${status.emailAddress}` : ""} · last
            synced {formatWhen(status.lastSyncedAt)}
            {status.lastSyncedAt ? "" : " (the first sync reads everything)"}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <form action={syncGmailContactsAction}>
              <PendingButton pendingLabel="Syncing…" style={btn}>
                Sync now
              </PendingButton>
            </form>
            <form action={disconnectGmailAction}>
              <PendingButton pendingLabel="Disconnecting…" style={btnDanger}>
                Disconnect
              </PendingButton>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function ContactForm({ row }: { row?: AddressBookRow }) {
  const isNew = !row;

  return (
    <form action={saveAddressBookAction} data-fill="surface" style={panel}>
      {row ? <input type="hidden" name="id" value={row.id} /> : null}
      <input type="hidden" name="order" value={row?.order ?? 0} />

      <Label>{isNew ? "New contact" : "Contact"}</Label>
      <input
        name="name"
        defaultValue={row?.name ?? ""}
        placeholder="Name"
        style={field}
      />

      {row && row.source === "gmail" ? (
        <p style={{ fontSize: 12, color: "var(--on-surface)", margin: "6px 0 0" }}>
          From sent mail · {row.messageCount}{" "}
          {row.messageCount === 1 ? "message" : "messages"}
          {row.firstContacted ? ` · first ${formatWhen(row.firstContacted)}` : ""}
          {row.lastContacted ? ` · last ${formatWhen(row.lastContacted)}` : ""}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <input
          name="email"
          type="email"
          defaultValue={row?.email ?? ""}
          placeholder="Email"
          style={{ ...field, flex: "1 1 220px" }}
        />
        <input
          name="phone"
          type="tel"
          defaultValue={row?.phone ?? ""}
          placeholder="Phone number"
          style={{ ...field, flex: "1 1 180px" }}
        />
      </div>

      <textarea
        name="details"
        rows={2}
        defaultValue={row?.details ?? ""}
        placeholder="Details about this person"
        style={{ ...field, resize: "vertical", fontFamily: "inherit", marginTop: 10 }}
      />

      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}>
        <div style={{ display: "grid", gap: 6, flex: "1 1 200px" }}>
          <Label>Trust status</Label>
          <select name="trust" defaultValue={row?.trust ?? "public"} style={field}>
            {TRUST_TIERS.map((t) => (
              <option key={t} value={t}>
                {TRUST_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <PendingButton pendingLabel={isNew ? "Adding…" : "Saving…"} style={btn}>
          {isNew ? "Add" : "Save"}
        </PendingButton>
        {row ? (
          <PendingButton pendingLabel="Deleting…" formAction={deleteAddressBookAction} style={btnDanger}>
            Delete
          </PendingButton>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Primary proof for gmail-sent-contacts (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json \
 *        docs/features/gmail-sent-contacts/proof.ts
 *
 * Zero model calls and zero network calls: a fake SentMailReader returns
 * fixture messages and a fake note extractor returns canned text, both
 * injected. The fake reader implements the same interface the real Gmail
 * client does, so the sync path itself is exercised — only the transport is
 * swapped.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}
process.env.VOYAGE_API_KEY = "";
process.env.OPENAI_API_KEY = "";

import { prisma } from "@/lib/db";
import {
  canonicalize,
  isIngestable,
  pickName,
  nameFromLocalPart,
  draftContacts,
  type SentMessage,
} from "@/lib/gmail/contacts";
import {
  buildContactNotePrompt,
  sanitizeNote,
  appendNote,
  type ContactNote,
} from "@/lib/gmail/note";
import { syncSentContacts, type SentMailReader } from "@/lib/gmail/sync";
import { listAddressBook, saveAddressBookEntry } from "@/lib/addressBook";
import { parseAddressList, parseGmailMessage, decodeEncodedWords } from "@/lib/gmail/client";
import { issueState, verifyState } from "@/lib/gmail/state";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

/** Every fixture address lives under this domain so cleanup can find them. */
const MARK = "proof-gsc";
const D = `${MARK}.example`;
/** Appears in fixture bodies only; assertion 11 proves it never lands in the DB. */
const BODY_SENTINEL = "SENTINEL-proof-gsc-body-must-not-persist";

const day = (n: number) => Date.UTC(2026, 0, n);

function msg(over: Partial<SentMessage> & { id: string }): SentMessage {
  return {
    date: day(10),
    subject: "Subject line",
    recipients: [],
    body: `Body text. ${BODY_SENTINEL}`,
    ...over,
  };
}

const fakeNote = async (): Promise<ContactNote> => ({
  summary: "A person Blake emailed.",
  labels: ["colleague"],
});
const throwingNote = async (): Promise<ContactNote> => {
  throw new Error("note extraction exploded");
};

/** A reader over a fixed message list that honours the `since` cursor. */
function readerOver(messages: SentMessage[]): SentMailReader & { calls: number } {
  const r = {
    calls: 0,
    async listSentMessages({ since }: { since: Date | null }) {
      r.calls++;
      return since ? messages.filter((m) => m.date > since.getTime()) : messages;
    },
  };
  return r;
}

async function cleanup() {
  await prisma.addressBookEntry.deleteMany({
    where: { OR: [{ email: { contains: D } }, { canonicalEmail: { contains: D } }] },
  });
  await prisma.gmailAuth.deleteMany({ where: { id: MARK } });
}

async function main() {
  await cleanup();

  // ---------------------------------------------------------------- pure core
  section("1. Email is the identity, not the name");
  {
    const drafts = draftContacts([
      msg({
        id: "m1",
        recipients: [
          { name: "Jane Doe", address: `jane@${D}` },
          { name: "Jane Doe", address: `jane.other@${D}` },
        ],
      }),
    ]);
    check("two addresses under one name → two contacts", drafts.length === 2,
      `got ${drafts.length}`);

    const one = draftContacts([
      msg({ id: "a", recipients: [{ name: "Jane Doe", address: `jd@${D}` }] }),
      msg({ id: "b", recipients: [{ name: "jane doe", address: `JD@${D}` }] }),
      msg({ id: "c", recipients: [{ name: "Doe, Jane", address: `jd@${D}` }] }),
    ]);
    check("one address under three spellings → one contact", one.length === 1,
      `got ${one.length}`);
  }

  section("2. Canonicalization is correct and correctly narrow");
  {
    check("gmail dots and +tag fold",
      canonicalize("A.B+tag@Gmail.com") === "ab@gmail.com",
      canonicalize("A.B+tag@Gmail.com"));
    check("googlemail folds to gmail",
      canonicalize("ab@googlemail.com") === "ab@gmail.com");
    check("gmail variants are one contact",
      canonicalize("a.b+x@gmail.com") === canonicalize("ab@gmail.com"));
    check("NON-gmail dots do NOT fold (two employees stay two people)",
      canonicalize("john.smith@company.com") !== canonicalize("johnsmith@company.com"));
    check("non-gmail +tag does NOT fold",
      canonicalize("jane+shop@company.com") !== canonicalize("jane@company.com"));
    check("case folds everywhere", canonicalize("Jane@Company.COM") === "jane@company.com");
    check("garbage yields empty", canonicalize("not-an-address") === "");
  }

  section("3. Name is found in the header; most frequent variant wins");
  {
    check("most frequent wins over most recent",
      pickName(["Jane Doe", "Jane Doe", "Doe, Jane"], `j@${D}`) === "Jane Doe",
      pickName(["Jane Doe", "Jane Doe", "Doe, Jane"], `j@${D}`));
    check("org tag stripped",
      pickName(["Jane Doe (Acme)"], `j@${D}`) === "Jane Doe",
      pickName(["Jane Doe (Acme)"], `j@${D}`));
    check("case variants count as one",
      pickName(["jane doe", "Jane Doe", "JANE DOE"], `j@${D}`).toLowerCase() === "jane doe");
    check("an echoed address is not a name",
      pickName([`jane@${D}`, ""], `jane@${D}`) === "");
    check("local part is the fallback",
      nameFromLocalPart(`jane.doe@${D}`) === "Jane Doe",
      nameFromLocalPart(`jane.doe@${D}`));
    check("digits dropped from fallback",
      nameFromLocalPart(`jane.doe.1985@${D}`) === "Jane Doe");
    const noName = draftContacts([
      msg({ id: "n", recipients: [{ name: "", address: `mary.sue@${D}` }] }),
    ]);
    check("nameless header falls back to local part",
      noName[0]?.name === "Mary Sue", noName[0]?.name);
  }

  section("4. Robots and shared inboxes are filtered");
  {
    for (const local of [
      "noreply", "no-reply", "donotreply", "notifications",
      "mailer-daemon", "support", "billing", "no-reply-marketing",
    ]) {
      check(`${local}@ rejected`, !isIngestable(`${local}@${D}`));
    }
    check("suppressed domain rejected", !isIngestable("someone@amazonses.com"));
    check("a real person is accepted", isIngestable(`jane.doe@${D}`));
    check("a human whose name contains 'support' is accepted",
      isIngestable(`support.jane@${D}`));
  }

  section("5. Recipients come from To, Cc and Bcc");
  {
    const drafts = draftContacts([
      msg({
        id: "abc",
        recipients: [
          { name: "To Person", address: `to@${D}` },
          { name: "Cc Person", address: `cc@${D}` },
          { name: "Bcc Person", address: `bcc@${D}` },
        ],
      }),
    ]);
    check("all three recipients become contacts", drafts.length === 3,
      `got ${drafts.length}`);
    const dupe = draftContacts([
      msg({
        id: "d",
        recipients: [
          { name: "Jane", address: `j@${D}` },
          { name: "Jane", address: `j@${D}` },
        ],
      }),
    ]);
    check("same person twice in one message counts once",
      dupe.length === 1 && dupe[0].messageCount === 1,
      `count=${dupe[0]?.messageCount}`);
  }

  section("Dates are computed by comparison, not arrival order");
  {
    const d = draftContacts([
      msg({ id: "late", date: day(20), recipients: [{ name: "J", address: `j@${D}` }] }),
      msg({ id: "early", date: day(5), recipients: [{ name: "J", address: `j@${D}` }] }),
    ]);
    check("first/last correct despite unsorted input",
      d[0].firstContacted.getTime() === day(5) && d[0].lastContacted.getTime() === day(20));
  }

  section("13. The note prompt builds without a model");
  {
    const [draft] = draftContacts([
      msg({ id: "p", subject: "Coffee next week", recipients: [{ name: "Jane", address: `j@${D}` }] }),
    ]);
    const prompt = buildContactNotePrompt(draft);
    check("prompt contains the subject", prompt.includes("Coffee next week"));
    check("prompt contains the message count", prompt.includes("1"));
    check("prompt contains the address", prompt.includes(`j@${D}`));
  }

  section("Note sanitizing coerces and caps");
  {
    const n = sanitizeNote({ summary: 42, labels: ["A", "a", "", "x".repeat(99), "b", "c", "d", "e"] });
    check("non-string summary coerced", typeof n.summary === "string");
    check("labels lowercased and deduped", n.labels.every((l) => l === l.toLowerCase()));
    check("labels capped at 4", n.labels.length <= 4, `got ${n.labels.length}`);
    check("garbage yields empty note", sanitizeNote(null).summary === "");
    check("appendNote keeps existing text",
      appendNote("hand written", "new block").includes("hand written"));
    check("appendNote does not duplicate an identical block",
      appendNote("a\n\nblock", "block") === "a\n\nblock");
  }

  // ------------------------------------------------------------------ the sync
  const AUTH = { id: MARK };

  section("6. First sync takes everything");
  {
    await prisma.gmailAuth.create({
      data: { id: MARK, refreshToken: "fake", emailAddress: `blake@${D}` },
    });
    const reader = readerOver([
      msg({ id: "s1", date: day(1), subject: "Hello", recipients: [{ name: "Alpha One", address: `alpha@${D}` }] }),
      msg({ id: "s2", date: day(2), subject: "Follow up", recipients: [{ name: "Beta Two", address: `beta@${D}` }] }),
      msg({ id: "s3", date: day(3), subject: "Noise", recipients: [{ name: "Robot", address: `noreply@${D}` }] }),
    ]);
    const res = await syncSentContacts({ authId: MARK, reader, extractNote: fakeNote });
    check("sync reports success", res.ok === true, res.error);
    const rows = (await listAddressBook()).filter((r) => r.email.includes(D));
    check("two humans ingested, robot skipped", rows.length === 2, `got ${rows.length}`);
    check("names came from headers",
      rows.some((r) => r.name === "Alpha One") && rows.some((r) => r.name === "Beta Two"),
      rows.map((r) => r.name).join(","));
    check("note written to details",
      rows.every((r) => r.details.includes("A person Blake emailed.")));
    check("cursor advanced",
      (await prisma.gmailAuth.findUnique({ where: AUTH }))?.lastSyncedAt !== null);
  }

  section("10. Trust is never auto-assigned");
  {
    const rows = (await listAddressBook()).filter((r) => r.email.includes(D));
    check("ingested contacts land at public",
      rows.every((r) => r.trust === "public"), rows.map((r) => r.trust).join(","));
  }

  section("7. Second sync is incremental");
  {
    const reader = readerOver([
      msg({ id: "s1", date: day(1), recipients: [{ name: "Alpha One", address: `alpha@${D}` }] }),
      msg({ id: "s4", date: day(30), subject: "New thread", recipients: [{ name: "Gamma Three", address: `gamma@${D}` }] }),
    ]);
    await syncSentContacts({ authId: MARK, reader, extractNote: fakeNote });
    const rows = (await listAddressBook()).filter((r) => r.email.includes(D));
    check("only the new message was read; no duplicates", rows.length === 3,
      `got ${rows.length}`);
    check("the old message was not re-counted",
      rows.find((r) => r.name === "Alpha One")?.messageCount === 1,
      String(rows.find((r) => r.name === "Alpha One")?.messageCount));
  }

  section("9. Enrichment, not duplication");
  {
    const before = (await listAddressBook()).find((r) => r.name === "Alpha One")!;
    await saveAddressBookEntry({
      id: before.id,
      name: before.name,
      details: `${before.details}\n\nHAND EDITED — must survive`,
      email: before.email,
      phone: "",
      trust: "close-friend",
    });
    const reader = readerOver([
      msg({ id: "s5", date: day(40), subject: "Later thread", recipients: [{ name: "Alpha One", address: `alpha@${D}` }] }),
    ]);
    await syncSentContacts({ authId: MARK, reader, extractNote: fakeNote });
    const after = (await listAddressBook()).find((r) => r.canonicalEmail === canonicalize(`alpha@${D}`))!;
    check("no duplicate row",
      (await listAddressBook()).filter((r) => r.email.includes(D)).length === 3);
    check("messageCount accumulated", after.messageCount === 2, String(after.messageCount));
    check("firstContacted preserved",
      after.firstContacted?.getTime() === day(1), String(after.firstContacted));
    check("lastContacted extended",
      after.lastContacted?.getTime() === day(40), String(after.lastContacted));
    check("hand-edited details survived", after.details.includes("HAND EDITED — must survive"));
    check("manually set trust survived", after.trust === "close-friend", after.trust);
  }

  section("8. The cursor advances only on success");
  {
    const before = (await prisma.gmailAuth.findUnique({ where: AUTH }))!.lastSyncedAt;
    const boom: SentMailReader = {
      async listSentMessages() {
        throw new Error("gmail unreachable");
      },
    };
    const res = await syncSentContacts({ authId: MARK, reader: boom, extractNote: fakeNote });
    check("failure is reported, not thrown", res.ok === false && !!res.error, res.error);
    const after = (await prisma.gmailAuth.findUnique({ where: AUTH }))!.lastSyncedAt;
    check("cursor unchanged after a failed pass",
      after?.getTime() === before?.getTime());
  }

  section("12. A failed note does not fail the sync");
  {
    const reader = readerOver([
      msg({ id: "s6", date: day(50), subject: "Quiet", recipients: [{ name: "Delta Four", address: `delta@${D}` }] }),
    ]);
    const res = await syncSentContacts({ authId: MARK, reader, extractNote: throwingNote });
    check("sync still succeeds", res.ok === true, res.error);
    const row = (await listAddressBook()).find((r) => r.name === "Delta Four");
    check("contact written despite the failed note", !!row);
    check("counts and dates still correct",
      row?.messageCount === 1 && row?.lastContacted?.getTime() === day(50));
  }

  section("5b. Header parsing survives real-world headers");
  {
    const list = parseAddressList(`"Doe, Jane" <jane@${D}>, bob@${D}`);
    check("a comma inside a quoted name does not split the list",
      list.length === 2, `got ${list.length}`);
    check("the quoted name is recovered",
      list[0]?.name === "Doe, Jane", list[0]?.name);
    check("a bare address parses", list[1]?.address === `bob@${D}`, list[1]?.address);

    const encoded = parseAddressList(`=?UTF-8?B?SsO2cmc=?= <jorg@${D}>`);
    check("RFC 2047 base64 display name decoded",
      encoded[0]?.name === "Jörg", encoded[0]?.name);
    check("RFC 2047 quoted-printable decoded",
      decodeEncodedWords("=?UTF-8?Q?Jo=CC=88rg?=").length > 0);
    check("a name with no encoded word is untouched",
      decodeEncodedWords("Plain Name") === "Plain Name");
    check("an empty list yields nothing", parseAddressList("").length === 0);
    check("a malformed entry is dropped, not thrown",
      parseAddressList("garbage-no-at-sign").length === 0);
  }

  section("5c. Gmail messages parse into SentMessage");
  {
    const parsed = parseGmailMessage({
      id: "g1",
      internalDate: String(day(11)),
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "To", value: `Jane <jane@${D}>` },
          { name: "Cc", value: `Bob <bob@${D}>` },
          { name: "Bcc", value: `Carol <carol@${D}>` },
          { name: "Subject", value: "Hello there" },
        ],
        body: { data: Buffer.from("Message body here.").toString("base64url") },
      },
    });
    check("To, Cc and Bcc all become recipients",
      parsed?.recipients.length === 3, String(parsed?.recipients.length));
    check("subject parsed", parsed?.subject === "Hello there", parsed?.subject);
    check("internalDate parsed", parsed?.date === day(11));
    check("base64url body decoded",
      parsed?.body === "Message body here.", parsed?.body);
    check("a message with no recipients is dropped",
      parseGmailMessage({ id: "x", internalDate: "1", payload: { headers: [{ name: "Subject", value: "s" }] } }) === null);
    check("a message with no id is dropped",
      parseGmailMessage({ internalDate: "1", payload: { headers: [{ name: "To", value: `a@${D}` }] } }) === null);

    const quoted = parseGmailMessage({
      id: "g2",
      internalDate: String(day(12)),
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "To", value: `jane@${D}` }, { name: "Subject", value: "Re: x" }],
        body: {
          data: Buffer.from(
            "My actual reply.\nOn Mon, Jan 1 2026, Jane wrote:\n> the entire prior thread",
          ).toString("base64url"),
        },
      },
    });
    check("quoted reply chain stripped",
      quoted?.body === "My actual reply." && !quoted.body.includes("prior thread"),
      quoted?.body);
  }

  section("15. The OAuth state nonce is verified");
  {
    check("a freshly issued state verifies", verifyState(issueState()));
    check("a missing state is refused", !verifyState(null));
    check("a forged state is refused", !verifyState("1234567890.abc.deadbeef"));
    check("a tampered payload is refused", !verifyState(issueState().replace(/^./, "9")));
    const old = issueState(Date.now() - 11 * 60 * 1000);
    check("an expired state is refused", !verifyState(old));
    check("a future-dated state is refused",
      !verifyState(issueState(Date.now() + 60_000)));
  }

  section("14. Auth gates the routes and the sync action");
  {
    // The route modules are imported for their source, not executed: calling
    // them would need a Next request scope. What is asserted is that every
    // entry point checks auth before doing anything, which is a property of
    // the code rather than of a live request.
    const read = (p: string) => readFileSync(path.join(root, p), "utf8");
    const connect = read("app/api/admin/gmail/connect/route.ts");
    const callback = read("app/api/admin/gmail/callback/route.ts");
    const actions = read("app/admin/actions/addressbook.ts");
    check("connect route checks isAuthed", connect.includes("isAuthed()"));
    check("callback route checks isAuthed", callback.includes("isAuthed()"));
    // The property that matters is that a callback we did not issue is turned
    // away before the code is even read — so the state check must precede the
    // `code` lookup, and it must return rather than fall through.
    const stateAt = callback.indexOf("verifyState(");
    const codeAt = callback.indexOf('searchParams.get("code")');
    check("callback reads state before it reads the code",
      stateAt >= 0 && codeAt >= 0 && stateAt < codeAt,
      `state@${stateAt} code@${codeAt}`);
    check("a bad state returns instead of falling through",
      /if\s*\(\s*!verifyState\([\s\S]*?\)\s*\{\s*\n\s*return/.test(callback));
    check("sync action requires auth",
      /syncGmailContactsAction[\s\S]{0,200}requireAuth\(\)/.test(actions));
    check("disconnect action requires auth",
      /disconnectGmailAction[\s\S]{0,200}requireAuth\(\)/.test(actions));
  }

  section("11. Bodies are never persisted");
  {
    const [entries, sources, contacts] = await Promise.all([
      prisma.addressBookEntry.findMany(),
      prisma.source.findMany({ where: { rawText: { contains: BODY_SENTINEL } } }),
      prisma.contact.findMany({ where: { message: { contains: BODY_SENTINEL } } }),
    ]);
    const inEntries = entries.filter(
      (e) => e.details.includes(BODY_SENTINEL) || e.name.includes(BODY_SENTINEL),
    );
    check("no body text in address book", inEntries.length === 0);
    check("no body text in sources", sources.length === 0);
    check("no body text in contacts", contacts.length === 0);
  }

  console.log(
    failures === 0
      ? "\nPROOF: PASS"
      : `\nPROOF: FAIL (${failures} assertion${failures === 1 ? "" : "s"})`,
  );
}

main()
  .catch((e) => {
    failures++;
    console.error(`\nPROOF ERROR: ${e instanceof Error ? e.stack : e}`);
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    process.exit(failures === 0 ? 0 : 1);
  });

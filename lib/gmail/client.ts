import { prisma } from "../db";
import type { SentMessage } from "./contacts";
import type { SentMailReader } from "./sync";

/**
 * The Gmail transport: OAuth token handling and the sent-mail read.
 *
 * Deliberately dependency-free — Google's REST API over fetch rather than
 * googleapis, matching how lib/github.ts talks to GitHub. Everything here
 * is I/O; the logic that decides what a contact IS lives in contacts.ts, which
 * is why the proof can exercise the sync without touching this file.
 *
 * Scope is gmail.readonly. Bodies are read because they are what make the
 * relationship notes worth having, and they are handed to the note extractor
 * and then dropped — nothing here persists message text.
 */

const OAUTH_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/**
 * Messages pulled per sync. Each costs a metadata+body fetch.
 *
 * Temporarily lowered to 10 while the Gmail connection is being shaken out:
 * a first sync is otherwise hundreds of sequential API calls inside one admin
 * request. Raise it once the flow is proven end to end.
 */
export const MAX_MESSAGES_PER_SYNC = 10;
/** Body characters kept per message before the note extractor truncates further. */
const MAX_BODY_CHARS = 4_000;

export function gmailClientId(): string {
  return (process.env.GOOGLE_GMAIL_CLIENT_ID ?? "").trim();
}
function gmailClientSecret(): string {
  return (process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? "").trim();
}
export function gmailConfigured(): boolean {
  return !!gmailClientId() && !!gmailClientSecret();
}

/**
 * The OAuth redirect target. Must byte-match a URI registered on the Gmail
 * OAuth client, so it is derived from the request's own origin rather than
 * guessed from env — localhost and the deployed domain then both work.
 */
export function gmailRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/admin/gmail/callback`;
}

export function gmailConsentUrl(origin: string, state: string): string {
  return (
    `${OAUTH_AUTH}?` +
    new URLSearchParams({
      client_id: gmailClientId(),
      redirect_uri: gmailRedirectUri(origin),
      response_type: "code",
      scope: GMAIL_SCOPE,
      // Both are required to be handed a refresh token at all, and
      // prompt=consent is what makes a *re*-authorization return one instead
      // of only an access token.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
    })
  );
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok) {
    throw new Error(
      `Google token request failed (${res.status}): ` +
        `${json.error_description ?? json.error ?? "unknown error"}`,
    );
  }
  return json;
}

/**
 * Exchange the one-time code for a refresh token and store it.
 *
 * Storing in Postgres rather than an env var is the point of the in-dashboard
 * flow: re-consent after a revoked or expired grant is a button click instead
 * of a redeploy.
 */
export async function exchangeAndStore(
  userId: string,
  code: string,
  origin: string,
): Promise<string | null> {
  const token = await postToken({
    code,
    client_id: gmailClientId(),
    client_secret: gmailClientSecret(),
    redirect_uri: gmailRedirectUri(origin),
    grant_type: "authorization_code",
  });

  if (!token.refresh_token) {
    return (
      "Google returned no refresh token. It already had a grant for this " +
      "client — revoke it at https://myaccount.google.com/permissions and " +
      "connect again."
    );
  }

  let emailAddress = "";
  try {
    emailAddress = await fetchProfileAddress(token.access_token ?? "");
  } catch {
    // Cosmetic only; a connection with an unknown label still works.
  }

  const data = {
    refreshToken: token.refresh_token,
    emailAddress,
    scope: token.scope ?? GMAIL_SCOPE,
  };
  await prisma.gmailAuth.upsert({
    where: { userId },
    // A fresh grant is a fresh mailbox: reset the cursor so the next sync
    // reads everything rather than trusting a cursor from a previous account.
    create: { userId, ...data },
    update: { ...data, lastSyncedAt: null },
  });
  return null;
}

async function accessToken(refreshToken: string): Promise<string> {
  const token = await postToken({
    client_id: gmailClientId(),
    client_secret: gmailClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  if (!token.access_token) throw new Error("Google returned no access token.");
  return token.access_token;
}

async function fetchProfileAddress(token: string): Promise<string> {
  if (!token) return "";
  const res = await fetch(`${GMAIL_API}/profile`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return "";
  const json = (await res.json()) as { emailAddress?: string };
  return json.emailAddress ?? "";
}

export async function disconnectGmail(userId: string): Promise<void> {
  await prisma.gmailAuth.deleteMany({ where: { userId } });
}

export type GmailStatus = {
  connected: boolean;
  configured: boolean;
  emailAddress: string;
  lastSyncedAt: Date | null;
  scope: string;
};

export async function gmailStatus(userId: string): Promise<GmailStatus> {
  const auth = await prisma.gmailAuth.findUnique({ where: { userId } });
  return {
    connected: !!auth,
    configured: gmailConfigured(),
    emailAddress: auth?.emailAddress ?? "",
    lastSyncedAt: auth?.lastSyncedAt ?? null,
    scope: auth?.scope ?? "",
  };
}

// ---------------------------------------------------------------- reading mail

type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  internalDate?: string;
  payload?: GmailPart;
};

function headerValue(headers: GmailHeader[], name: string): string {
  const lower = name.toLowerCase();
  return headers
    .filter((h) => (h.name ?? "").toLowerCase() === lower)
    .map((h) => h.value ?? "")
    .join(", ");
}

/** Gmail encodes body data base64url. */
function decodeBody(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Depth-first search for the plain-text body. Prefers text/plain; falls back to
 * de-tagged text/html, which is what a message composed in a rich client has.
 */
function extractBody(part: GmailPart | undefined, depth = 0): string {
  if (!part || depth > 8) return "";
  const mime = part.mimeType ?? "";
  if (mime === "text/plain" && part.body?.data) return decodeBody(part.body.data);
  for (const child of part.parts ?? []) {
    const found = extractBody(child, depth + 1);
    if (found) return found;
  }
  if (mime === "text/html" && part.body?.data) {
    return decodeBody(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

/**
 * A quoted reply chain repeats the whole prior thread, which would feed the
 * same text to the model once per message. Cut at the usual quote markers.
 */
function stripQuotedReply(body: string): string {
  const markers = [
    /^On .+ wrote:$/m,
    /^-{2,} ?Original Message ?-{2,}$/im,
    /^_{10,}$/m,
    /^From: .+$/m,
  ];
  let cut = body.length;
  for (const re of markers) {
    const m = re.exec(body);
    if (m && m.index < cut) cut = m.index;
  }
  return body.slice(0, cut).trim();
}

export function parseGmailMessage(msg: GmailMessage): SentMessage | null {
  const id = msg.id ?? "";
  const headers = msg.payload?.headers ?? [];
  if (!id || !headers.length) return null;

  const date = Number(msg.internalDate ?? 0);
  if (!Number.isFinite(date) || date <= 0) return null;

  // To/Cc/Bcc together — Bcc is present on your own sent copy.
  const raw = ["To", "Cc", "Bcc"]
    .map((h) => headerValue(headers, h))
    .filter(Boolean)
    .join(", ");
  if (!raw) return null;

  const body = stripQuotedReply(extractBody(msg.payload)).slice(0, MAX_BODY_CHARS);

  return {
    id,
    date,
    subject: headerValue(headers, "Subject"),
    recipients: parseAddressList(raw),
    body,
  };
}

/**
 * Parse an RFC 5322 address list.
 *
 * Hand-written rather than pulled from a library because the grammar we need
 * is small and the dependency is not: quoted display names (which may contain
 * commas), angle-bracketed addresses, and RFC 2047 encoded words. Splitting a
 * header on "," alone is the classic bug — `"Doe, Jane" <j@x.com>` becomes two
 * broken recipients.
 */
export function parseAddressList(raw: string): { name: string; address: string }[] {
  const out: { name: string; address: string }[] = [];
  let buf = "";
  let inQuotes = false;
  let inAngle = false;

  const flush = () => {
    const piece = buf.trim();
    buf = "";
    if (!piece) return;
    const parsed = parseOneAddress(piece);
    if (parsed) out.push(parsed);
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"' && raw[i - 1] !== "\\") inQuotes = !inQuotes;
    else if (ch === "<" && !inQuotes) inAngle = true;
    else if (ch === ">" && !inQuotes) inAngle = false;
    else if (ch === "," && !inQuotes && !inAngle) {
      flush();
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

function parseOneAddress(piece: string): { name: string; address: string } | null {
  const angle = piece.lastIndexOf("<");
  let name = "";
  let address = piece;
  if (angle >= 0) {
    const close = piece.indexOf(">", angle);
    address = piece.slice(angle + 1, close < 0 ? undefined : close).trim();
    name = piece.slice(0, angle).trim();
  }
  name = name.replace(/^"(.*)"$/s, "$1").trim();
  address = address.replace(/^<|>$/g, "").trim();
  if (!address.includes("@")) return null;
  return { name: decodeEncodedWords(name), address };
}

/** Decode RFC 2047 =?UTF-8?B?...?= / =?UTF-8?Q?...?= display names. */
export function decodeEncodedWords(input: string): string {
  if (!input.includes("=?")) return input;
  return input.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, enc: string, text: string) => {
      try {
        const encoding = charset.toLowerCase() as BufferEncoding;
        const safe: BufferEncoding = encoding === "utf-8" ? "utf8" : encoding;
        if (enc.toLowerCase() === "b") {
          return Buffer.from(text, "base64").toString(safe);
        }
        const bytes = text
          .replace(/_/g, " ")
          .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
            String.fromCharCode(parseInt(hex, 16)),
          );
        return Buffer.from(bytes, "binary").toString(safe);
      } catch {
        return whole;
      }
    },
  );
}

/** The live reader for one user's grant. Swapping this out is how a different
 * transport plugs in. */
export const gmailReader = (userId: string): SentMailReader => ({
  async listSentMessages({ since }) {
    const auth = await prisma.gmailAuth.findUnique({ where: { userId } });
    if (!auth) throw new Error("Gmail is not connected.");
    const token = await accessToken(auth.refreshToken);

    const ids = await listSentIds(token, since);
    const out: SentMessage[] = [];
    for (const id of ids) {
      const msg = await getMessage(token, id);
      const parsed = msg ? parseGmailMessage(msg) : null;
      // Gmail's `after:` has day granularity, so re-filter exactly here.
      if (parsed && (!since || parsed.date > since.getTime())) out.push(parsed);
    }
    return out;
  },
});

async function listSentIds(token: string, since: Date | null): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      // labelIds, not q:"in:sent" — a server-side label filter rather than a
      // parsed search string, and it keeps working if the scope is ever
      // narrowed to gmail.metadata, where `q` is rejected outright.
      labelIds: "SENT",
      maxResults: "100",
    });
    if (since) {
      // Coarse server-side prefilter; the exact cut happens above.
      params.set("q", `after:${Math.floor(since.getTime() / 1000)}`);
    }
    if (pageToken) params.set("pageToken", pageToken);

    const res = await fetch(`${GMAIL_API}/messages?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      throw new Error(`Gmail list failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      messages?: { id: string }[];
      nextPageToken?: string;
    };
    for (const m of json.messages ?? []) ids.push(m.id);
    pageToken = json.nextPageToken;
  } while (pageToken && ids.length < MAX_MESSAGES_PER_SYNC);

  return ids.slice(0, MAX_MESSAGES_PER_SYNC);
}

async function getMessage(token: string, id: string): Promise<GmailMessage | null> {
  const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  // One unreadable message must not abort a whole sync.
  if (!res.ok) return null;
  return (await res.json()) as GmailMessage;
}

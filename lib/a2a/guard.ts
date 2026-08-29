import { timingSafeEqual } from "node:crypto";
import { clientIp } from "@/lib/util";

/**
 * Who is allowed to talk to the agent, and how often.
 *
 * The endpoint is CLOSED. Every A2A call must present a bearer token matching
 * either `A2A_API_KEY` or the admin password — no credential, no answer. The
 * Agent Card still publishes, because that is how another agent learns this
 * one exists and that it needs credentials; publishing a card is not the same
 * as accepting anonymous work.
 *
 * Two things follow from accepting the admin password here:
 *
 *  1. The endpoint becomes an oracle for guessing that password, so failed
 *     attempts are throttled far harder than ordinary traffic (5 per 15
 *     minutes per IP) and every comparison is constant-time.
 *  2. Only the `Authorization` header is accepted — never the admin session
 *     cookie. A cookie-authenticated POST endpoint would be cross-site
 *     forgeable: any page Blake visits while logged in could spend his model
 *     credits. A bearer token has to be sent deliberately.
 */

export type AuthResult = "ok" | "unauthorized" | "locked-out";

/** Requests allowed per IP per minute. `A2A_RATE_LIMIT=0` disables the limit. */
function limitPerMinute(): number {
  const raw = Number.parseInt(process.env.A2A_RATE_LIMIT ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 30;
}

const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; resetAt: number }>();

/** Failed credentials are budgeted separately, and much more tightly. */
const AUTH_WINDOW_MS = 15 * 60_000;
const MAX_AUTH_FAILURES = 5;
const authFailures = new Map<string, { count: number; resetAt: number }>();

/**
 * In-memory because it only has to be good enough to stop a runaway loop, and
 * because a shared store would put a database round-trip in front of every
 * request to save a fraction of a cent. On a multi-instance deploy each
 * instance limits independently — deliberately accepted.
 */
export function underRateLimit(ip: string): boolean {
  const limit = limitPerMinute();
  if (limit === 0) return true;
  return bump(hits, ip, WINDOW_MS) <= limit;
}

function bump(store: Map<string, { count: number; resetAt: number }>, key: string, windowMs: number): number {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    if (store.size > 5_000) sweep(store, now); // bound it against churning IPs
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

function sweep(store: Map<string, { count: number; resetAt: number }>, now: number): void {
  for (const [key, entry] of store) if (now >= entry.resetAt) store.delete(key);
}

export { clientIp } from "@/lib/util";

/** The optional dedicated token, preferred over handing out the admin password. */
export function a2aApiKey(): string {
  return (process.env.A2A_API_KEY ?? "").trim();
}

function matchesApiKey(token: string): boolean {
  const key = a2aApiKey();
  if (!key) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Legacy credential: ADMIN_PASSWORD doubles as an A2A bearer token when no
 * dedicated A2A_API_KEY is set. Constant-time, and an empty env never matches.
 * (Admin logins are per-account now — lib/auth.ts — so this env credential
 * exists only for this surface.)
 */
function checkAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Checks the caller's credentials. Returns "locked-out" once an IP has burned
 * its failure budget, so a guessing loop stops getting answers long before it
 * could work through a password.
 */
export function authorize(headers: Headers): AuthResult {
  const ip = clientIp(headers);
  const failures = authFailures.get(ip);
  if (failures && Date.now() < failures.resetAt && failures.count >= MAX_AUTH_FAILURES) {
    return "locked-out";
  }

  const [scheme, token] = (headers.get("authorization") ?? "").split(" ");
  const presented = scheme?.toLowerCase() === "bearer" ? (token ?? "") : "";

  // checkAdminPassword is the same constant-time comparison style the admin
  // login used before accounts existed, kept for the legacy A2A credential, so
  // there is exactly one place that knows how the admin password is checked.
  if (presented && (matchesApiKey(presented) || checkAdminPassword(presented))) {
    authFailures.delete(ip);
    return "ok";
  }

  bump(authFailures, ip, AUTH_WINDOW_MS);
  return "unauthorized";
}

/** Test seam: clears the in-memory counters between proof runs. */
export function resetGuards(): void {
  hits.clear();
  authFailures.clear();
}

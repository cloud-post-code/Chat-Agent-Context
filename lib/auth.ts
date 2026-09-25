import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import type { User } from "@prisma/client";

/**
 * Per-user auth, grown from the original single-admin signed cookie.
 *
 * Passwords are hashed with Node's built-in scrypt (no dependency), stored as
 * "scrypt:N:r:p:salt:hash". Sessions are an HMAC-signed cookie carrying the
 * user id and an expiry — same forge-proof construction as before, now with a
 * payload. Rotating AUTH_SECRET invalidates every session.
 */

const COOKIE = "agent_session";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

/** The HMAC key for every signed token the app issues (sessions, edit tokens, OAuth state). */
export function authSecret(): string {
  return process.env.AUTH_SECRET || "dev-insecure-secret-change-me";
}

// ── Passwords (scrypt) ──

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString("hex");
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt}:${hash}`;
}

/** Constant-time verify. An empty/malformed stored hash never matches. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, salt, hashHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!N || !r || !p || !salt || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, salt, expected.length, { N, r, p });
    return expected.length > 0 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ── Sessions (HMAC-signed cookie: userId.expiresAtMs.mac) ──

function mac(payload: string): string {
  return createHmac("sha256", authSecret()).update(payload).digest("hex");
}

function signSession(userId: string, expiresAtMs: number): string {
  const payload = `${userId}.${expiresAtMs}`;
  return `${payload}.${mac(payload)}`;
}

/** The user id inside a valid, unexpired session token — else null. */
function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const idx = token.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = token.slice(0, idx);
  const given = Buffer.from(token.slice(idx + 1));
  const expected = Buffer.from(mac(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const sep = payload.lastIndexOf(".");
  if (sep < 0) return null;
  const userId = payload.slice(0, sep);
  const expiresAtMs = Number(payload.slice(sep + 1));
  if (!userId || !Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) return null;
  return userId;
}

export async function createSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSession(userId, Date.now() + SESSION_MAX_AGE_S * 1000), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** The logged-in user's id from the cookie alone — no DB read. */
async function sessionUserId(): Promise<string | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(COOKIE)?.value);
}

/**
 * Whether an account may hold a session. The login action and `currentUser`
 * both consult this, so disabling an account (User.disabledAt) blocks new
 * logins AND reads live sessions as logged out.
 */
export function accountActive(user: Pick<User, "disabledAt"> | null): boolean {
  return user !== null && user.disabledAt === null;
}

/** The logged-in User row, or null. A stale id (deleted user) or a disabled
 *  account reads as null. */
export async function currentUser(): Promise<User | null> {
  const id = await sessionUserId();
  if (!id) return null;
  const user = await prisma.user.findUnique({ where: { id } });
  return accountActive(user) ? user : null;
}

export async function isAuthed(): Promise<boolean> {
  return (await currentUser()) !== null;
}

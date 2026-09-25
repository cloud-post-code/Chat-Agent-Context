import { authSecret } from "@/lib/auth";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The OAuth `state` nonce, signed rather than stored.
 *
 * state is the CSRF defence for the consent round trip: without it, anyone
 * could hand the admin a crafted callback URL and have their own Google
 * account's grant written into Blake's database. Signing with AUTH_SECRET
 * means the callback can verify a value it issued without a session store,
 * matching how lib/auth.ts signs the admin cookie.
 *
 * The timestamp bounds the replay window — a consent round trip is seconds,
 * so ten minutes is generous.
 */

const MAX_AGE_MS = 10 * 60 * 1000;

export function issueState(now: number = Date.now()): string {
  const value = `${now}.${randomBytes(12).toString("hex")}`;
  const mac = createHmac("sha256", authSecret()).update(value).digest("hex");
  return `${value}.${mac}`;
}

export function verifyState(state: string | null, now: number = Date.now()): boolean {
  if (!state) return false;
  const idx = state.lastIndexOf(".");
  if (idx < 0) return false;
  const value = state.slice(0, idx);
  const expected = createHmac("sha256", authSecret()).update(value).digest("hex");
  const a = Buffer.from(state.slice(idx + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const issued = Number(value.split(".")[0]);
  if (!Number.isFinite(issued)) return false;
  // Reject the future too — a clock-skewed or crafted timestamp should not buy
  // an unbounded window.
  return now - issued >= 0 && now - issued < MAX_AGE_MS;
}

import { authSecret } from "@/lib/auth";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Second gate for editing ingestion-source CONFIG (not for ingesting
 * content): a password held only in the local .env. Editing a source changes
 * what the agent ingests and how, so it's a deliberate act beyond admin
 * login.
 *
 * INGESTION_EDIT_PASSWORD is the local secret; when it isn't set the admin
 * password unlocks editing (single-operator convenience), and when both are
 * empty editing stays locked. A correct password sets a short-lived signed
 * cookie with its own HMAC label, so the admin cookie value can never stand
 * in for it.
 */

const COOKIE = "blake_ingest_edit";
const LABEL = "ingest-edit";

/** The signed edit token — distinct label, so ≠ the admin cookie value. */
export function editToken(): string {
  const mac = createHmac("sha256", authSecret()).update(LABEL).digest("hex");
  return `${LABEL}.${mac}`;
}

export function verifyEditToken(token: string | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(editToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

const same = (x: string, y: string) => {
  const a = Buffer.from(x);
  const b = Buffer.from(y);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function checkEditPassword(input: string): boolean {
  const expected = process.env.INGESTION_EDIT_PASSWORD || process.env.ADMIN_PASSWORD || "";
  if (!expected) return false;
  return same(input, expected);
}

export async function createEditSession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, editToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60, // 1 hour — unlocking an edit session is per-sitting.
  });
}

export async function isEditAuthed(): Promise<boolean> {
  const jar = await cookies();
  return verifyEditToken(jar.get(COOKIE)?.value);
}

import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { accountActive, verifyPassword } from "@/lib/auth";
import { createUser, slugify } from "@/lib/users";
import type { User } from "@prisma/client";

/**
 * Username-based tenant accounts for the bulk site builder: no email address
 * involved, just a slug-derived username under a reserved, never-routable
 * domain, so the existing unique-email schema is untouched.
 */

/** Reserved and never routable — the "no email" placeholder domain. */
export const USERNAME_DOMAIN = "bulk.invalid";

/** Lowercased hostname, "www." stripped. Throws on an unparseable url. */
export function hostOf(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.replace(/^www\./, "");
}

/** slugify() over the hostname — e.g. "acme-plumbing.com" -> "acme-plumbing-com". */
export function usernameBase(url: string): string {
  return slugify(hostOf(url));
}

/** The email a login identifier maps to: as-is if it already has an "@",
 *  else stitched onto the reserved bulk-account domain. */
export function loginEmailFor(identifier: string): string {
  const id = identifier.trim().toLowerCase();
  return id.includes("@") ? id : `${id}@${USERNAME_DOMAIN}`;
}

const SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(len = 4): string {
  return Array.from(randomBytes(len))
    .map((b) => SUFFIX_CHARS[b % SUFFIX_CHARS.length])
    .join("");
}

/**
 * Create a username-based account for one bulk-built site. Retries with a
 * fresh random suffix (up to 5 attempts) if the derived email collides;
 * any other createUser error is rethrown.
 */
export async function createBulkAccount(
  url: string,
): Promise<{ userId: string; username: string; password: string; slug: string; name: string }> {
  const base = usernameBase(url);
  const name = hostOf(url);
  const password = randomBytes(12).toString("base64url");

  for (let attempt = 0; attempt < 5; attempt++) {
    const username = `${base}-${randomSuffix()}`;
    const result = await createUser({
      email: `${username}@${USERNAME_DOMAIN}`,
      name,
      password,
    });
    if ("user" in result) {
      return { userId: result.user.id, username, password, slug: result.user.slug, name };
    }
    if (!/already exists/i.test(result.error)) throw new Error(result.error);
  }
  throw new Error(`Could not allocate a unique username for ${base} after 5 attempts.`);
}

// A real scrypt hash of a random throwaway value; never matches anything.
// Verifying against it when the identifier is unknown keeps login's response
// time from revealing which usernames/emails have accounts.
const DUMMY_HASH =
  "scrypt:16384:8:1:6c6f67696e2d74696d696e672d70616464696e67:" +
  "0000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000";

/** Login credential check: identifier is an email or a bulk-account username. */
export async function authenticate(identifier: string, password: string): Promise<User | null> {
  const email = loginEmailFor(identifier);
  const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
  const ok = user
    ? verifyPassword(password, user.passwordHash)
    : (verifyPassword(password, DUMMY_HASH), false);
  return ok && user && accountActive(user) ? user : null;
}

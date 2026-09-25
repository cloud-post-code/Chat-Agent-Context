import { randomBytes } from "node:crypto";
import { USERNAME_DOMAIN } from "@/lib/auth";
export { USERNAME_DOMAIN };
import { createUser, slugify } from "@/lib/users";

/**
 * Username-based tenant accounts for the bulk site builder: no email address
 * involved, just a slug-derived username under a reserved, never-routable
 * domain, so the existing unique-email schema is untouched.
 */

/** Lowercased hostname, "www." stripped. Throws on an unparseable url. */
function hostOf(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  return host.replace(/^www\./, "");
}

/** slugify() over the hostname — e.g. "acme-plumbing.com" -> "acme-plumbing-com". */
function usernameBase(url: string): string {
  return slugify(hostOf(url));
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


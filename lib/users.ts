import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { seedStarterIngestionSources } from "@/lib/ingestionSources";
import type { User } from "@prisma/client";

/**
 * Account lifecycle: signup, slugs, per-user starter provisioning, and the
 * founding user — the account that owns every row that existed before the
 * app became multi-tenant (see the multi_tenant migration).
 */

/** The migration's fixed id for the pre-existing single-admin's account. */
export const FOUNDER_ID = "founder";

const RESERVED_SLUGS = new Set([
  "admin", "api", "signup", "login", "agent", "a", "directory", "founder",
]);

/** Lowercase alnum-and-dash slug from a display name; never empty. */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "agent";
}

/** A slug no other user owns, suffixing -2, -3, … on collision. */
export async function uniqueSlug(base: string): Promise<string> {
  const clean = slugify(base);
  const start = RESERVED_SLUGS.has(clean) ? `${clean}-1` : clean;
  if (!(await prisma.user.findUnique({ where: { slug: start } }))) return start;
  for (let n = 2; ; n++) {
    const candidate = `${clean}-${n}`;
    if (!(await prisma.user.findUnique({ where: { slug: candidate } }))) return candidate;
  }
}

/**
 * Per-user starter rows: the three config singletons plus the seeded Content
 * tabs. Idempotent — the seed fills only when that user has zero rows of the
 * kind, so it never resurrects deliberate deletions.
 *
 * Starter questions and A2UI cards are deliberately NOT seeded: both are
 * written for the business when onboarding completes (lib/starterQuestions.ts,
 * lib/onboarding/cards.ts), and generic placeholders standing in until then —
 * five interview questions, a portfolio's project cards — were worse than
 * nothing at all.
 */
export async function provisionUserDefaults(userId: string): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["profile", () => prisma.profile.upsert({ where: { userId }, update: {}, create: { userId } })],
    [
      "persona",
      async () => {
        const existing = await prisma.personaConfig.findUnique({ where: { userId } });
        if (!existing) {
          await prisma.personaConfig.create({
            data: { userId, tagline: "Here to help. Ask us anything." },
          });
        }
      },
    ],
    ["theme", () => prisma.themeConfig.upsert({ where: { userId }, update: {}, create: { userId } })],
    ["ingestion sources", () => seedStarterIngestionSources(userId)],
  ];
  for (const [label, run] of steps) {
    try {
      await run();
    } catch (e) {
      console.error(`provision ${label} for ${userId} failed:`, e);
    }
  }
}

export type SignupError = string;

/** Create an account from the signup form. Returns the user or an error. */
export async function createUser(input: {
  email: string;
  name: string;
  password: string;
}): Promise<{ user: User } | { error: SignupError }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "That email doesn't look right." };
  if (!name) return { error: "A display name is required." };
  if (input.password.length < 8) return { error: "The password needs at least 8 characters." };

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "An account with that email already exists." };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name,
      slug: await uniqueSlug(name),
      passwordHash: hashPassword(input.password),
    },
  });
  await provisionUserDefaults(user.id);
  return { user };
}

/**
 * The founding user: the earliest account. Owns the pre-existing data and the
 * legacy A2A surface. Null on a fresh database with no signups yet.
 */
export async function foundingUser(): Promise<User | null> {
  return prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
}

/**
 * Claim the migration-created founder account from env, so the pre-existing
 * admin logs in with ADMIN_EMAIL (default admin@localhost) + ADMIN_PASSWORD.
 * Runs at boot; only ever touches a founder whose passwordHash is still the
 * migration's empty sentinel, so it can never overwrite a claimed account.
 */
export async function claimFoundingUser(): Promise<void> {
  const founder = await prisma.user.findUnique({ where: { id: FOUNDER_ID } });
  if (!founder || founder.passwordHash !== "") return;
  const password = process.env.ADMIN_PASSWORD || "";
  if (!password) {
    console.warn(
      "bootstrap: founder account is unclaimed and ADMIN_PASSWORD is unset — " +
        "set ADMIN_PASSWORD (and optionally ADMIN_EMAIL) to claim it.",
    );
    return;
  }

  const email = (process.env.ADMIN_EMAIL || "admin@localhost").trim().toLowerCase();
  // Name the account after the business identity it already owns.
  const profile = await prisma.profile.findUnique({ where: { userId: FOUNDER_ID } });
  const name = profile?.owner_name.trim() || profile?.company_name.trim() || "Founder";

  // Rename the placeholder slug after the real identity, when that produces
  // something different; "founder" stays "founder" rather than "founder-1".
  let slug = founder.slug;
  if (slug === "founder" && slugify(name) !== "founder") slug = await uniqueSlug(name);

  await prisma.user.update({
    where: { id: FOUNDER_ID },
    data: { email, name, slug, passwordHash: hashPassword(password) },
  });
  console.log(`bootstrap: founder account claimed as ${email}`);
}

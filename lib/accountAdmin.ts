import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { accountActive, hashPassword } from "@/lib/auth";
import { createUser, foundingUser, slugify, uniqueSlug } from "@/lib/users";

export { accountActive };

/**
 * Operator-gated account administration for the Users tab. Every User row is
 * a tenant; there is deliberately no role system — the operator gate below is
 * the entire permission model (see docs/features/admin-user-management).
 */

export type AccountRow = {
  id: string;
  name: string;
  email: string;
  slug: string;
  createdAt: Date;
  onboardedAt: Date | null;
  disabledAt: Date | null;
};

type Ok = { ok: true };
type Err = { error: string };

/**
 * Whether this signed-in user may administer accounts: their email is listed
 * in OPERATOR_EMAILS (comma-separated, case-insensitive), or — when that env
 * var is unset/blank — they are the founding user, so existing deployments
 * get the Users tab without new configuration.
 */
export async function isOperator(user: { id: string; email: string }): Promise<boolean> {
  const raw = process.env.OPERATOR_EMAILS ?? "";
  const listed = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (listed.length > 0) return listed.includes(user.email.trim().toLowerCase());
  const founder = await foundingUser();
  return founder !== null && founder.id === user.id;
}

/** All accounts matching `q` (name/email/slug, case-insensitive), paginated. */
export async function listAccounts(opts: {
  q?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ rows: AccountRow[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
  const terms = (opts.q ?? "").trim().split(/\s+/).filter(Boolean);
  // Every term must match somewhere, so "Proof bob" finds "Proof Bob".
  const where = {
    AND: terms.map((t) => ({
      OR: [
        { name: { contains: t, mode: "insensitive" as const } },
        { email: { contains: t, mode: "insensitive" as const } },
        { slug: { contains: t, mode: "insensitive" as const } },
      ],
    })),
  };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        slug: true,
        createdAt: true,
        onboardedAt: true,
        disabledAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

/**
 * Edit identity fields. Email and slug are normalized and checked for
 * collisions; slugs go through the same slugify/reserved rules as signup.
 */
export async function updateAccount(
  id: string,
  data: { name?: string; email?: string; slug?: string },
): Promise<Ok | Err> {
  const patch: { name?: string; email?: string; slug?: string } = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) return { error: "A display name is required." };
    patch.name = name;
  }

  if (data.email !== undefined) {
    const email = data.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { error: "That email doesn't look right." };
    }
    const holder = await prisma.user.findUnique({ where: { email } });
    if (holder && holder.id !== id) {
      return { error: "Another account already uses that email." };
    }
    patch.email = email;
  }

  if (data.slug !== undefined) {
    const slug = slugify(data.slug);
    // uniqueSlug suffixes reserved words, so a reserved request never lands
    // verbatim — surface that as a refusal instead of a silent rename.
    if ((await uniqueSlug(slug)) !== slug) {
      const holder = await prisma.user.findUnique({ where: { slug } });
      if (!holder || holder.id !== id) {
        return holder
          ? { error: "Another account already uses that slug." }
          : { error: "That slug is reserved." };
      }
    }
    patch.slug = slug;
  }

  if (Object.keys(patch).length === 0) return { ok: true };
  await prisma.user.update({ where: { id }, data: patch });
  return { ok: true };
}

/** Disable (block login + sessions) or re-enable an account. Never self. */
export async function setAccountDisabled(
  id: string,
  disabled: boolean,
  actorId: string,
): Promise<Ok | Err> {
  if (disabled && id === actorId) {
    return { error: "You can't disable your own account." };
  }
  await prisma.user.update({
    where: { id },
    data: { disabledAt: disabled ? new Date() : null },
  });
  return { ok: true };
}

/**
 * Replace an account's password with a generated one, returned exactly once
 * for the operator to hand over out of band. Stored as the usual scrypt hash.
 */
export async function issuePassword(id: string): Promise<{ password: string } | Err> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { error: "No such account." };
  const password = randomBytes(12).toString("base64url");
  await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } });
  return { password };
}

/**
 * Create an account on a user's behalf: the same signup path (validation,
 * slug, starter provisioning), with a generated password returned exactly
 * once for the operator to hand over.
 */
export async function createAccount(input: {
  name: string;
  email: string;
}): Promise<{ password: string } | Err> {
  const password = randomBytes(12).toString("base64url");
  const result = await createUser({ name: input.name, email: input.email, password });
  return "error" in result ? result : { password };
}

/**
 * Hard-delete an account. Every owned row goes with it — the schema cascades
 * all user-owned tables — and nothing else is touched. Never self.
 */
export async function deleteAccount(id: string, actorId: string): Promise<Ok | Err> {
  if (id === actorId) return { error: "You can't delete your own account." };
  try {
    await prisma.user.delete({ where: { id } });
  } catch {
    return { error: "No such account." };
  }
  return { ok: true };
}

export type ChatHistorySession = {
  id: string;
  firstQuery: string;
  updatedAt: Date;
  messages: { id: string; role: string; content: string; createdAt: Date }[];
};

/** A user's visitor conversations, newest first, messages in order. */
export async function listChatSessions(userId: string): Promise<ChatHistorySession[]> {
  return prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      firstQuery: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
      },
    },
  });
}

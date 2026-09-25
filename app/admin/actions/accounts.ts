"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { accountActive, createSession } from "@/lib/auth";
import { createAccount, deleteAccount, isOperator, issuePassword, setAccountDisabled, updateAccount } from "@/lib/accountAdmin";
import type { User } from "@prisma/client";
import { requireUser, revalidateAll } from "./_shared";

// ── Account administration (operator-gated Users tab) ──

/** The logged-in operator, or an authorization error for everyone else. */
async function requireOperator(): Promise<User> {
  const user = await requireUser();
  if (!(await isOperator(user))) throw new Error("Not authorized.");
  return user;
}

export async function updateAccountAction(formData: FormData) {
  await requireOperator();
  const result = await updateAccount(String(formData.get("id") ?? ""), {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  });
  revalidateAll();
  return result;
}

export async function setAccountDisabledAction(formData: FormData) {
  const operator = await requireOperator();
  const result = await setAccountDisabled(
    String(formData.get("id") ?? ""),
    formData.get("disabled") === "1",
    operator.id,
  );
  revalidateAll();
  return result;
}

/** Returns the generated password once; it is never persisted in the clear. */
export async function issuePasswordAction(id: string) {
  await requireOperator();
  return issuePassword(id);
}

/** Returns the new account's generated password once. */
export async function createAccountAction(formData: FormData) {
  await requireOperator();
  const result = await createAccount({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  revalidateAll();
  return result;
}

export async function deleteAccountAction(formData: FormData) {
  const operator = await requireOperator();
  const result = await deleteAccount(String(formData.get("id") ?? ""), operator.id);
  revalidateAll();
  return result;
}

/**
 * "Log in as": swap the operator's session for the target account's and land
 * on its control room. One-way by design — log out to leave.
 */
export async function impersonateAction(formData: FormData) {
  await requireOperator();
  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || !accountActive(target)) throw new Error("No such active account.");
  await createSession(target.id);
  redirect("/admin/chat");
}

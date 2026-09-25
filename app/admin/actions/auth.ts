"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/auth";
import { authenticate } from "@/lib/bulkAccounts";
import { createUser } from "@/lib/users";

// ── Auth ──
/** The "email" field accepts an email or a bulk-built username (no "@"). */
export async function login(formData: FormData) {
  const identifier = String(formData.get("email") ?? "").trim();
  const pw = String(formData.get("password") ?? "");
  const user = identifier ? await authenticate(identifier, pw) : null;
  if (!user) redirect("/admin?error=1");
  await createSession(user.id);
  redirect("/admin/chat");
}

export async function signup(formData: FormData) {
  const result = await createUser({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if ("error" in result) {
    redirect(`/signup?error=${encodeURIComponent(result.error)}`);
  }
  await createSession(result.user.id);
  redirect("/admin/chat");
}

export async function logout() {
  await destroySession();
  redirect("/admin");
}

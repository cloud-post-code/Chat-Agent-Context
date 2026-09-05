import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthed } from "@/lib/auth";
import { login } from "./actions";
import { PendingButton } from "./PendingButton";

export const dynamic = "force-dynamic";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  background: "var(--bg-soft)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  marginBottom: 14,
  outline: "none",
  color: "var(--on-bg-soft)",
};

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAuthed()) redirect("/admin/chat");
  const { error } = await searchParams;

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <form
        action={login}
        data-fill="surface"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          padding: 32,
          width: "100%",
          maxWidth: 380,
          boxShadow: "var(--glow-primary)",
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>Log in</h1>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14, marginBottom: 20 }}>
          Your control room. Manage your agent page&apos;s knowledge, persona, and look.
        </p>
        {error && (
          <p style={{ color: "var(--danger-on-surface)", fontSize: 14, marginBottom: 12 }}>
            Wrong email or password. Try again.
          </p>
        )}
        <input
          type="email"
          name="email"
          placeholder="Email"
          autoComplete="email"
          autoFocus
          required
          style={inputStyle}
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          required
          style={inputStyle}
        />
        <PendingButton
          pendingLabel="Signing in…"
          style={{
            width: "100%",
            padding: "12px",
            background: "var(--primary)",
            color: "var(--on-primary)",
            border: "none",
            borderRadius: "var(--radius-md)",
            fontWeight: 600,
          }}
        >
          Enter →
        </PendingButton>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
          No account yet? <Link href="/signup">Create your agent page</Link>
        </p>
        <Link href="/" style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 13 }}>
          ← back to the directory
        </Link>
      </form>
    </main>
  );
}

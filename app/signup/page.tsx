import { redirect } from "next/navigation";
import Link from "next/link";
import { isAuthed } from "@/lib/auth";
import { signup } from "@/app/admin/actions/auth";
import { PendingButton } from "../admin/PendingButton";

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

export default async function SignupPage({
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
        action={signup}
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
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>Create your agent page</h1>
        <p style={{ color: "var(--on-surface)", fontStyle: "italic", fontSize: 14, marginBottom: 20 }}>
          Sign up to get a public AI agent page plus a dashboard to teach it
          everything it should know.
        </p>
        {error && (
          <p style={{ color: "var(--danger-on-surface)", fontSize: 14, marginBottom: 12 }}>
            {error}
          </p>
        )}
        <input
          type="text"
          name="name"
          placeholder="Display name"
          autoComplete="name"
          autoFocus
          required
          style={inputStyle}
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          autoComplete="email"
          required
          style={inputStyle}
        />
        <input
          type="password"
          name="password"
          placeholder="Password (8+ characters)"
          autoComplete="new-password"
          minLength={8}
          required
          style={inputStyle}
        />
        <PendingButton
          pendingLabel="Creating…"
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
          Sign up →
        </PendingButton>
        <p style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
          Already have an account? <Link href="/admin">Log in</Link>
        </p>
        <Link href="/" style={{ display: "block", textAlign: "center", marginTop: 8, fontSize: 13 }}>
          ← back to the directory
        </Link>
      </form>
    </main>
  );
}

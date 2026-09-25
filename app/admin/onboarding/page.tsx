import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { logout } from "@/app/admin/actions/auth";
import { OnboardingFlow } from "./OnboardingFlow";

export const dynamic = "force-dynamic";

/**
 * Guided onboarding, shown exactly once: a user with no onboardedAt lands
 * here from anywhere in the admin panel, and a user who finished (either
 * path) is bounced straight back to the dashboard.
 */
export default async function OnboardingPage() {
  const user = await currentUser();
  if (!user) redirect("/admin");
  if (user.onboardedAt) redirect("/admin/chat");

  return (
    <main
      data-onboarding
      style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px" }}
    >
      {/* Escape hatch: without it, an operator who used "log in as" on a
          not-yet-onboarded account (Users tab) is stuck in this session. */}
      <form action={logout} style={{ float: "right" }}>
        <button
          type="submit"
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            color: "inherit",
            fontStyle: "italic",
            fontSize: 13,
            padding: "7px 12px",
          }}
        >
          Log out
        </button>
      </form>
      <h1 style={{ marginBottom: 4 }}>Welcome, {user.name} — onboarding</h1>
      <p style={{ opacity: 0.75, marginBottom: 28 }}>
        Set up your agent page in three steps. Pull everything from your
        existing site, or fill it in yourself.
      </p>
      <OnboardingFlow />
    </main>
  );
}

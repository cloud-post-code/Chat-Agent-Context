import { prisma } from "@/lib/db";
import { claimFoundingUser, provisionUserDefaults } from "@/lib/users";
import { PERSONA_SECTIONS } from "@/lib/persona";

/**
 * Deterministic database bootstrap, run by instrumentation.ts on every
 * server start — right after `prisma db push` (the start script) has applied
 * the schema. The database therefore begins, and stays, in the correct
 * structure on every deployment: starter rows exist, and data written under
 * retired shapes is rewritten to the current one.
 *
 * Every step is idempotent and best-effort: seeds fill EMPTY tables only
 * (never resurrecting deletions), migrations rewrite only old-shape rows,
 * and no failure may block boot — the site must come up even if the DB
 * hiccups, exactly like the admin's own best-effort saves.
 *
 * This module is also the ONLY home of legacy-shape knowledge. Runtime code
 * reads and writes the current shape exclusively; when an old shape turns
 * up here, it is migrated once and never consulted again.
 */

/** The retired 21-section persona catalogue, kept solely for migration. */
const LEGACY_PERSONA_SECTIONS: { key: string; label: string }[] = [
  { key: "core_profile", label: "Core profile" },
  { key: "context_identity", label: "Context & identity" },
  { key: "cognitive_frame", label: "Cognitive frame" },
  { key: "decision_dynamics", label: "Behavioral & decision dynamics" },
  { key: "operating_model", label: "Operating / interaction model" },
  { key: "evidence_triggers", label: "Evidence, beliefs, and triggers" },
  { key: "communication_style", label: "Communication & interaction style" },
  { key: "goals_outcomes", label: "Goals & outcomes" },
  { key: "meta_attributes", label: "Meta attributes" },
  { key: "daily_workflow", label: "Daily workflow" },
  { key: "decision_making", label: "Decision making" },
  { key: "technology_adoption", label: "Technology adoption" },
  { key: "problem_solving", label: "Problem solving" },
  { key: "communication_behavior", label: "Communication behavior" },
  { key: "stress_response", label: "Stress response" },
  { key: "purchasing_behavior", label: "Purchasing behavior" },
  { key: "change_management", label: "Change management" },
  { key: "scenarios", label: "Scenario behaviors" },
  { key: "behavioral_indicators", label: "Behavioral indicators" },
  { key: "behavioral_summary", label: "Behavioral summary" },
  { key: "notes", label: "Notes" },
];

/** Join whatever the old catalogue held into one editable block of prose. */
export function foldLegacySections(stored: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const { key, label } of LEGACY_PERSONA_SECTIONS) {
    const v = stored[key];
    if (typeof v === "string" && v.trim()) parts.push(`${label}\n${v.trim()}`);
  }
  return parts.join("\n\n");
}

/**
 * Rewrite personaSections stored under the retired catalogue into the
 * current single-field shape. A row already in the current shape is left
 * byte-identical (so re-running is a no-op and updatedAt doesn't churn).
 */
async function migrateLegacyPersona(userId: string): Promise<void> {
  const persona = await prisma.personaConfig.findUnique({ where: { userId } });
  if (!persona) return;
  let stored: Record<string, unknown>;
  try {
    const parsed = JSON.parse(persona.personaSections || "{}");
    stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    stored = {};
  }
  const currentKeys = new Set(PERSONA_SECTIONS.map((s) => s.key));
  const hasLegacyKeys = Object.keys(stored).some((k) => !currentKeys.has(k));
  if (!hasLegacyKeys) return;

  const clean: Record<string, string> = {};
  for (const s of PERSONA_SECTIONS) {
    const v = stored[s.key];
    if (typeof v === "string" && v.trim()) clean[s.key] = v;
  }
  // Nothing in the new field yet — carry the old sections' text forward.
  if (!clean.persona?.trim()) {
    const folded = foldLegacySections(stored);
    if (folded) clean.persona = folded;
    else delete clean.persona;
  }
  await prisma.personaConfig.update({
    where: { userId },
    data: { personaSections: JSON.stringify(clean) },
  });
}

/** Run every bootstrap step; each failure logs and moves on. */
export async function bootstrapDatabase(): Promise<void> {
  // Claim the migration-created founder account from env first, so the
  // pre-existing admin can log in on the very first multi-tenant boot.
  try {
    await claimFoundingUser();
  } catch (e) {
    console.error("bootstrap: claim founding user failed:", e);
  }

  // Per-user upkeep: starter rows for anyone with none (same fill-empty-only
  // rule the old global seeds followed) and legacy-shape rewrites.
  let users: { id: string }[] = [];
  try {
    users = await prisma.user.findMany({ select: { id: true } });
  } catch (e) {
    console.error("bootstrap: listing users failed:", e);
    return;
  }
  for (const user of users) {
    const steps: Array<[string, () => Promise<void>]> = [
      ["provision defaults", () => provisionUserDefaults(user.id)],
      ["migrate legacy persona", () => migrateLegacyPersona(user.id)],
    ];
    for (const [label, run] of steps) {
      try {
        await run();
      } catch (e) {
        console.error(`bootstrap: ${label} for ${user.id} failed:`, e);
      }
    }
  }
}

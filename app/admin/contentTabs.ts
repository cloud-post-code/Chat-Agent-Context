/**
 * Keys of the sub-tabs inside the combined Content section — the starter
 * ingestion sources (STARTER_INGESTION_SOURCES in lib/ingestionSources.ts),
 * which mirror what onboarding extracts from a business's website. The live
 * keys come from the IngestionSource table; this list is the fallback for
 * callers that have no rows to hand.
 */
export const CONTENT_TAB_KEYS = [
  "blog",
  "testimonials",
  "about-team",
  "services",
] as const;
export type ContentTabKey = (typeof CONTENT_TAB_KEYS)[number];

/**
 * Key of the Content sub-tab that hosts the new-ingestion-source builder.
 * Not an IngestionSource row — the dashboard appends it after the source
 * tabs — but it deep-links like one (`?tab=new-source`).
 */
export const NEW_SOURCE_TAB_KEY = "new-source";

/** Keys of the sub-tabs inside the combined Activity section. */
export const ACTIVITY_TAB_KEYS = ["activity"] as const;
export type ActivityTabKey = (typeof ACTIVITY_TAB_KEYS)[number];

/**
 * Keys of the sub-tabs inside the Agent Behavior section.
 *
 * `contacts` was listed under Activity when the address book lived there. The
 * panel moved to Agent Behavior but the key did not, so `?tab=contacts`
 * resolved to an Activity sub-tab that no longer exists — the sent-mail sync
 * redirects here, so the key has to point at the panel that is actually
 * mounted.
 */
export const AGENT_TAB_KEYS = ["answers", "goals", "rules", "contacts", "a2ui"] as const;
export type AgentTabKey = (typeof AGENT_TAB_KEYS)[number];

/** Keys of the sub-tabs inside the combined Me section. */
export const ME_TAB_KEYS = ["profile", "theme"] as const;
export type MeTabKey = (typeof ME_TAB_KEYS)[number];

/**
 * Deep-link resolution for the dashboard. `projects` and `knowledge` used to
 * be top-level nav keys and now live inside the Content section (as does
 * `persona`), `contacts` now lives inside the Activity section, `answers`
 * (shown as "Presets") now lives inside the Agent Behavior section, and
 * `theme` now lives inside the Me section — so an old `?tab=` link resolves
 * to the combined
 * entry opened on that sub-tab; every other key passes through untouched.
 */
export function resolveAdminTab(
  tab: string | undefined,
  // The live Content keys come from the IngestionSource table so deep links
  // to custom sources resolve; callers without the rows get the built-ins.
  contentKeys: readonly string[] = CONTENT_TAB_KEYS,
): {
  nav: string | undefined;
  sub: string | undefined;
} {
  if (tab && (tab === NEW_SOURCE_TAB_KEY || contentKeys.includes(tab))) {
    return { nav: "content", sub: tab };
  }
  if (tab && (ACTIVITY_TAB_KEYS as readonly string[]).includes(tab)) {
    return { nav: "activity", sub: tab as ActivityTabKey };
  }
  if (tab && (AGENT_TAB_KEYS as readonly string[]).includes(tab)) {
    return { nav: "agent", sub: tab as AgentTabKey };
  }
  if (tab && (ME_TAB_KEYS as readonly string[]).includes(tab)) {
    return { nav: "profile", sub: tab as MeTabKey };
  }
  return { nav: tab, sub: undefined };
}

/**
 * The Content tab strip, computed from IngestionSource rows: enabled rows in
 * row order (DB order IS display order), each paired with its panel by key.
 * Rows with no panel are dropped — a custom source must never crash the
 * dashboard before its panel exists. Pure, so it's provable offline.
 */
export function contentTabsFromSources<T>(
  rows: ReadonlyArray<{ key: string; label: string; enabled: boolean }>,
  panels: Record<string, T>,
): Array<{ key: string; label: string; content: T }> {
  return rows
    .filter((r) => r.enabled && panels[r.key] !== undefined)
    .map((r) => ({ key: r.key, label: r.label, content: panels[r.key] }));
}

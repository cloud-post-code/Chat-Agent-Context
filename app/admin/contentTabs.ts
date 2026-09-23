/**
 * The admin dashboard's navigation, in one place. Import-free on purpose so
 * the dashboard page, the copilot brain (lib/adminBrain.ts) and offline proofs
 * can all read it without pulling server-only code.
 */

/**
 * Keys of the starter ingestion sources (STARTER_INGESTION_SOURCES in
 * lib/ingestionSources.ts), which mirror what onboarding extracts from a
 * business's website. The live keys come from the IngestionSource table; this
 * list is the fallback for callers that have no rows to hand.
 */
export const CONTENT_TAB_KEYS = [
  "blog",
  "testimonials",
  "about-team",
  "services",
] as const;
export type ContentTabKey = (typeof CONTENT_TAB_KEYS)[number];

/**
 * Key of the Knowledge sub-tab that hosts the new-ingestion-source builder.
 * Not an IngestionSource row — the dashboard appends it after the source
 * tabs — but it deep-links like one (`?tab=new-source`).
 */
export const NEW_SOURCE_TAB_KEY = "new-source";

export type NavKey = "home" | "inbox" | "knowledge" | "agent" | "cards" | "booking" | "settings";

export type NavSub = {
  key: string;
  label: string;
  operator?: boolean;
  /** A short "when to reveal this" note for the copilot's system prompt. */
  hint?: string;
};

export type NavGroup = {
  key: NavKey;
  label: string;
  /** Fixed sub-panel keys in strip order. Knowledge's live source keys are
   *  spliced in by the dashboard ahead of these. */
  subs: readonly NavSub[];
};

/**
 * The six sections and the panels each holds. Panel keys are the contract
 * shared with panels.tsx (`flat`), `?tab=` deep links and the copilot's
 * show_panel tool, so renaming one here means renaming it there.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  { key: "home", label: "Home", subs: [{ key: "home", label: "Home" }] },
  {
    key: "inbox",
    label: "Inbox",
    subs: [
      { key: "activity", label: "Chats", hint: "visitor conversations, metrics and answer feedback" },
      { key: "appointments", label: "Appointments", hint: "the booked appointments themselves; cancel, confirm waitlist" },
      { key: "orders", label: "Orders", hint: "orders placed from the menu cart" },
    ],
  },
  {
    key: "knowledge",
    label: "Knowledge",
    subs: [
      { key: NEW_SOURCE_TAB_KEY, label: "+ New source" },
      { key: "graph", label: "Health" },
    ],
  },
  {
    key: "agent",
    label: "Agent",
    subs: [
      { key: "answers", label: "Presets" },
      { key: "goals", label: "Goals" },
      { key: "rules", label: "Rules" },
    ],
  },
  { key: "cards", label: "Cards", subs: [{ key: "a2ui", label: "Cards" }] },
  {
    // The booking setup (app/admin/booking/). Always present, on or off:
    // Services carries the switch that turns booking back on.
    key: "booking",
    label: "Booking",
    subs: [
      {
        key: "booking-services",
        label: "Services",
        hint: "what's bookable — pricing, duration, who performs it, where; the booking on/off switch",
      },
      {
        key: "booking-providers",
        label: "Providers",
        hint: "the staff who perform services — their hours, time off, bios, per-service overrides",
      },
      { key: "booking-locations", label: "Locations", hint: "branches, the online option, and the mobile service area" },
      {
        key: "booking-hours",
        label: "Hours & rules",
        hint: "business hours, holidays, lead time, cutoff, buffers, waitlist, recurring, provider selection",
      },
      {
        key: "booking-customer",
        label: "Customer details",
        hint: "which customer fields the booking flow asks for and whether each is required",
      },
      {
        key: "booking-questions",
        label: "Questions",
        hint: "the intake question catalog asked during booking, including conditional questions",
      },
      {
        key: "booking-pricing",
        label: "Pricing & policies",
        hint: "currency, tax, service fee, tips, promo codes, memberships, cancellation/deposit policy",
      },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    subs: [
      { key: "profile", label: "Profile" },
      { key: "theme", label: "Theme" },
      { key: "contacts", label: "Contacts" },
      { key: "users", label: "Users", operator: true },
    ],
  },
];

/** Keys of the Booking section's sub-tabs, in strip order. */
export const BOOKING_TAB_KEYS: readonly string[] = NAV_GROUPS.find((g) => g.key === "booking")!.subs.map(
  (s) => s.key,
);

/**
 * Legacy `?tab=` and show_panel keys → the panel that now holds them. The
 * combined Calendar panel became Appointments (Inbox); its on/off switch now
 * sits atop Booking › Services; "me" was the old Profile nav.
 */
export const TAB_ALIASES: Readonly<Record<string, string>> = {
  calendar: "appointments",
  booking: "booking-services",
  me: "profile",
};

/** The fixed (non-source) panels the copilot may reveal; never Home. */
export function fixedPanelEntries(
  operator: boolean,
): Array<{ key: string; label: string; hint?: string }> {
  return NAV_GROUPS.filter((g) => g.key !== "home")
    .flatMap((g) => g.subs)
    .filter((s) => !s.operator || operator)
    .map((s) => ({ key: s.key, label: s.label, ...(s.hint ? { hint: s.hint } : {}) }));
}

/** Display label per fixed panel key, as the dashboard strips show them. */
export function labelsFromNav(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of NAV_GROUPS) for (const s of g.subs) out[s.key] = s.label;
  return out;
}

/** Which nav group holds a fixed panel key, if any. */
export function navForPanel(key: string): NavKey | undefined {
  return NAV_GROUPS.find((g) => g.subs.some((s) => s.key === key))?.key;
}

/**
 * Deep-link resolution for the dashboard: a panel key opens its group on
 * that sub-tab. Source keys and the builder land on Knowledge; the old
 * "content" nav key opens Knowledge on the first live source. Unknown keys
 * pass through untouched so a stale link still lands somewhere sensible.
 */
export function resolveAdminTab(
  tab: string | undefined,
  // The live Knowledge keys come from the IngestionSource table so deep links
  // to custom sources resolve; callers without the rows get the starters.
  contentKeys: readonly string[] = CONTENT_TAB_KEYS,
): { nav: string | undefined; sub: string | undefined } {
  if (!tab) return { nav: undefined, sub: undefined };
  if (tab === "content") return { nav: "knowledge", sub: contentKeys[0] };
  const key = TAB_ALIASES[tab] ?? tab;
  if (key === NEW_SOURCE_TAB_KEY || contentKeys.includes(key)) {
    return { nav: "knowledge", sub: key };
  }
  const nav = navForPanel(key);
  return nav ? { nav, sub: key } : { nav: key, sub: undefined };
}

/**
 * The Knowledge source strip, computed from IngestionSource rows: enabled rows
 * in row order (DB order IS display order), each paired with its panel by key.
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

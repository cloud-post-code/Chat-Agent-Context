/**
 * The card tools a canned answer may attach. Kept prisma-free so client
 * components (app/admin/CardFields.tsx) can import it without dragging the
 * database client into the browser bundle. lib/canned.ts re-exports it.
 */
/** The tools a canned answer may name to draw a card alongside its text. */
export const CARD_TOOLS = [
  "show_projects",
  "show_project",
  "show_gallery",
  "show_services",
  // The menu and the cart it feeds (lib/menu.ts).
  "show_menu",
  "show_cart",
  "show_contact_form",
  // The booking wizard; hydration guards it, so a canned answer naming it
  // after booking is disabled draws nothing.
  "show_booking",
  // The business's own social links, filterable to specific platforms.
  "show_social",
] as const;

export type CardTool = (typeof CARD_TOOLS)[number];

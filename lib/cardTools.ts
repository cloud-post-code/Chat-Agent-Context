import { prisma } from "./db";
import { listServices } from "./cards";

/**
 * Which card tools a tenant's own data allows. A card is offered exactly when
 * there is something on file for it to draw — nothing is curated per card:
 *
 *   show_projects / show_project   projects on file
 *   show_gallery                   curated photos (not `ingest:*` ones)
 *   show_services                  services: the booking flow's Service rows,
 *                                  or the services knowledge onboarding saved
 *   show_menu / show_cart          menu items the extractor wrote (the menu's
 *                                  services fallback in lib/menu.ts is for
 *                                  hydrating a canned answer, not for offering
 *                                  every services business a menu)
 *   show_contact_form              always — every business can be written to
 *
 * Booking (`show_booking`) is gated by its own toggle and social
 * (`show_social`) by the tenant having links on file; both live in
 * lib/brain.ts. lib/brain.ts offers the tools this names and lib/knowledge.ts
 * writes the "when to use each" guidance for the same set, so the two never
 * disagree about which cards exist. A failed read degrades to the contact
 * form alone: a card-less answer beats a failed one.
 */
export const CARD_TOOL_NAMES = [
  "show_projects",
  "show_project",
  "show_gallery",
  "show_services",
  "show_menu",
  "show_cart",
  "show_contact_form",
] as const;

export type CardToolName = (typeof CARD_TOOL_NAMES)[number];

export async function availableCardTools(userId: string): Promise<Set<CardToolName>> {
  const tools = new Set<CardToolName>(["show_contact_form"]);
  try {
    const [projects, photos, services, menuItems] = await Promise.all([
      prisma.project.count({ where: { userId } }),
      prisma.photo.count({ where: { userId, NOT: { kind: { startsWith: "ingest:" } } } }),
      hasServices(userId),
      prisma.menuItem.count({ where: { userId } }),
    ]);
    if (projects > 0) {
      tools.add("show_projects");
      tools.add("show_project");
    }
    if (photos > 0) tools.add("show_gallery");
    if (services) tools.add("show_services");
    if (menuItems > 0) {
      tools.add("show_menu");
      tools.add("show_cart");
    }
  } catch {
    // The contact form alone.
  }
  return tools;
}

/** Services on file, from either source the services card reads. */
async function hasServices(userId: string): Promise<boolean> {
  if ((await prisma.service.count({ where: { userId, enabled: true } })) > 0) return true;
  return (await listServices(userId)).length > 0;
}

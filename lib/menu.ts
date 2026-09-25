import { prisma } from "./db";
import { durationFromText, priceFromText } from "./serviceCatalog";
import { listServices, type BookingField } from "./cards";
import {
  filterMenu,
  groupMenu,
  sanitizeMenuItem,
  uniqueKeys,
  displayPrice,
  MAX_MENU_ITEMS,
  type Fulfillment,
  type MenuFilter,
  type MenuItemData,
} from "./menuTypes";

/**
 * The menu store: the structured items the extractor writes, read back for
 * the menu card, the prompt's index and the order validator. Data only — the
 * cards live in app/cards/MenuCard.tsx and CartCard.tsx.
 *
 * A tenant with no rows still has a menu: the services catalog on file is
 * read as items (price and duration out of the prose, lib/serviceCatalog.ts's
 * readers), so every business with services gets the card without re-onboarding.
 */

/** Replace the whole menu; the site's order is kept. Returns how many were written. */
export async function replaceMenu(userId: string, raw: unknown[]): Promise<number> {
  const items = uniqueKeys(
    raw.map(sanitizeMenuItem).filter((i): i is MenuItemData => !!i).slice(0, MAX_MENU_ITEMS),
  );
  await prisma.$transaction([
    prisma.menuItem.deleteMany({ where: { userId } }),
    ...items.map((it, order) =>
      prisma.menuItem.create({
        data: { userId, key: it.key, name: it.name, category: it.category, order, data: JSON.stringify(it) },
      }),
    ),
  ]);
  return items.length;
}

/** The services catalog as menu items, for tenants onboarded before the table. */
function itemsFromServices(services: { id: string; name: string; description: string }[]): MenuItemData[] {
  return uniqueKeys(
    services
      .map((s) => {
        const price = priceFromText(s.description);
        const duration = durationFromText(s.description);
        return sanitizeMenuItem({
          name: s.name,
          shortDescription: s.description.length <= 200 ? s.description : "",
          fullDescription: s.description.length > 200 ? s.description : "",
          price: price.replace(/\+$/, ""),
          priceType: price.endsWith("+") ? "starting_at" : price ? "fixed" : "varies",
          estimatedTime: duration,
        });
      })
      .filter((i): i is MenuItemData => !!i),
  );
}

/** Every item on file, in menu order. */
export async function listMenu(userId: string): Promise<MenuItemData[]> {
  const rows = await prisma.menuItem.findMany({ where: { userId }, orderBy: { order: "asc" } });
  if (rows.length) {
    return rows
      .map((r) => {
        try {
          return sanitizeMenuItem({ ...JSON.parse(r.data), key: r.key, name: r.name, category: r.category });
        } catch {
          return sanitizeMenuItem({ key: r.key, name: r.name, category: r.category });
        }
      })
      .filter((i): i is MenuItemData => !!i);
  }
  return itemsFromServices(await listServices(userId));
}

/**
 * What checkout has to ask, decided from the menu and the tenant's booking
 * form: the ways the menu says it is fulfilled, and the contact questions the
 * tenant already asks (the booking form's phone/email, else email).
 */
export type CartCheckout = {
  fulfillment: Fulfillment[];
  contact: { phone: "required" | "optional" | "off"; email: "required" | "optional" | "off" };
  currency: string;
};

export type MenuBlock = {
  type: "menu";
  title: string;
  /** True when this is the whole menu (sections fold); false for a curated list. */
  full: boolean;
  items: MenuItemData[];
  checkout: CartCheckout;
};

export type CartBlock = { type: "cart"; checkout: CartCheckout };

async function checkoutFor(userId: string, items: MenuItemData[]): Promise<CartCheckout> {
  const { getBookingConfig } = await import("./appointments");
  const { fields } = await getBookingConfig(userId);
  const need = (type: BookingField["type"]): "required" | "optional" | "off" => {
    const f = fields.find((x) => x.type === type);
    return f ? (f.required ? "required" : "optional") : "off";
  };
  let phone = need("phone");
  let email = need("email");
  if (phone === "off" && email === "off") email = "required";
  if (phone !== "required" && email !== "required") {
    if (email !== "off") email = "required";
    else phone = "required";
  }
  const fulfillment = [...new Set(items.flatMap((i) => i.fulfillment))];
  const currency = items.find((i) => i.currency)?.currency ?? "";
  return { fulfillment, contact: { phone, email }, currency };
}

/**
 * The menu card: the whole menu grouped by section, or the curated list a
 * filter names. Null when nothing matches (or nothing is on file), so the
 * model answers in words instead of a visitor seeing an empty menu.
 */
export async function menuBlock(userId: string, input: Record<string, unknown>): Promise<MenuBlock | null> {
  const all = await listMenu(userId);
  if (!all.length) return null;
  const filter: MenuFilter = {
    keys: Array.isArray(input.keys) ? input.keys.map(String) : undefined,
    category: typeof input.category === "string" ? input.category : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
  };
  const items = filterMenu(all, filter);
  if (!items.length) return null;
  const full = items.length === all.length;
  const title = (typeof input.title === "string" && input.title.trim().slice(0, 80)) || (full ? "Menu" : "Picks for you");
  return { type: "menu", title, full, items, checkout: await checkoutFor(userId, all) };
}

/** The cart card: nothing but how to check out — the lines live with the visitor. */
export async function cartBlock(userId: string): Promise<CartBlock | null> {
  const all = await listMenu(userId);
  if (!all.length) return null;
  return { type: "cart", checkout: await checkoutFor(userId, all) };
}

/** One item by key, for add_to_cart and the order validator. */
export async function findMenuItem(userId: string, key: string): Promise<MenuItemData | null> {
  const k = key.trim().toLowerCase();
  return (await listMenu(userId)).find((i) => i.key === k) ?? null;
}

const INDEX_CAP = 3500;

/**
 * The MENU INDEX prompt section: one compact line per item so the model can
 * curate by key or tag without a search. Empty when nothing is on file.
 */
export async function menuPromptSection(userId: string): Promise<string> {
  const items = await listMenu(userId);
  if (!items.length) return "";
  const lines: string[] = [];
  let size = 0;
  for (const g of groupMenu(items)) {
    for (const it of g.items) {
      const facts = [
        displayPrice(it),
        ...it.dietaryTags,
        it.popularity.replace("_", " "),
        it.availability === "unavailable" ? "unavailable" : "",
        it.availability === "limited" ? "limited" : "",
      ].filter(Boolean);
      const line = `- ${it.key} | ${it.name}${g.name ? ` | ${g.name}` : ""}${facts.length ? ` | ${facts.join(", ")}` : ""}`;
      size += line.length + 1;
      if (size > INDEX_CAP) {
        lines.push(`- … and ${items.length - lines.length} more (show_menu with no filter lists them all)`);
        return section(lines);
      }
      lines.push(line);
    }
  }
  return section(lines);
}

function section(lines: string[]): string {
  return `

MENU INDEX (key | name | section | price, tags):
${lines.join("\n")}
Use show_menu to answer with the menu itself: no filter for everything ("what's on the menu?", "full price list"); "keys" for a curated list that fits the question (a mood, a budget, a pairing, "something for two"); "tags" for a dietary or popularity filter ("vegan", "gluten-free", "popular"); "category" for one section. Give a curated list a short "title". Use add_to_cart when the visitor asks to add something that is on the index, with the quantity they said; use show_cart when they want to see, change or check out their cart. Never quote a price or a tag that isn't in the index or KNOWLEDGE.`;
}

/** The VISITOR'S CART section, from the lines the page sent with the message. */
export function cartPromptSection(cart: { name: string; quantity: number; unitPrice?: string }[] | undefined): string {
  if (!cart?.length) return "";
  const lines = cart
    .slice(0, 30)
    .map((l) => `- ${l.quantity} × ${String(l.name).slice(0, 120)}${l.unitPrice ? ` (${String(l.unitPrice).slice(0, 20)} each)` : ""}`);
  return `

VISITOR'S CART (what they have added so far; answer questions about it from this, and draw show_cart when they want to see or change it):
${lines.join("\n")}`;
}

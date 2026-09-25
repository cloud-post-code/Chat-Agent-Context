/**
 * The menu shapes and their pure rules, with no imports.
 *
 * Three places must agree on what a menu item is and what an order line may
 * be: the extractor that writes items from the site, the cards that draw
 * items and hold the visitor's cart, and the server that validates an order.
 * Everything here is data and arithmetic — no store, no model, no React — so
 * the client bundle can carry it and a proof can drive it in isolation.
 *
 * Nothing is ever invented: every field is optional and a sanitizer keeps
 * only what a closed vocabulary allows. Prices are the business's own words
 * ("$24", "from $40", "market price") with a parsed amount beside them for
 * arithmetic; a line whose price can't be parsed makes the total a floor.
 */

const PRICE_TYPES = ["fixed", "starting_at", "market", "varies", "free"] as const;
type PriceType = (typeof PRICE_TYPES)[number];

const AVAILABILITIES = ["available", "unavailable", "limited", "unknown"] as const;
type Availability = (typeof AVAILABILITIES)[number];

const POPULARITIES = ["popular", "bestseller", "new", "staff_pick"] as const;
type Popularity = (typeof POPULARITIES)[number];

export const FULFILLMENTS = ["pickup", "delivery", "dine_in", "appointment", "shipping"] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  dine_in: "Dine in",
  appointment: "Appointment",
  shipping: "Shipping",
};

/** One choice inside a modifier: "Large", "Add chicken (+$5)". */
type ModifierChoice = { label: string; price?: string };

/**
 * A set of choices an item is customized with — size, side, temperature,
 * add-ons. `min`/`max` bound how many choices may be picked; `required` is
 * min ≥ 1 in the business's words; `defaults` are preselected.
 */
export type Modifier = {
  name: string;
  choices: ModifierChoice[];
  required: boolean;
  min: number;
  max: number;
  defaults: string[];
};

/** Everything the site states about one item. All optional but the name. */
export type MenuItemData = {
  key: string;
  name: string;
  category: string;
  subcategory: string;
  shortDescription: string;
  fullDescription: string;
  image: string;
  gallery: string[];
  price: string;
  priceType: PriceType;
  originalPrice: string;
  salePrice: string;
  currency: string;
  unit: string;
  availability: Availability;
  availabilityWindow: string;
  locations: string[];
  modifiers: Modifier[];
  quantityMin: number;
  quantityMax: number;
  ingredients: string[];
  dietaryTags: string[];
  allergens: string[];
  warnings: string[];
  customization: boolean;
  nutrition: string;
  servingSize: string;
  popularity: Popularity | "";
  tags: string[];
  rating: string;
  reviewCount: string;
  estimatedTime: string;
  inventory: string;
  fulfillment: Fulfillment[];
  related: string[];
  upsells: string[];
  pairings: string[];
};

export const MAX_MENU_ITEMS = 120;
const MAX_LIST = 12;
const MAX_MODIFIERS = 8;
const MAX_CHOICES = 20;
const MAX_QUANTITY = 20;
export const MAX_ORDER_LINES = 30;

const flat = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

const list = (v: unknown, max = MAX_LIST, each = 80): string[] => {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const s = flat(x, each);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "";

const count = (v: unknown, fallback: number, cap: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, cap) : fallback;

/** A URL an <img> may load: http(s) or a same-origin upload path. */
const imageUrl = (v: unknown): string => {
  const s = flat(v, 500);
  return /^(https?:\/\/|\/api\/uploads\/)/.test(s) ? s : "";
};

/** The key an item name becomes; one rule so every reader agrees. */
export const menuKey = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function sanitizeModifier(raw: unknown): Modifier | null {
  const m = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!m) return null;
  const name = flat(m.name, 80);
  if (!name) return null;
  const choices: ModifierChoice[] = [];
  const seen = new Set<string>();
  for (const c of Array.isArray(m.choices) ? m.choices : []) {
    const item = typeof c === "string" ? { label: c } : ((c ?? {}) as Record<string, unknown>);
    const label = flat(item.label, 80);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const price = flat(item.price, 30);
    choices.push(price ? { label, price } : { label });
    if (choices.length >= MAX_CHOICES) break;
  }
  if (!choices.length) return null;
  const required = m.required === true;
  let min = count(m.min, required ? 1 : 0, choices.length);
  let max = count(m.max, min > 1 ? min : 1, choices.length);
  if (required && min < 1) min = 1;
  if (max < min) max = min;
  const defaults = list(m.defaults, max, 80).filter((d) => seen.has(d.toLowerCase())).slice(0, max);
  return { name, choices, required: min >= 1, min, max, defaults };
}

/**
 * Anything → a menu item, or null when it has no name. Never throws: the
 * input is model output or stored JSON. A value outside its vocabulary is
 * dropped, not guessed at.
 */
export function sanitizeMenuItem(raw: unknown): MenuItemData | null {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const name = flat(r.name, 120);
  if (!name) return null;
  const key = menuKey(flat(r.key, 60) || name) || "item";
  const modifiers: Modifier[] = [];
  for (const m of Array.isArray(r.modifiers) ? r.modifiers : []) {
    const mod = sanitizeModifier(m);
    if (mod) modifiers.push(mod);
    if (modifiers.length >= MAX_MODIFIERS) break;
  }
  const quantityMin = Math.max(1, count(r.quantityMin, 1, MAX_QUANTITY));
  const quantityMax = Math.max(quantityMin, count(r.quantityMax, MAX_QUANTITY, MAX_QUANTITY));
  const fulfillment = list(r.fulfillment, FULFILLMENTS.length, 20).filter(
    (f): f is Fulfillment => (FULFILLMENTS as readonly string[]).includes(f),
  );
  const price = flat(r.price, 40);
  const salePrice = flat(r.salePrice, 40);
  return {
    key,
    name,
    category: flat(r.category, 60),
    subcategory: flat(r.subcategory, 60),
    shortDescription: flat(r.shortDescription, 200),
    fullDescription: flat(r.fullDescription, 1200),
    image: imageUrl(r.image),
    gallery: list(r.gallery, 6, 500).map(imageUrl).filter(Boolean),
    price: price || salePrice,
    priceType: oneOf(r.priceType, PRICE_TYPES) || (price || salePrice ? "fixed" : "varies"),
    originalPrice: flat(r.originalPrice, 40),
    salePrice,
    currency: flat(r.currency, 8),
    unit: flat(r.unit, 30),
    availability: oneOf(r.availability, AVAILABILITIES) || "unknown",
    availabilityWindow: flat(r.availabilityWindow, 120),
    locations: list(r.locations),
    modifiers,
    quantityMin,
    quantityMax,
    ingredients: list(r.ingredients, 20),
    dietaryTags: list(r.dietaryTags, 10, 30).map((t) => t.toLowerCase()),
    allergens: list(r.allergens, 12, 40),
    warnings: list(r.warnings, 4, 200),
    customization: r.customization === true,
    nutrition: flat(r.nutrition, 120),
    servingSize: flat(r.servingSize, 60),
    popularity: oneOf(r.popularity, POPULARITIES),
    tags: list(r.tags, 10, 30).map((t) => t.toLowerCase()),
    rating: flat(r.rating, 10),
    reviewCount: flat(r.reviewCount, 10),
    estimatedTime: flat(r.estimatedTime, 40),
    inventory: flat(r.inventory, 40),
    fulfillment,
    related: list(r.related, 6, 120),
    upsells: list(r.upsells, 6, 120),
    pairings: list(r.pairings, 6, 120),
  };
}

/** Distinct keys across a list: a second "Latte" becomes "latte-2". */
export function uniqueKeys(items: MenuItemData[]): MenuItemData[] {
  const taken = new Set<string>();
  return items.map((it) => {
    let key = it.key || "item";
    for (let n = 2; taken.has(key); n++) key = `${it.key || "item"}-${n}`;
    taken.add(key);
    return { ...it, key };
  });
}

/**
 * The number inside a price and whether the price is exactly that number.
 * "$24" is exact; "$40+", "from $40", "$30–45" are a floor; "market price"
 * has no amount. A leading "+" ("+$5", an add-on delta) is a plain amount.
 */
export function parsePrice(text: string | undefined): { amount: number; exact: boolean; symbol: string } | null {
  const t = (text ?? "").trim().replace(/^\+\s*/, "");
  if (!t) return null;
  if (/^free$/i.test(t)) return { amount: 0, exact: true, symbol: "" };
  const m = t.match(/(\p{Sc})?\s*(\d[\d,]*(?:\.\d{1,2})?)/u);
  if (!m) return null;
  const amount = Number.parseFloat(m[2].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return { amount, exact: /^\p{Sc}?\s*\d[\d,]*(?:\.\d{1,2})?$/u.test(t), symbol: m[1] ?? "" };
}

export function formatMoney(amount: number, symbol: string): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return `${symbol}${n}`;
}

/** The price a menu row shows: the sale price when there is one. */
export function displayPrice(item: Pick<MenuItemData, "price" | "salePrice" | "priceType">): string {
  const p = item.salePrice || item.price;
  if (!p) return item.priceType === "market" ? "Market price" : "";
  if (item.priceType === "starting_at" && !/\+$|^from/i.test(p)) return `from ${p}`;
  return p;
}

/** A visitor's picks for one modifier. */
export type LineChoice = { modifier: string; picks: string[] };

/** What the visitor put in the cart; prices are looked up, never carried. */
export type CartLineInput = { key: string; quantity: number; choices: LineChoice[]; note: string };

/** A line as the server computed it, and as the cart shows it. */
export type OrderLine = {
  key: string;
  name: string;
  quantity: number;
  choices: LineChoice[];
  note: string;
  /** The unit price in the menu's figures, deltas included ("$29", "$29+"). */
  unitPrice: string;
  lineTotal: string;
};

export type LineVerdict = { ok: true; line: OrderLine } | { ok: false; error: string };

/**
 * Whether the visitor's line is one the item allows, and what it costs:
 * quantity inside the item's rules, every modifier's picks on its list and
 * counted inside min–max, required ones made, a note only where the item
 * takes customization. The server's rule, run early by the card too.
 */
export function resolveLine(item: MenuItemData, input: CartLineInput): LineVerdict {
  if (item.availability === "unavailable") return { ok: false, error: `${item.name} isn't available right now.` };
  const quantity = Number(input.quantity);
  if (!Number.isInteger(quantity) || quantity < item.quantityMin || quantity > item.quantityMax) {
    return { ok: false, error: `${item.name}: pick between ${item.quantityMin} and ${item.quantityMax}.` };
  }
  const chosen: LineChoice[] = [];
  let unit = parsePrice(item.salePrice || item.price);
  let floor = !unit || !unit.exact || item.priceType === "starting_at";
  let symbol = unit?.symbol ?? "";
  let amount = unit?.amount ?? 0;
  for (const mod of item.modifiers) {
    const given = (input.choices ?? []).find((c) => c.modifier.toLowerCase() === mod.name.toLowerCase());
    const picks = [...new Set((given?.picks ?? []).map((p) => p.trim()).filter(Boolean))];
    const found = picks.map((p) => mod.choices.find((c) => c.label.toLowerCase() === p.toLowerCase()));
    if (found.some((c) => !c)) return { ok: false, error: `${item.name}: pick ${mod.name} from the listed choices.` };
    if (picks.length < mod.min) {
      return { ok: false, error: `${item.name}: choose ${mod.min === 1 ? "a" : mod.min} ${mod.name}.` };
    }
    if (picks.length > mod.max) return { ok: false, error: `${item.name}: at most ${mod.max} for ${mod.name}.` };
    for (const c of found) {
      const delta = parsePrice(c?.price);
      if (c?.price && !delta) floor = true;
      if (delta) {
        amount += delta.amount;
        if (!delta.exact) floor = true;
        if (!symbol) symbol = delta.symbol;
      }
    }
    if (picks.length) chosen.push({ modifier: mod.name, picks: found.map((c) => c!.label) });
  }
  const note = item.customization ? (input.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300) : "";
  unit = unit ?? null;
  const priced = !!unit || chosen.some((c) => c.picks.length);
  const unitPrice = priced ? `${formatMoney(amount, symbol)}${floor ? "+" : ""}` : displayPrice(item);
  const lineTotal = priced ? `${formatMoney(amount * quantity, symbol)}${floor ? "+" : ""}` : "";
  return { ok: true, line: { key: item.key, name: item.name, quantity, choices: chosen, note, unitPrice, lineTotal } };
}

/**
 * What the lines add up to. A trailing "+" marks a floor: some line's price
 * was "from", unparseable, or missing. Null when nothing is priced.
 */
export function cartTotal(lines: Pick<OrderLine, "unitPrice" | "quantity">[]): string | null {
  let sum = 0;
  let floor = false;
  let symbol = "";
  let priced = 0;
  for (const l of lines) {
    const p = parsePrice(l.unitPrice.replace(/\+$/, ""));
    if (!p) {
      if (l.unitPrice) floor = true;
      continue;
    }
    priced++;
    sum += p.amount * l.quantity;
    if (l.unitPrice.endsWith("+")) floor = true;
    if (!symbol) symbol = p.symbol;
  }
  if (!priced) return null;
  return `${formatMoney(sum, symbol)}${floor || priced < lines.length ? "+" : ""}`;
}

/** "Large · Extra shot" — a line's choices on one row. */
export function choiceSummary(choices: LineChoice[]): string {
  return choices.flatMap((c) => c.picks).join(" · ");
}

/** What a curated show_menu call asked for. */
export type MenuFilter = { keys?: string[]; category?: string; tags?: string[]; title?: string };

/** The items a filter names, in the caller's order for keys; all when empty. */
export function filterMenu(items: MenuItemData[], filter: MenuFilter): MenuItemData[] {
  const keys = (filter.keys ?? []).map((k) => menuKey(String(k))).filter(Boolean);
  const tags = (filter.tags ?? []).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const category = (filter.category ?? "").toLowerCase().trim();
  if (!keys.length && !tags.length && !category) return items;
  let out = items;
  if (keys.length) {
    out = keys.map((k) => items.find((i) => i.key === k)).filter((i): i is MenuItemData => !!i);
  }
  if (category) out = out.filter((i) => i.category.toLowerCase() === category || i.subcategory.toLowerCase() === category);
  if (tags.length) {
    out = out.filter((i) =>
      tags.every((t) => i.dietaryTags.includes(t) || i.tags.includes(t) || i.popularity === t),
    );
  }
  return out;
}

/** A menu with items in the order the site listed them, sections kept together. */
export function groupMenu(items: MenuItemData[]): { name: string; items: MenuItemData[] }[] {
  const groups: { name: string; items: MenuItemData[] }[] = [];
  for (const it of items) {
    const g = groups.find((x) => x.name === it.category);
    if (g) g.items.push(it);
    else groups.push({ name: it.category, items: [it] });
  }
  return groups;
}

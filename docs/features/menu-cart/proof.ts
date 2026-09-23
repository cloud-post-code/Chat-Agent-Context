/**
 * Primary proof for menu-cart (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/menu-cart/tsconfig.proof.json docs/features/menu-cart/proof.ts
 *
 * Section A drives the pure rules. B–F run the real extractor (its llm seam
 * doubled), the real hydration, the real brain (its model client scripted),
 * the real order path and the real planner sanitizer against the local dev
 * Postgres under throwaway users. G renders the real cards to static markup.
 * Everything made is deleted at the end.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };
function scriptedClient(turns: Turn[]) {
  let i = 0;
  const seenParams: { system?: string; tools?: { name: string }[] }[] = [];
  const client = {
    messages: {
      stream(params: { system?: string; tools?: { name: string }[] }) {
        seenParams.push(params);
        const turn = turns[Math.min(i++, turns.length - 1)] ?? {};
        return {
          async *[Symbol.asyncIterator]() {
            if (turn.text) yield { type: "content_block_delta", delta: { type: "text_delta", text: turn.text } };
          },
          async finalMessage() {
            const content: unknown[] = [];
            if (turn.text) content.push({ type: "text", text: turn.text });
            for (const [j, t] of (turn.tools ?? []).entries()) {
              content.push({ type: "tool_use", id: `tu_${i}_${j}`, name: t.name, input: t.input });
            }
            return { content };
          },
        };
      },
    },
  };
  return { client, seenParams };
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};
const PAGES = [
  page(
    "https://example.invalid/menu",
    `<h1>Menu</h1><img src="/img/parm.jpg" alt="Chicken Parmigiana"><img src="data:image/png;base64,xx" alt="inline"><p>Food.</p>`,
  ),
];

// Distinctive names so a DB match can only come from this proof.
const PARM = "Bramblewick Chicken Parmigiana";
const SALAD = "Bramblewick Garden Salad";
const BREAD = "Bramblewick Garlic Bread";
const SOUP = "Bramblewick Market Soup";

const EXTRACTION = {
  services: [
    {
      name: PARM, description: "Breaded chicken, mozzarella, tomato sauce.", price: "$24", duration: "", category: "Entrées",
      menu: {
        subcategory: "Chicken", fullDescription: "Hand-breaded chicken breast baked with mozzarella over house tomato sauce.",
        image: "https://example.invalid/img/parm.jpg", gallery: ["not a url", "https://example.invalid/img/parm2.jpg"],
        originalPrice: "$28", salePrice: "$24", currency: "USD", unit: "each", availability: "available",
        availabilityWindow: "after 4 PM", locations: ["Cambridge"],
        modifiers: [
          { name: "Side", required: true, min: 1, max: 1, choices: [{ label: "Fries" }, { label: "Salad", price: "+$2" }], defaults: [] },
          { name: "Add-ons", required: false, min: 0, max: 2, choices: [{ label: "Extra cheese", price: "+$3" }, { label: "Chicken", price: "+$5" }], defaults: ["Extra cheese"] },
        ],
        quantityMin: 1, quantityMax: 10, ingredients: ["chicken", "tomato", "mozzarella"], dietaryTags: [], allergens: ["Milk", "Wheat"],
        warnings: ["Contains raw or undercooked ingredients"], customization: true, nutrition: "720 cal", servingSize: "Serves 1",
        popularity: "bestseller", rating: "4.8", reviewCount: "127", estimatedTime: "15–20 min", inventory: "", fulfillment: ["pickup", "delivery", "dine_in"],
        related: [SOUP], upsells: [BREAD], pairings: ["House red"],
      },
    },
    { name: SALAD, description: "Greens, cucumber, vinaigrette.", price: "$11", duration: "", category: "Starters", menu: { dietaryTags: ["Vegan", "Gluten-free"], fulfillment: ["pickup", "delivery", "dine_in"], popularity: "bogus", availability: "limited", inventory: "4 remaining" } },
    { name: BREAD, description: "Toasted with garlic butter.", price: "$6", duration: "", category: "Starters", menu: { dietaryTags: ["vegetarian"], quantityMax: 3, fulfillment: ["pickup", "delivery", "dine_in"] } },
    { name: SOUP, description: "Ask your server.", price: "", duration: "", category: "Starters", menu: { priceType: "market", availability: "unavailable" } },
  ],
  booking: { takesAppointments: true, kind: "table", staff: [], phone: "required", email: "optional", notes: true, requirements: [] },
};

type MenuBlock = { type: "menu"; title: string; full: boolean; items: { key: string; name: string; category: string }[]; checkout: { fulfillment: string[]; contact: { phone: string; email: string } } };

async function main() {
  const { prisma } = await import("../../../lib/db");
  const T = await import("../../../lib/menuTypes");
  const M = await import("../../../lib/menu");
  const O = await import("../../../lib/orders");
  const { extractServicesAndBooking, imagesBlock } = await import("../../../lib/onboarding/services");
  const { listServices } = await import("../../../lib/cards");
  const { answer } = await import("../../../lib/brain");
  const { CARD_TOOLS, normalizeQuestion } = await import("../../../lib/canned");
  const { writeUiCard, parseSampleBlock } = await import("../../../lib/uiCards");
  const { sanitizeCardPlan } = await import("../../../lib/onboarding/cards");
  const { listAppointments } = await import("../../../lib/appointments");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");
  const { SERVICES_SOURCE_TITLE } = await import("../../../lib/serviceCatalog");
  const { saveKnowledgeRecord } = await import("../../../lib/onboarding/knowledge");
  const { formatServiceCatalog } = await import("../../../lib/serviceCatalog");

  const made: string[] = [];
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: { email: `proof-menu-cart-${tag}-${Date.now()}@example.invalid`, name: `Proof Menu ${tag}`, slug: `proof-menu-${tag}-${Date.now()}`, passwordHash: "", onboardedAt: new Date() },
    });
    made.push(u.id);
    return u;
  };
  const quiet = () => {};
  const llmOf = (result: unknown) => async () => result as Record<string, unknown>;
  const run = async (userId: string, turns: Turn[], message = "scripted menu turn", cart?: { name: string; quantity: number }[]) => {
    const { client, seenParams } = scriptedClient(turns);
    const events: { t: string; v: unknown }[] = [];
    for await (const e of answer({ userId, message, sessionId: `proof-${Date.now()}`, cart }, { client })) events.push(e);
    return { events, offered: (seenParams[0]?.tools ?? []).map((t) => t.name), system: seenParams[0]?.system ?? "", calls: seenParams.length };
  };

  try {
    // ══ A. The pure rules ═══════════════════════════════════════════════════
    {
      const it = T.sanitizeMenuItem({ name: "  Chicken   Parm ", price: "$24", priceType: "nonsense", availability: "soon", popularity: "bestseller", dietaryTags: ["Vegan", "vegan", 42], modifiers: [{ name: "Size", choices: ["Small", "Large", "Large"], required: true, max: 1, defaults: ["Large", "Huge"] }, { name: "Empty", choices: [] }], quantityMin: 0, quantityMax: 500, fulfillment: ["pickup", "teleport"], image: "javascript:alert(1)" })!;
      check("A1 the key comes from the name, one rule", it.key === "chicken-parm" && T.menuKey("Chicken Parm!") === "chicken-parm");
      check("A1 unknown enum values are dropped, not guessed", it.priceType === "fixed" && it.availability === "unknown" && it.popularity === "bestseller");
      check("A1 tags are lowercased and deduped; junk dropped", it.dietaryTags.join(",") === "vegan");
      check("A1 a modifier keeps only listed defaults; an empty one is dropped", it.modifiers.length === 1 && it.modifiers[0].defaults.join() === "Large" && it.modifiers[0].choices.length === 2 && it.modifiers[0].min === 1);
      check("A1 quantity rules are clamped", it.quantityMin === 1 && it.quantityMax === 20);
      check("A1 fulfillment is whitelisted; a script URL is no image", it.fulfillment.join() === "pickup" && it.image === "");
      check("A1 no name → null; junk → null", T.sanitizeMenuItem({ price: "$1" }) === null && T.sanitizeMenuItem("x") === null && T.sanitizeMenuItem(null) === null);
      const keys = T.uniqueKeys([T.sanitizeMenuItem({ name: "Latte" })!, T.sanitizeMenuItem({ name: "Latte" })!]);
      check("A2 duplicate names get distinct keys", keys.map((k) => k.key).join() === "latte,latte-2");
      check("A3 parsePrice: exact, floor, delta, none", T.parsePrice("$24")?.exact === true && T.parsePrice("from $40")?.exact === false && T.parsePrice("+$5")?.amount === 5 && T.parsePrice("market price") === null && T.parsePrice("free")?.amount === 0);
      check("A3 displayPrice prefers the sale price and marks a floor", T.displayPrice({ price: "$28", salePrice: "$24", priceType: "fixed" }) === "$24" && T.displayPrice({ price: "$40", salePrice: "", priceType: "starting_at" }) === "from $40" && T.displayPrice({ price: "", salePrice: "", priceType: "market" }) === "Market price");

      const parm = T.sanitizeMenuItem(EXTRACTION.services[0].menu && { ...EXTRACTION.services[0].menu, name: PARM, price: "$24", category: "Entrées" })!;
      const missing = T.resolveLine(parm, { key: parm.key, quantity: 1, choices: [], note: "" });
      check("A4 a required choice not made is refused, by name", !missing.ok && /choose a Side/.test((missing as { error: string }).error));
      const ok = T.resolveLine(parm, { key: parm.key, quantity: 2, choices: [{ modifier: "Side", picks: ["salad"] }, { modifier: "Add-ons", picks: ["Chicken"] }], note: "  no  onions " });
      check("A4 a good line is priced with its deltas: 24 + 2 + 5, ×2", ok.ok && ok.line.unitPrice === "$31" && ok.line.lineTotal === "$62", JSON.stringify(ok));
      check("A4 …picks are stored by their listed label, the note flattened", ok.ok && ok.line.choices[0].picks[0] === "Salad" && ok.line.note === "no onions");
      const many = T.resolveLine(parm, { key: parm.key, quantity: 1, choices: [{ modifier: "Side", picks: ["Fries"] }, { modifier: "Add-ons", picks: ["Extra cheese", "Chicken", "Chicken"] }], note: "" });
      check("A4 picks are deduped and counted against max", many.ok, JSON.stringify(many));
      const offList = T.resolveLine(parm, { key: parm.key, quantity: 1, choices: [{ modifier: "Side", picks: ["Caviar"] }], note: "" });
      check("A4 an off-list pick is refused", !offList.ok);
      const tooMany = T.resolveLine(parm, { key: parm.key, quantity: 11, choices: [{ modifier: "Side", picks: ["Fries"] }], note: "" });
      check("A4 quantity outside the item's rules is refused", !tooMany.ok && /between 1 and 10/.test((tooMany as { error: string }).error));
      const soup = T.sanitizeMenuItem({ name: SOUP, priceType: "market", availability: "unavailable" })!;
      check("A4 an unavailable item is refused", !T.resolveLine(soup, { key: soup.key, quantity: 1, choices: [], note: "" }).ok);
      const bread = T.sanitizeMenuItem({ name: BREAD, price: "$6", category: "Starters" })!;
      const noted = T.resolveLine(bread, { key: bread.key, quantity: 1, choices: [], note: "extra crispy" });
      check("A4 a note is kept only where the item takes customization", noted.ok && noted.line.note === "");
      check("A5 cartTotal adds lines and marks a floor", T.cartTotal([{ unitPrice: "$31", quantity: 2 }, { unitPrice: "$6", quantity: 1 }]) === "$68" && T.cartTotal([{ unitPrice: "$31+", quantity: 1 }, { unitPrice: "", quantity: 1 }]) === "$31+" && T.cartTotal([{ unitPrice: "", quantity: 1 }]) === null);
      const all = [parm, T.sanitizeMenuItem({ name: SALAD, category: "Starters", dietaryTags: ["vegan"] })!, bread];
      check("A6 filterMenu: keys keep the caller's order and drop unknowns", T.filterMenu(all, { keys: [bread.key, "nope", parm.key] }).map((i) => i.name).join("|") === `${BREAD}|${PARM}`);
      check("A6 filterMenu: tags and category", T.filterMenu(all, { tags: ["Vegan"] }).length === 1 && T.filterMenu(all, { category: "entrées" }).length === 1 && T.filterMenu(all, {}).length === 3);
      check("A6 groupMenu keeps sections together in first-seen order", T.groupMenu(all).map((g) => g.name).join("|") === "Entrées|Starters");
    }

    // ══ B. The extractor writes the menu ═══════════════════════════════════
    const u = await mkUser("main");
    {
      const images = imagesBlock(PAGES);
      check("B0 the corpus lists page images with alt, absolute, no data: URIs", images.includes("https://example.invalid/img/parm.jpg — Chicken Parmigiana") && !images.includes("data:"));
      const { report } = await extractServicesAndBooking(PAGES, u.id, quiet, { llm: llmOf(EXTRACTION) });
      check("B1 the report counts services and menu items", report.services === 4 && report.menuItems === 4, JSON.stringify(report));
      const rows = await prisma.menuItem.findMany({ where: { userId: u.id }, orderBy: { order: "asc" } });
      check("B2 one row per item, in the site's order, keyed from the name", rows.length === 4 && rows[0].key === "bramblewick-chicken-parmigiana" && rows[0].category === "Entrées");
      const items = await M.listMenu(u.id);
      const parm = items[0];
      check("B3 the row carries the facts the site stated", parm.salePrice === "$24" && parm.originalPrice === "$28" && parm.modifiers.length === 2 && parm.modifiers[0].required && parm.allergens.join() === "Milk,Wheat" && parm.image === "https://example.invalid/img/parm.jpg" && parm.gallery.join() === "https://example.invalid/img/parm2.jpg" && parm.popularity === "bestseller" && parm.customization);
      check("B3 …and nothing it didn't: unstated stays empty, junk dropped", items[1].popularity === "" && items[1].availability === "limited" && items[3].availability === "unavailable" && items[3].price === "" && items[1].dietaryTags.join() === "vegan,gluten-free");
      const src = await prisma.source.findFirst({ where: { userId: u.id, kind: onboardingIngestKind("services"), title: SERVICES_SOURCE_TITLE } });
      const services = await listServices(u.id);
      check("B4 the services knowledge is still written in the catalog format", !!src && services.length === 4 && services[0].name === PARM);
      const chunk = await prisma.chunk.findFirst({ where: { userId: u.id, text: { contains: SALAD } } });
      check("B5 a knowledge chunk carries the item's dietary facts", !!chunk && /vegan, gluten-free/.test(chunk.text), chunk?.text);
    }
    // A tenant onboarded before the table: only the services Source.
    const old = await mkUser("legacy");
    {
      await saveKnowledgeRecord(old.id, { url: "https://legacy.invalid/services", title: SERVICES_SOURCE_TITLE, kind: onboardingIngestKind("services"), rawText: formatServiceCatalog([{ name: "Quillmere Gel Manicure", description: "From $40, about 45 minutes." }, { name: "Quillmere Pedicure", description: "$55." }]) }, ["Quillmere Gel Manicure. From $40, about 45 minutes.", "Quillmere Pedicure. $55."]);
      const items = await M.listMenu(old.id);
      check("B6 no rows → the services catalog is read as the menu, prices from prose", items.length === 2 && items[0].price === "$40" && items[0].priceType === "starting_at" && items[0].estimatedTime === "45 minutes" && items[1].price === "$55");
    }

    // ══ C. Hydration ═══════════════════════════════════════════════════════
    {
      const full = (await M.menuBlock(u.id, {})) as MenuBlock;
      check("C1 no filter → the full menu, titled Menu", full.type === "menu" && full.full && full.items.length === 4 && full.title === "Menu");
      check("C1 …with checkout read from the menu and the booking form", full.checkout.fulfillment.join() === "pickup,delivery,dine_in" && full.checkout.contact.phone === "required", JSON.stringify(full.checkout));
      const picks = (await M.menuBlock(u.id, { keys: ["bramblewick-garlic-bread", "ghost", "bramblewick-chicken-parmigiana"], title: "For two" })) as MenuBlock;
      check("C2 keys → a curated list in the model's order, unknown keys dropped", !picks.full && picks.items.map((i) => i.name).join("|") === `${BREAD}|${PARM}` && picks.title === "For two");
      const vegan = (await M.menuBlock(u.id, { tags: ["vegan"] })) as MenuBlock;
      check("C3 tags → the items carrying them, default title", vegan.items.length === 1 && vegan.items[0].name === SALAD && vegan.title === "Picks for you");
      const starters = (await M.menuBlock(u.id, { category: "Starters" })) as MenuBlock;
      check("C3 category → one section", starters.items.length === 3);
      check("C4 nothing matching → null", (await M.menuBlock(u.id, { keys: ["ghost"] })) === null && (await M.menuBlock(u.id, { tags: ["keto"] })) === null);
      const empty = await mkUser("empty");
      check("C4 nothing on file → null (menu and cart)", (await M.menuBlock(empty.id, {})) === null && (await M.cartBlock(empty.id)) === null);
      const cart = await M.cartBlock(u.id);
      check("C5 the cart block carries only how to check out", cart?.type === "cart" && Object.keys(cart).join() === "type,checkout");
      const index = await M.menuPromptSection(u.id);
      check("C6 the prompt index lists key, name, section, price and tags", index.includes(`- bramblewick-garden-salad | ${SALAD} | Starters | $11, vegan, gluten-free, limited`) && index.includes("show_menu"), index);
      check("C6 the cart section lists what the page sent", M.cartPromptSection([{ name: BREAD, quantity: 2, unitPrice: "$6" }]).includes(`- 2 × ${BREAD} ($6 each)`) && M.cartPromptSection([]) === "");
    }

    // ══ D. The brain ═══════════════════════════════════════════════════════
    {
      check("D1 show_menu and show_cart are canned-answer tools", CARD_TOOLS.includes("show_menu") && CARD_TOOLS.includes("show_cart"));
      const before = await run(u.id, [{ text: "hi" }]);
      check("D2 without a catalog row nothing menu-shaped is offered", !before.offered.includes("show_menu") && !before.offered.includes("add_to_cart") && !before.system.includes("MENU INDEX"));
      const sample = JSON.stringify(await M.menuBlock(u.id, {}));
      const row = await writeUiCard(u.id, { key: "menu", label: "Menu", tool: "show_menu", description: "", reason: "When a visitor asks what's on the menu.", note: "", sampleBlock: sample });
      check("D3 a show_menu row with a live sample is accepted; the sample parses", row.ok && parseSampleBlock(sample)?.type === "menu");
      const bad = await writeUiCard(u.id, { key: "menu-bad", label: "Menu bad", tool: "show_menu", description: "", reason: "", note: "", sampleBlock: JSON.stringify({ type: "menu", items: "no" }) });
      check("D3 …the sample must still be a known block type", bad.ok, "a menu-typed sample is storable; the renderer guards its items");
      if (bad.ok) await prisma.uiCard.deleteMany({ where: { userId: u.id, key: bad.key } });
      const turn = await run(u.id, [{ text: "Here's the menu.", tools: [{ name: "show_menu", input: { tags: ["vegan"], title: "Vegan picks" } }] }, { text: "Enjoy." }], "anything vegan?", [{ name: BREAD, quantity: 2 }]);
      check("D4 with the row, the menu trio is offered", turn.offered.includes("show_menu") && turn.offered.includes("show_cart") && turn.offered.includes("add_to_cart"));
      check("D4 the prompt carries the index and the visitor's cart", turn.system.includes("MENU INDEX") && turn.system.includes(`2 × ${BREAD}`));
      const cardEvents = turn.events.filter((e) => e.t === "card") as { v: MenuBlock }[];
      check("D5 show_menu draws one curated menu card", cardEvents.length === 1 && cardEvents[0].v.type === "menu" && cardEvents[0].v.items.length === 1 && cardEvents[0].v.title === "Vegan picks");
      const add = await run(u.id, [{ tools: [{ name: "add_to_cart", input: { key: "bramblewick-garlic-bread", quantity: 2 } }, { name: "add_to_cart", input: { key: "ghost" } }, { name: "add_to_cart", input: { key: "bramblewick-market-soup" } }] }, { text: "Added." }], "add two garlic breads");
      const cartEvents = add.events.filter((e) => e.t === "cart") as { v: { op: string; item: { key: string }; quantity: number } }[];
      check("D6 add_to_cart emits one cart event for the on-menu item, with the item and quantity", cartEvents.length === 1 && cartEvents[0].v.op === "add" && cartEvents[0].v.item.key === "bramblewick-garlic-bread" && cartEvents[0].v.quantity === 2, JSON.stringify(cartEvents));
      check("D6 …an unknown key and an unavailable item emit nothing", cartEvents.length === 1);
      const q = "What's on the menu?";
      await prisma.cannedAnswer.create({ data: { userId: u.id, question: q, matchKey: normalizeQuestion(q), answer: "Here is our menu.", cardTool: "show_menu", cardInput: "{}", enabled: true } });
      const canned = await run(u.id, [{ text: "should not be called" }], q);
      check("D7 a canned answer draws the full menu with zero model calls", canned.calls === 0 && canned.events.some((e) => e.t === "card" && (e.v as MenuBlock).type === "menu" && (e.v as MenuBlock).full));
    }

    // ══ E. Orders ══════════════════════════════════════════════════════════
    {
      const lines = [
        { key: "bramblewick-chicken-parmigiana", quantity: 2, choices: [{ modifier: "Side", picks: ["Salad"] }], note: "no onions" },
        { key: "bramblewick-garlic-bread", quantity: 1, choices: [], note: "" },
      ];
      const contact = { name: "Proof Diner", phone: "555-0100", email: "" };
      const r = await O.createOrder(u.id, { lines, contact, fulfillment: "pickup" });
      check("E1 a good order is accepted with server-computed totals: (24+2)×2 + 6", r.ok && r.subtotal === "$58" && r.lines[0].lineTotal === "$52" && r.lines[0].note === "no onions", JSON.stringify(r));
      const stored = (await O.listOrders(u.id))[0];
      check("E1 …and stored with its lines, contact and fulfillment", !!stored && stored.lines.length === 2 && stored.contact.name === "Proof Diner" && stored.fulfillment === "pickup" && stored.startsAt === null && stored.subtotal === "$58");
      const rej = async (input: Parameters<typeof O.createOrder>[1]) => {
        const x = await O.createOrder(u.id, input);
        return x.ok ? "" : x.error;
      };
      check("E2 unknown item", /isn't on the menu/.test(await rej({ lines: [{ key: "ghost", quantity: 1, choices: [], note: "" }], contact, fulfillment: "pickup" })));
      check("E2 unavailable item", /isn't available/.test(await rej({ lines: [{ key: "bramblewick-market-soup", quantity: 1, choices: [], note: "" }], contact, fulfillment: "pickup" })));
      check("E2 quantity over the item's rule", /between 1 and 3/.test(await rej({ lines: [{ key: "bramblewick-garlic-bread", quantity: 4, choices: [], note: "" }], contact, fulfillment: "pickup" })));
      check("E2 required choice missing", /choose a Side/.test(await rej({ lines: [{ key: "bramblewick-chicken-parmigiana", quantity: 1, choices: [], note: "" }], contact, fulfillment: "pickup" })));
      check("E2 off-list pick", /listed choices/.test(await rej({ lines: [{ key: "bramblewick-chicken-parmigiana", quantity: 1, choices: [{ modifier: "Side", picks: ["Caviar"] }], note: "" }], contact, fulfillment: "pickup" })));
      check("E2 no contact", /phone number or email/.test(await rej({ lines: [lines[1]], contact: { name: "X" }, fulfillment: "pickup" })) && /name is required/.test(await rej({ lines: [lines[1]], contact: { phone: "1" }, fulfillment: "pickup" })));
      check("E2 a way not offered; none chosen when several are", /offered ways/.test(await rej({ lines: [lines[1]], contact, fulfillment: "shipping" })) && /Choose how/.test(await rej({ lines: [lines[1]], contact })));
      check("E2 dine-in without a time; a past time", /Pick a time/.test(await rej({ lines: [lines[1]], contact, fulfillment: "dine_in" })) && /future/.test(await rej({ lines: [lines[1]], contact, fulfillment: "dine_in", startsAt: "2000-01-01T10:00:00Z" })));
      check("E2 an empty cart", /empty/.test(await rej({ lines: [], contact, fulfillment: "pickup" })));
      // A timed order lands on the calendar too, through the real booking path
      // (the extractor planned a "table" form: name, phone, email, party size…).
      const soon = new Date(Date.now() + 86_400_000);
      soon.setMinutes(0, 0, 0);
      const timed = await O.createOrder(u.id, { lines: [lines[1]], contact: { ...contact, email: "diner@example.invalid" }, fulfillment: "dine_in", startsAt: soon.toISOString(), notes: "window seat" });
      const fields = (await prisma.appointmentField.findMany({ where: { userId: u.id } })).map((f) => `${f.key}${f.required ? "*" : ""}`);
      const appts = await listAppointments(u.id);
      const required = fields.filter((f) => f.endsWith("*"));
      const canBook = required.every((f) => /^(name|phone|email)\*$/.test(f));
      check(`E3 a timed order is saved${canBook ? " and booked on the calendar" : " (form asks more than the order knows: no calendar entry)"}`, timed.ok && (canBook ? timed.appointmentId !== null && appts.some((a) => a.id === timed.appointmentId) : timed.appointmentId === null), `fields ${fields.join(",")} → ${JSON.stringify(timed)}`);
      // A tenant whose form asks only what an order knows: the timed order books.
      const salon = await mkUser("salon");
      await saveKnowledgeRecord(salon.id, { url: "https://salon.invalid/services", title: SERVICES_SOURCE_TITLE, kind: onboardingIngestKind("services"), rawText: formatServiceCatalog([{ name: "Quillmere Gel Manicure", description: "$40." }]) }, ["Quillmere Gel Manicure. $40."]);
      await prisma.appointmentField.createMany({ data: [
        { userId: salon.id, key: "name", label: "Your name", type: "short_text", required: true, order: 0 },
        { userId: salon.id, key: "phone", label: "Your phone number", type: "phone", required: true, order: 1 },
        { userId: salon.id, key: "service", label: "Which services would you like?", type: "multi_select", required: true, order: 2, config: JSON.stringify({ options: [{ label: "Quillmere Gel Manicure", price: "$40" }], allowOther: true }) },
        { userId: salon.id, key: "notes", label: "Anything we should know?", type: "long_text", required: false, order: 3 },
      ] });
      const booked = await O.createOrder(salon.id, { lines: [{ key: "quillmere-gel-manicure", quantity: 2, choices: [], note: "" }], contact: { name: "Proof Client", phone: "555-0101" }, startsAt: soon.toISOString(), notes: "first visit" });
      const booking = booked.ok && booked.appointmentId ? (await listAppointments(salon.id)).find((a) => a.id === booked.appointmentId) : null;
      check("E3 …and on a form the order can answer, it books through the real path with the picks and notes", !!booking && /Quillmere Gel Manicure/.test(booking.answers.service ?? "") && /2 × Quillmere Gel Manicure/.test(booking.answers.notes ?? "") && booking.answers.phone === "555-0101", JSON.stringify(booked) + JSON.stringify(booking?.answers));
      const count = await O.listOrders(u.id);
      check("E3 orders list newest first", count.length === 2 && count[0].startsAt !== null);
      await O.deleteOrder(u.id, count[1].id);
      check("E4 deleteOrder removes one", (await O.listOrders(u.id)).length === 1);
    }

    // ══ F. The planner ═════════════════════════════════════════════════════
    {
      const signals = { photos: 0, projects: 0, services: 4, takesAppointments: true, contactChannels: [], categories: [] };
      const both = sanitizeCardPlan({ cards: [{ kind: "services", label: "Services" }, { kind: "menu", label: "Menu", reason: "When …" }] }, signals, 0);
      check("F1 menu is a planned kind and wins over services", both.cards.length === 1 && both.cards[0].kind === "menu");
      const none = sanitizeCardPlan({ cards: [{ kind: "menu", label: "Menu" }] }, { ...signals, services: 0 }, 0);
      check("F1 …gated on items on file", none.cards.length === 0);
      const { placeCard, businessBlock } = await import("../../../lib/onboarding/cards");
      const placed = await placeCard(u.id, { kind: "menu", label: "Our menu", description: "", reason: "When …", layout: "carousel", brief: "", questions: [] }, 9, await businessBlock(u.id), [], async () => { throw new Error("no draft"); }, quiet);
      const rowNow = placed.ok ? await prisma.uiCard.findUnique({ where: { userId_key: { userId: u.id, key: placed.key } } }) : null;
      check("F2 placing a menu card writes a show_menu row whose sample is the live menu", placed.ok && placed.tool === "show_menu" && !!rowNow && (parseSampleBlock(rowNow.sampleBlock) as MenuBlock | null)?.items.length === 4);
    }

    // ══ G. What the visitor is handed ══════════════════════════════════════
    {
      const { renderToStaticMarkup } = await import("react-dom/server");
      const React = (await import("react")).default;
      const { Cards } = await import("../../../app/cards/Cards");
      const block = await M.menuBlock(u.id, {});
      const html = renderToStaticMarkup(React.createElement(Cards, { slug: "proof", block } as never));
      check("G1 the full menu draws its sections, the first open, the rest folded with counts", html.includes(">Entrées<") && html.includes(">Starters<") && html.includes(PARM) && !html.includes(SALAD) && /3 · ▾/.test(html), html.slice(0, 400));
      check("G1 a row shows the sale price with the original struck, a bestseller mark, and Choose for required options", html.includes("<s") && html.includes("$28") && html.includes("$24") && html.includes(">bestseller<") && html.includes(">Choose</button>"));
      check("G1 the cart footer reads empty", html.includes("Your cart is empty."));
      const curated = renderToStaticMarkup(React.createElement(Cards, { slug: "proof", block: await M.menuBlock(u.id, { category: "Starters", title: "Starters" }) } as never));
      check("G2 a curated list is flat: no section headers; an unavailable item can't be added; a limited one shows its stock", !/aria-expanded="true"[^>]*>[\s\S]*?<span>Starters<\/span>/.test(curated) && curated.includes(">Unavailable<") && curated.includes(">4 remaining<") && (curated.match(/\+ Add<\/button>/g) ?? []).length === 2);
      const { ItemDetail } = await import("../../../app/cards/MenuCard");
      const detail = renderToStaticMarkup(React.createElement(ItemDetail, { item: (await M.listMenu(u.id))[0], onClose: () => {} }));
      check("G3 the detail draws the facts, the warning, the images and the customizer", detail.includes("Hand-breaded") && detail.includes("Milk, Wheat") && detail.includes("720 cal") && detail.includes("Contains raw") && detail.includes("after 4 PM") && detail.includes("4.8 (127 reviews)") && detail.includes("img/parm2.jpg") && detail.includes("Pairs well with"));
      check("G3 …required side as radios, add-ons as checkboxes with the default ticked and deltas shown, a note box, and Add disabled until the side is chosen", (detail.match(/type="radio"/g) ?? []).length === 2 && (detail.match(/type="checkbox"/g) ?? []).length === 2 && /checked=""[^>]*\/><span[^>]*>Extra cheese/.test(detail) && detail.includes("+$5") && detail.includes("Special requests") && /<button[^>]*disabled[^>]*>Add to cart/.test(detail) && detail.includes("choose a Side"));
      const cartHtml = renderToStaticMarkup(React.createElement(Cards, { slug: "proof", block: await M.cartBlock(u.id) } as never));
      check("G4 the cart card draws (empty outside a provider)", cartHtml.includes("Your cart") && cartHtml.includes("cart is empty"));
      const { CartStore } = await import("../../../app/cards/cart");
      const store = new CartStore(null);
      const items = await M.listMenu(u.id);
      store.add(items[2], 1);
      store.add(items[2], 2);
      store.add(items[0], 1, [{ modifier: "Side", picks: ["Salad"] }], "");
      const l = store.get();
      check("G5 the store merges equal lines and prices each from the rules (explicit choices, no defaults added)", l.length === 2 && l[0].quantity === 3 && l[0].unitPrice === "$6" && l[1].unitPrice === "$26", JSON.stringify(l.map((x) => [x.quantity, x.unitPrice])));
      store.setQuantity(l[0].lineId, 9);
      store.update(l[1].lineId, { choices: [{ modifier: "Side", picks: ["Fries"] }], quantity: 2 });
      check("G5 quantity is clamped to the rule; an edit re-prices", store.get()[0].quantity === 3 && store.get()[1].unitPrice === "$24" && store.get()[1].quantity === 2);
      store.setQuantity(l[0].lineId, 0);
      check("G5 zero removes the line", store.get().length === 1);
    }
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    const left = await prisma.user.count({ where: { email: { startsWith: "proof-menu-cart-" } } });
    check("Z no proof users left behind", left === 0, String(left));
    await prisma.$disconnect();
  }

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

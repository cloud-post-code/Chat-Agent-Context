/**
 * Primary proof for services-card-from-site-form (see PROOF.md).
 * Run: npx tsx docs/features/services-card-from-site-form/proof.ts
 *
 * Offline. Runs the real onboarding services stage (its llm seam scripted
 * with each business's recorded answer, truth.ts) against the local dev
 * Postgres under throwaway users, then hydrates the real services block,
 * drives the real visitor brain with a scripted model client, and renders
 * the real card with react-dom/server. Nothing else is doubled.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";

// tsx compiles the card's JSX for the classic runtime; give it the React it expects.
(globalThis as unknown as { React: unknown }).React = React;
import * as cheerio from "cheerio";
import { ANTHONY, ANTHONY_EXTRACT, MOONLIGHT, MOONLIGHT_EXTRACT } from "./truth";

// Load .env ourselves (tsx doesn't); never override values already set.
const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail.slice(0, 400)}` : ""}`);
  }
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};

type Item = {
  id: string;
  name: string;
  price?: string;
  duration?: string;
  description?: string;
  imageUrl?: string;
  category?: string;
};
type Block = {
  type: "services";
  items: Item[];
  sections: { name: string; items: Item[] }[] | null;
  form: {
    source: string;
    sections: boolean;
    pickMany: boolean;
    staffStep: boolean;
    search: boolean;
    shows: { price: boolean; duration: boolean; image: boolean; description: boolean };
  } | null;
  channels: { kind: string; label: string; who?: string; href?: string }[];
  request: boolean;
  booking: {
    fields: { key: string; type: string; required: boolean }[];
    flow: {
      services: { name: string }[];
      staff: { name: string; phone: string }[];
      rules: { confirmation: string; customerFields: { key: string; required: boolean }[] };
    } | null;
  } | null;
};

/** The three fill-ins this feature removes. None may appear in any markup. */
const FORBIDDEN = ["Varies", "placeholder-image", "· 30 min", "<img"];
const invented = (markup: string) =>
  markup.startsWith("RENDER FAILED") ? [markup.slice(0, 120)] : FORBIDDEN.filter((f) => markup.includes(f));

/** Only the keys the site stated may be present — a missing fact is a missing key. */
const extraKeys = (item: Item, allowed: string[]) =>
  Object.keys(item).filter((k) => !["id", "name", ...allowed].includes(k));

type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };
function scriptedClient(turns: Turn[]) {
  let i = 0;
  const client = {
    messages: {
      stream() {
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
  return client;
}

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { extractServicesAndBooking, sanitizeServices } = await import("../../../lib/onboarding/services");
  const { servicesBlock, bookingBlock } = await import("../../../lib/cards");
  const { answer } = await import("../../../lib/brain");
  const { getBookingSettings, listStaff, listServices } = await import("../../../lib/booking/store");
  const { setBookingEnabled } = await import("../../../lib/appointments");
  const { formatServiceCatalog, SERVICES_SOURCE_TITLE } = await import("../../../lib/serviceCatalog");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");
  const { Cards } = await import("../../../app/cards/Cards");

  const made: string[] = [];
  const stamp = Date.now();
  const mkUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `proof-site-form-${tag}-${stamp}@example.invalid`,
        name: `Proof Site Form ${tag}`,
        slug: `proof-site-form-${tag}-${stamp}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    made.push(u.id);
    await setBookingEnabled(u.id, true);
    return u;
  };
  const quiet = () => {};
  const llmOf = (result: unknown) => async () => result as Record<string, unknown>;
  // A render that throws is a failed check, not a dead proof.
  const render = (block: unknown, slug: string) => {
    try {
      return renderToStaticMarkup(createElement(Cards as never, { block, slug } as never));
    } catch (e) {
      return `RENDER FAILED: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const cardFromBrain = async (userId: string) => {
    const client = scriptedClient([{ tools: [{ name: "show_services", input: {} }] }, { text: "done" }]);
    const cards: Block[] = [];
    for await (const e of answer({ userId, message: "what do you offer?", sessionId: `proof-${stamp}` }, { client: client as never })) {
      if (e.t === "card" && (e.v as { type?: string })?.type === "services") cards.push(e.v as Block);
    }
    return cards;
  };

  try {
    // ══ A. The sanitizer: the form is read as booleans only; nothing is assumed ══
    {
      const s = sanitizeServices(MOONLIGHT_EXTRACT as never) as unknown as {
        form: Block["form"]; staffContacts: { name: string; phone: string }[]; channels: string[];
      };
      check("A1 the site's form shape is carried through the sanitizer",
        JSON.stringify(s.form) === JSON.stringify(MOONLIGHT.form), JSON.stringify(s.form));
      const junk = sanitizeServices({ services: [], booking: { form: { source: "menu", sections: "yes", shows: "all" } } } as never) as unknown as { form: Block["form"] };
      check("A2 a form the model garbles is dropped, not repaired", junk.form === null, JSON.stringify(junk.form));
      const none = sanitizeServices({ services: [], booking: {} } as never) as unknown as { form: Block["form"] };
      check("A3 no form reported → null, never a default shape", none.form === null);
      const a = sanitizeServices(ANTHONY_EXTRACT as never) as unknown as {
        staffContacts: { name: string; phone: string }[]; channels: string[];
      };
      check("A4 a person's stated number rides with their name",
        (a.staffContacts ?? []).map((c) => `${c.name}:${c.phone}`).join("|") === ANTHONY.staff.map((c) => `${c.name}:${c.phone}`).join("|"),
        JSON.stringify(a.staffContacts));
      check("A5 'text us' is a booking channel", (a.channels ?? []).join(",") === "text", (a.channels ?? []).join(","));
    }

    // ══ B. MoonLight: the card is their booking page ════════════════════════
    const moon = await mkUser("moonlight");
    const moonPages = [
      page(MOONLIGHT.site, "<h1>MoonLight Nails & Spa</h1><a href='/service'>Services</a>"),
      page(MOONLIGHT.bookingUrl, "<main>Service Staff Search service Manicure Gel manicure + removal $38.00</main>"),
    ];
    await extractServicesAndBooking(moonPages as never, moon.id, quiet, { llm: llmOf(MOONLIGHT_EXTRACT) as never });
    const mb = (await servicesBlock(moon.id)) as Block | null;
    check("B1 a services block is hydrated", mb?.type === "services" && mb.items.length === 9, JSON.stringify(mb?.items.length));
    check("B2 the block carries the site's form shape", JSON.stringify(mb?.form) === JSON.stringify(MOONLIGHT.form), JSON.stringify(mb?.form));
    const priced = mb?.items.every((it) => it.price === MOONLIGHT_EXTRACT.services.find((s) => s.name === it.name)?.price);
    check("B3 every row's price is the site's own string ('$22.00', not '$22')", !!priced, JSON.stringify(mb?.items.map((i) => [i.name, i.price])));
    const onlyStated = mb?.items.every((it) => extraKeys(it, ["price", "category"]).length === 0);
    check("B4 no row carries a duration, image or description the page doesn't show", !!onlyStated, JSON.stringify(mb?.items.map((i) => Object.keys(i))));
    check("B5 rows sit under the page's own headings, in its order",
      mb?.sections?.map((s) => s.name).join("|") === MOONLIGHT.sectionOrder.join("|"), JSON.stringify(mb?.sections?.map((s) => s.name)));
    check("B6 the first section is Manicure with its three rows",
      mb?.sections?.[0]?.items.map((i) => i.name).join("|") === "Gel manicure + removal|Basic Manicure|Gel Manicure");
    check("B7 the site books online, so bookings are not requests", mb?.request === false && (mb?.channels ?? []).some((c) => c.kind === "online"), JSON.stringify(mb?.channels));
    const moonMarkup = render(mb, moon.slug);
    check("B8 the rendered card shows their prices under their headings",
      moonMarkup.includes("$35.00") && moonMarkup.includes("$22.00") && moonMarkup.includes("Manicure") && moonMarkup.includes("PEDICURE"),
      moonMarkup.slice(0, 300));
    check("B9 …and nothing invented: no Varies, no default length, no image, no tile", invented(moonMarkup).length === 0, invented(moonMarkup).join(","));
    check("B10 the page picks several, so rows carry a pick control and one Continue",
      /type="checkbox"/.test(moonMarkup) && /Continue/.test(moonMarkup), moonMarkup.slice(0, 200));
    check("B11 the page has a search box, so the card has one", /placeholder="Search/.test(moonMarkup));
    const moonCards = await cardFromBrain(moon.id);
    check("B12 show_services through the brain yields the same composed block", moonCards.length === 1 && JSON.stringify(moonCards[0].form) === JSON.stringify(MOONLIGHT.form));
    const moonRows = await listServices(moon.id);
    check("B13 no service row was given an image by word overlap", moonRows.every((r) => r.imageUrl === null), JSON.stringify(moonRows.map((r) => r.imageUrl)));

    // ══ C. Anthony's: no form on the site, a booking made from what it says ══
    const ant = await mkUser("anthony");
    const antPages = [page(ANTHONY.site, `<main>${ANTHONY.text.replace(/\n/g, "<br>")}</main>`)];
    await extractServicesAndBooking(antPages as never, ant.id, quiet, { llm: llmOf(ANTHONY_EXTRACT) as never });
    const ab = (await servicesBlock(ant.id)) as Block | null;
    check("C1 the two things the bios say they do are listed", ab?.items.map((i) => i.name).join("|") === "Haircut|Beard and straight edge shave", JSON.stringify(ab?.items));
    check("C2 no form was reachable → form is null and rows are flat", ab?.form === null && ab?.sections === null);
    check("C3 no price, duration or image on any row — the site states none",
      !!ab && ab.items.every((it) => extraKeys(it, ["description"]).length === 0), JSON.stringify(ab?.items.map((i) => Object.keys(i))));
    check("C4 the card's way to book is theirs: text each barber at their number",
      !!ab && ANTHONY.staff.every((s) => (ab.channels ?? []).some((c) => c.kind === "text" && c.who === s.name && c.label.includes(s.phone))),
      JSON.stringify(ab?.channels));
    check("C5 a booking from the card is a request the shop confirms", ab?.request === true);
    const antMarkup = render(ab, ant.slug);
    check("C6 the rendered card carries their numbers and no fill-ins",
      ANTHONY.staff.every((s) => antMarkup.includes(s.phone)) && invented(antMarkup).length === 0 && !antMarkup.includes("$"),
      `${invented(antMarkup).join(",")} ${antMarkup.slice(0, 200)}`);

    const antBooking = (await bookingBlock(ant.id)) as Block["booking"];
    check("C7 a booking exists although the site has no form", !!antBooking?.flow);
    check("C8 its people are the three named, each with the stated number",
      antBooking?.flow?.staff.map((s) => `${s.name}:${s.phone}`).join("|") === ANTHONY.staff.map((s) => `${s.name}:${s.phone}`).join("|"),
      JSON.stringify(antBooking?.flow?.staff.map((s) => [s.name, s.phone])));
    check("C9 it is a request, and asks for a phone number", antBooking?.flow?.rules.confirmation === "request"
      && antBooking?.flow?.rules.customerFields.find((f) => f.key === "phone")?.required === true, JSON.stringify(antBooking?.flow?.rules));
    const antSettings = await getBookingSettings(ant.id);
    check("C10 settings record the site's channel and no form", antSettings.channels.join(",") === "text" && (antSettings as { siteForm?: unknown }).siteForm === null, JSON.stringify(antSettings.channels));
    check("C11 the staff rows keep the numbers as written", (await listStaff(ant.id)).every((s) => ANTHONY.staff.some((t) => t.name === s.name && t.phone === (s as { phone?: string }).phone)));
    const askedKeys = antBooking?.fields.map((f) => f.key) ?? [];
    check("C12 nothing the site never asks is asked: no address, no party size, no invented service menu",
      !askedKeys.some((k) => ["address", "party_size", "job"].includes(k)), askedKeys.join(","));
    check("C13 the unpriced services carry no invented price into the flow",
      !!antBooking?.flow && JSON.stringify(antBooking.flow.services).includes("Haircut") && !/"amount"/.test(JSON.stringify(antBooking.flow.services)));

    // ══ D. An extractor-named image stays on its item ════════════════════════
    const img = await mkUser("image");
    const imgPages = [page("https://example.invalid/menu", `<h2>Manicure</h2><img src="https://example.invalid/gel.webp" alt="Manicure banner"><p>Quillhaven Gel Manicure $40</p><p>Quillhaven Basic Manicure $25</p>`)];
    await extractServicesAndBooking(imgPages as never, img.id, quiet, {
      llm: llmOf({
        services: [
          { name: "Quillhaven Gel Manicure", description: "", price: "$40", duration: "45 min", category: "Manicure", menu: { image: "https://example.invalid/gel.webp" } },
          { name: "Quillhaven Basic Manicure", description: "", price: "$25", duration: "", category: "Manicure" },
        ],
        booking: { takesAppointments: true, kind: "personal_service", staff: [], channels: ["online"], form: { source: "services_page", sections: true, pickMany: false, staffStep: false, search: false, shows: { price: true, duration: true, image: true, description: false } }, requirements: [] },
      }) as never,
    });
    const ib = (await servicesBlock(img.id)) as Block | null;
    const gel = ib?.items.find((i) => i.name === "Quillhaven Gel Manicure");
    const basic = ib?.items.find((i) => i.name === "Quillhaven Basic Manicure");
    check("D1 the item the extractor pictured has its image", gel?.imageUrl === "https://example.invalid/gel.webp", JSON.stringify(gel));
    check("D2 its neighbour under the same heading does not inherit it", basic !== undefined && !("imageUrl" in basic), JSON.stringify(basic));
    check("D3 a stated duration shows as written; an unstated one is absent", gel?.duration === "45 min" && basic !== undefined && !("duration" in basic));
    const imgMarkup = render(ib, img.slug);
    check("D4 the render draws that one image and no tile beside the other", (imgMarkup.match(/<img/g) ?? []).length === 1 && !imgMarkup.includes("placeholder-image"));

    // ══ E. The tenant the request came from: a name-only catalog ══════════════
    const old = await mkUser("names-only");
    await prisma.source.create({
      data: {
        userId: old.id, type: "link", url: MOONLIGHT.site, title: SERVICES_SOURCE_TITLE, status: "scanned",
        kind: onboardingIngestKind("services"),
        rawText: formatServiceCatalog([{ name: "Gel Manicure + Removal", description: "" }, { name: "Basic Manicure", description: "" }]),
      },
    });
    const ob = (await servicesBlock(old.id)) as Block | null;
    check("E1 names only on file → names only on the card", !!ob && ob.items.length === 2 && ob.items.every((it) => extraKeys(it, []).length === 0), JSON.stringify(ob?.items));
    const oldMarkup = render(ob, old.slug);
    check("E2 …with no Varies, no default length, no tile", invented(oldMarkup).length === 0, invented(oldMarkup).join(","));

    // ══ F. Nothing on file at all ══════════════════════════════════════════════
    const empty = await mkUser("empty");
    check("F1 no services and no form → no card (the agent answers in words)", (await servicesBlock(empty.id)) === null);
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    const left = await prisma.user.count({ where: { email: { startsWith: "proof-site-form-" } } });
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

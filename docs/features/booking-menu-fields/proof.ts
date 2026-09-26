/**
 * Primary proof for booking-menu-fields (see PROOF.md).
 * Run: npx tsx --tsconfig tsconfig.proofs.json docs/features/booking-menu-fields/proof.ts
 *
 * Section A exercises the pure rules. Sections B–D run the real store, the
 * real card hydration, the real booking transaction and the real onboarding
 * stage against the local dev Postgres under throwaway users (the scripted
 * `llm` is the one doubled boundary). Section E renders the real screen card
 * to static markup and asserts the controls the visitor is handed.
 * Everything made is deleted at the end.
 *
 * The menu is a question the OWNER writes — a select / multi_select with
 * priced options — and the card draws it with those prices. Nothing plans or
 * seeds a picker any more, and nothing is rewritten on read.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";

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
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const page = (url: string, body: string) => {
  const html = `<html><body>${body}</body></html>`;
  return { url, html, $: cheerio.load(html) };
};
const PAGES = [page("https://example.invalid/services", "<h1>Menu</h1>")];

// Distinctive names so a DB match can only come from this proof.
const GEL = "Thistlewick Gel Manicure";
const BASIC = "Thistlewick Basic Manicure";
const PEDI = "Thistlewick Spa Pedicure";
const FRENCH = "Thistlewick French Tips";

const tomorrowAt = (h: number, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const ALL_HOURS = { start: "00:00", end: "23:59" };
const ALWAYS_OPEN = { mon: [ALL_HOURS], tue: [ALL_HOURS], wed: [ALL_HOURS], thu: [ALL_HOURS], fri: [ALL_HOURS], sat: [ALL_HOURS], sun: [ALL_HOURS] };

async function main() {
  const T = await import("../../../lib/appointmentTypes");
  const M = await import("../../../lib/serviceCatalog");

  // ══ A. The pure rules ═══════════════════════════════════════════════════
  {
    const cfg = T.sanitizeFieldConfig("multi_select", {
      options: [
        { label: `  ${GEL}  `, price: "$35", duration: "45 min", group: "Manicures", junk: 1 },
        { label: GEL.toUpperCase(), price: "$99" }, // same label, different case
        "Bare string option",
        { label: "" },
        7,
      ],
      allowOther: true,
      max: 3,
    });
    check(
      "A1 options are trimmed, de-duplicated by label, and junk is dropped",
      cfg.options?.length === 2 && cfg.options[0].label === GEL && cfg.options[0].price === "$35",
      JSON.stringify(cfg),
    );
    check("A1 a bare string is an option", cfg.options?.[1]?.label === "Bare string option");
    check("A1 a menu keeps allowOther and drops a number's max", cfg.allowOther === true && cfg.max === undefined);
    check(
      "A1 a text question carries no config at all",
      JSON.stringify(T.sanitizeFieldConfig("short_text", { options: [{ label: "x" }], min: 1 })) === "{}",
    );
    const num = T.sanitizeFieldConfig("number", { min: 2, max: 1, options: [{ label: "x" }] });
    check("A1 a max below the min is dropped, and so are options", num.min === 2 && num.max === undefined && !num.options);
    check("A1 stored junk reads as an empty config", JSON.stringify(T.parseFieldConfig("select", "{not json")) === '{"options":[],"allowOther":false}');
  }
  {
    const text = `# Manicures\n${GEL} | $35 | 45 min | Includes removal\n${BASIC} | 30 min | $25\n\n# Add-ons\n${FRENCH} | $5\nConsultation | Free | Includes 2 coats of advice`;
    const opts = T.parseOptionLines(text);
    check("A2 one option per line", opts.length === 4, JSON.stringify(opts));
    check(
      "A2 name | price | duration | description",
      opts[0].price === "$35" && opts[0].duration === "45 min" && opts[0].description === "Includes removal",
      JSON.stringify(opts[0]),
    );
    check("A2 price and duration may be swapped", opts[1].price === "$25" && opts[1].duration === "30 min", JSON.stringify(opts[1]));
    check("A2 a # line starts a section", opts[0].group === "Manicures" && opts[2].group === "Add-ons");
    check(
      "A2 a description that mentions a number stays a description",
      opts[3].price === "Free" && opts[3].description === "Includes 2 coats of advice" && !opts[3].duration,
      JSON.stringify(opts[3]),
    );
    check(
      "A2 what the editor shows parses back to the same menu",
      JSON.stringify(T.parseOptionLines(T.formatOptionLines(opts))) === JSON.stringify(opts),
      T.formatOptionLines(opts),
    );
  }
  {
    const total = (picks: { label: string; price?: string; duration?: string }[]) => T.selectionTotal(picks);
    check("A3 exact prices add up", total([{ label: "a", price: "$35" }, { label: "b", price: "$5.50" }]).price === "$40.50");
    check("A3 a 'from' price makes the total a floor", total([{ label: "a", price: "$35" }, { label: "b", price: "from $40" }]).price === "$75+");
    check("A3 an unpriced pick makes the total a floor", total([{ label: "a", price: "$35" }, { label: "b" }]).price === "$35+");
    check("A3 nothing priced means no total, not $0", total([{ label: "a" }]).price === null);
    check("A3 the currency is the menu's own", total([{ label: "a", price: "£1,200" }]).price === "£1200");
    check(
      "A3 durations add across units",
      total([{ label: "a", duration: "1 hr" }, { label: "b", duration: "45 min" }, { label: "c", duration: "1h 30m" }]).duration === "3 hr 15 min",
      String(total([{ label: "a", duration: "1 hr" }, { label: "b", duration: "45 min" }, { label: "c", duration: "1h 30m" }]).duration),
    );
    check("A3 'varies' is not a price", T.priceAmount("varies") === null);
  }
  {
    const menu = {
      label: "Which services?",
      type: "multi_select" as const,
      config: { options: [{ label: GEL, price: "$35", duration: "45 min" }, { label: FRENCH, price: "$5" }], allowOther: false },
    };
    const two = T.resolveAnswer(menu, [GEL, FRENCH.toLowerCase(), GEL]);
    check(
      "A4 picks are stored with the price shown and their total",
      two.ok && two.value === `${GEL} ($35 · 45 min), ${FRENCH} ($5) — total $40 · 45 min+`,
      JSON.stringify(two),
    );
    check("A4 one pick has no total to add", (() => { const r = T.resolveAnswer(menu, GEL); return r.ok && r.value === `${GEL} ($35 · 45 min)`; })());
    check("A4 an off-menu pick is rejected", !T.resolveAnswer(menu, [GEL, "Free car"]).ok);
    const open = { ...menu, config: { ...menu.config, allowOther: true } };
    const other = T.resolveAnswer(open, [GEL, "Chrome powder"]);
    check("A4 …unless the question allows something else", other.ok && other.value.includes("Chrome powder") && other.value.includes("$35+"), JSON.stringify(other));
    check("A4 pick-one takes one", !T.resolveAnswer({ ...menu, type: "select" }, [GEL, FRENCH]).ok);
    check("A4 no picks is no answer, not an error", (() => { const r = T.resolveAnswer(menu, []); return r.ok && r.value === ""; })());

    const party = { label: "Party size", type: "number" as const, config: { min: 1, max: 8 } };
    check("A4 a count inside its bounds", (() => { const r = T.resolveAnswer(party, "4"); return r.ok && r.value === "4"; })());
    check("A4 a count outside its bounds is rejected", !T.resolveAnswer(party, 9).ok && !T.resolveAnswer(party, "0").ok);
    check("A4 a count must be whole", !T.resolveAnswer(party, "2.5").ok && !T.resolveAnswer(party, "lots").ok);
    const yn = { label: "First visit?", type: "yes_no" as const, config: {} };
    check("A4 yes/no normalizes", (() => { const r = T.resolveAnswer(yn, "yes"); return r.ok && r.value === "Yes"; })());
    check("A4 yes/no takes nothing else", !T.resolveAnswer(yn, "maybe").ok);
  }
  {
    // The menu facts read out of prose (lib/serviceCatalog.ts) — what the
    // services seeder uses for a Service row's price, never a picker's.
    check("A5 one stated amount is the price", M.priceFromText("Classic gel polish. $35, about 45 minutes.") === "$35");
    check("A5 'starting at' is a floor", M.priceFromText("Full sets starting at $60") === "$60+");
    check("A5 several amounts are a floor at the lowest", M.priceFromText("Short $45, long $30") === "$30+");
    check("A5 no amount, no price", M.priceFromText("Ask us about pricing") === "");
    check("A5 one stated duration", M.durationFromText("Classic gel polish. $35, about 45 minutes.") === "45 minutes");
    check("A5 two durations are not guessed between", M.durationFromText("30 minutes or 1 hour") === "");
  }

  // ══ B–D. The store, the card block, the booking, onboarding ═════════════
  const { prisma } = await import("../../../lib/db");
  const { getBookingConfig, saveAppointmentField } = await import("../../../lib/appointments");
  const { createBooking, listBookings, saveBookingSettings, listServices } = await import("../../../lib/booking/store");
  const { sanitizeSelection } = await import("../../../lib/booking/types");
  const { bookingBlock } = await import("../../../lib/cards");
  const { extractServicesAndBooking, sanitizeServices } = await import("../../../lib/onboarding/services");
  const { onboardingIngestKind } = await import("../../../lib/ingestionSources");
  const { SERVICES_SOURCE_TITLE } = await import("../../../lib/serviceCatalog");

  let seq = 0;
  const made: string[] = [];
  const newUser = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        email: `proof-booking-menu-${tag}-${Date.now()}-${seq++}@example.invalid`,
        name: `Proof Menu ${tag}`,
        slug: `proof-booking-menu-${tag}-${Date.now()}-${seq++}`,
        passwordHash: "",
        onboardedAt: new Date(),
      },
    });
    made.push(u.id);
    return u;
  };
  const book = (userId: string, startsAt: string, answers: Record<string, unknown>) =>
    createBooking(userId, sanitizeSelection({ serviceId: null, startsAt, answers }));

  try {
    // ── B. A menu question round-trips, and the server enforces it ──
    const owner = await newUser("store");
    await saveBookingSettings(owner.id, { hours: ALWAYS_OPEN });
    await saveAppointmentField(owner.id, { key: "name", label: "Your name", type: "short_text", required: true, role: "name" });
    const menuConfig = {
      options: [
        { label: GEL, price: "$35", duration: "45 min", group: "Manicures" },
        { label: FRENCH, price: "$5", group: "Add-ons" },
      ],
      allowOther: false,
    };
    check(
      "B1 a choice question with nothing to choose is refused",
      (await saveAppointmentField(owner.id, { label: "Pick", type: "select", required: false, config: { options: [] } })) !== null,
    );
    check(
      "B1 a menu question saves",
      (await saveAppointmentField(owner.id, { key: "service", label: "Which services?", type: "multi_select", required: true, config: menuConfig })) === null,
    );
    await saveAppointmentField(owner.id, { key: "party", label: "Party size", type: "number", required: false, config: { min: 1, max: 6 } });
    const stored = (await getBookingConfig(owner.id)).fields;
    const storedMenu = stored.find((f) => f.key === "service");
    check(
      "B2 the menu reads back whole: type, options, prices, sections",
      storedMenu?.type === "multi_select" && JSON.stringify(storedMenu.config.options) === JSON.stringify(menuConfig.options),
      JSON.stringify(storedMenu),
    );
    await saveAppointmentField(owner.id, { key: "service", label: "What are we doing today?", type: "multi_select", required: true });
    const renamed = (await getBookingConfig(owner.id)).fields.find((f) => f.key === "service");
    check(
      "B2 renaming a question without resending its menu keeps the menu",
      renamed?.label === "What are we doing today?" && renamed.config.options?.length === 2,
      JSON.stringify(renamed),
    );

    const block = await bookingBlock(owner.id);
    const blockMenu = block?.type === "booking" ? block.fields.find((f) => f.key === "service") : undefined;
    check(
      "B3 the card block hands the card the type and the menu",
      blockMenu?.type === "multi_select" && blockMenu.config.options?.[0]?.price === "$35",
      JSON.stringify(blockMenu),
    );
    check(
      "B3 …and a number's bounds",
      block?.type === "booking" && block.fields.find((f) => f.key === "party")?.config.max === 6,
    );
    check("B3 no service is derived from the menu: it is a question of the form, the flow sells nothing", block?.type === "booking" && block.flow?.services.length === 0 && (await listServices(owner.id)).length === 0);

    const ok = await book(owner.id, tomorrowAt(10), { name: "Wren", service: [GEL, FRENCH], party: 2 });
    check("B4 a booking with two services is accepted", ok.ok, JSON.stringify(ok));
    const booked = (await listBookings(owner.id))[0]?.answers ?? {};
    check(
      "B4 the owner sees each service, its price, and the total",
      booked.service === `${GEL} ($35 · 45 min), ${FRENCH} ($5) — total $40 · 45 min+` && booked.party === "2",
      JSON.stringify(booked),
    );
    const offMenu = await book(owner.id, tomorrowAt(11), { name: "Wren", service: ["Free car"] });
    check("B5 the server refuses a pick that isn't on the menu", !offMenu.ok, JSON.stringify(offMenu));
    const none = await book(owner.id, tomorrowAt(11), { name: "Wren", service: [] });
    check("B5 a required menu needs at least one pick", !none.ok && none.error.includes("required"), JSON.stringify(none));
    const crowd = await book(owner.id, tomorrowAt(11), { name: "Wren", service: GEL, party: 40 });
    check("B5 the server refuses a count past its bounds", !crowd.ok, JSON.stringify(crowd));
    const asText = await book(owner.id, tomorrowAt(12), { name: "Wren", service: GEL });
    check("B5 a bare-text pick is accepted", asText.ok, JSON.stringify(asText));

    // ── C. The menu is the owner's own: nothing is rewritten on read ──
    const legacy = await newUser("legacy");
    await saveBookingSettings(legacy.id, { hours: ALWAYS_OPEN });
    const LEGACY_LABEL = `Which service are you booking? ${BASIC}, ${GEL}, or something else`;
    await saveAppointmentField(legacy.id, { key: "name", label: "Your name", type: "short_text", required: true, role: "name" });
    await saveAppointmentField(legacy.id, { key: "service", label: LEGACY_LABEL, type: "short_text", required: true });
    // The catalog exactly as older onboardings saved it: "Name. Description" per line.
    await prisma.source.create({
      data: {
        userId: legacy.id,
        kind: onboardingIngestKind("services"),
        title: SERVICES_SOURCE_TITLE,
        url: "https://example.invalid/services",
        rawText: `${BASIC}. Shape, buff and polish. $25, 30 minutes.\n\n${GEL}. Long-wear gel polish. Starting at $35.\n\n${PEDI}.`,
      },
    });
    const asStored = (await getBookingConfig(legacy.id)).fields.find((f) => f.key === "service");
    check("C1 a text question stays a text question, catalog on file or not: nothing is upgraded on read", asStored?.type === "short_text" && asStored.label === LEGACY_LABEL && !asStored.config.options, JSON.stringify(asStored));
    const row = await prisma.appointmentField.findFirst({ where: { userId: legacy.id, key: "service" } });
    check("C1 the stored row is untouched", row?.type === "short_text" && row.label === LEGACY_LABEL && row.config === "{}");
    const legacyBlock = await bookingBlock(legacy.id);
    check("C1 the card is handed the text box, not a menu", legacyBlock?.type === "booking" && legacyBlock.fields.find((f) => f.key === "service")?.type === "short_text");
    // The owner turns it into a menu by writing one: those are the prices the
    // card shows and the server enforces — the owner's, not the catalog's.
    check("C2 the owner rewrites it as a menu with their own prices", (await saveAppointmentField(legacy.id, { key: "service", label: "Which services would you like?", type: "multi_select", required: true, config: { options: [{ label: BASIC, price: "$25", duration: "30 min" }, { label: GEL, price: "$40" }, { label: PEDI }], allowOther: true } })) === null);
    const owned = (await getBookingConfig(legacy.id)).fields.find((f) => f.key === "service");
    check("C2 it reads back as written, prices the owner's own", owned?.type === "multi_select" && owned.config.options?.map((o) => `${o.label}:${o.price ?? ""}`).join() === `${BASIC}:$25,${GEL}:$40,${PEDI}:` && owned.config.allowOther === true, JSON.stringify(owned));
    const viaMenu = await book(legacy.id, tomorrowAt(13), { name: "Wren", service: [BASIC, PEDI] });
    check("C3 the validator sees the same menu the card does", viaMenu.ok, JSON.stringify(viaMenu));
    check(
      "C3 …and stores the priced picks",
      ((await listBookings(legacy.id))[0]?.answers.service ?? "").startsWith(`${BASIC} ($25 · 30 min), ${PEDI}`),
      JSON.stringify((await listBookings(legacy.id))[0]?.answers),
    );
    const offOwned = await book(legacy.id, tomorrowAt(14), { name: "Wren", service: [FRENCH] });
    check("C3 something else is allowed, as the owner said, and stored as a floor", offOwned.ok && ((await listBookings(legacy.id)).find((b) => b.id === (offOwned.ok ? offOwned.id : ""))?.answers.service ?? "") === FRENCH, JSON.stringify(offOwned));

    // ── D. Onboarding seeds services, never a picker ──
    const EXTRACT = {
      services: [
        { name: GEL, description: "Long-wear gel polish.", price: "$35", duration: "45 min", category: "Manicures" },
        { name: BASIC, description: "Shape, buff and polish.", price: "$25", duration: "30 min", category: "Manicures" },
        { name: PEDI, description: "Soak, scrub and polish. $50.", price: "", duration: "", category: "Pedicures" },
      ],
      booking: { takesAppointments: true, channels: ["online"] },
    };
    const clean = sanitizeServices(EXTRACT as unknown as Record<string, unknown>);
    check("D1 the sanitizer keeps price, duration and category", clean.services[0].price === "$35" && clean.services[0].duration === "45 min" && clean.services[0].category === "Manicures");
    check("D1 the extract carries no form requirements any more", !("requirements" in clean) && clean.channels.join() === "online");

    const fresh = await newUser("onboard");
    const staged = await extractServicesAndBooking(PAGES as never, fresh.id, () => {}, { llm: async () => EXTRACT as unknown as Record<string, unknown>, formLlm: async () => { throw new Error("no form to transcribe"); }, readForm: async () => null });
    const seeded = (await getBookingConfig(fresh.id)).fields;
    check("D2 the stage seeds no question at all: no picker, no defaults", seeded.length === 0 && staged.report.seededFields === 0 && staged.report.formFound === false, JSON.stringify(seeded.map((f) => f.key)));
    const services = await listServices(fresh.id);
    check("D2 the services become the service step, priced from the site's own words", services.map((s) => `${s.name}:${s.pricing.kind}:${s.pricing.amount ?? ""}`).join() === `${GEL}:fixed:35,${BASIC}:fixed:25,${PEDI}:fixed:50`, JSON.stringify(services.map((s) => [s.name, s.pricing])));
    const freshBlock = await bookingBlock(fresh.id);
    check("D2 the card sells through the flow, with nothing to ask", freshBlock?.type === "booking" && freshBlock.fields.length === 0 && freshBlock.flow?.services.length === 3);

    // ══ E. What the visitor is actually handed ══════════════════════════════
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { ScreenStep } = await import("../../../app/cards/booking/ScreenStep");
    type Field = { key: string; label: string; type: string; required: boolean; config: Record<string, unknown>; role?: string; screen?: number };
    const draw = (fields: Field[]) =>
      renderToStaticMarkup(
        React.createElement(ScreenStep, {
          step: { kind: "screen", screen: 1, title: "", fields: fields.map((f) => ({ role: "none", screen: 1, ...f })) } as never,
          answers: {},
          setAnswer: () => {},
          slug: "proof",
          onNext: () => {},
        }),
      );
    const menu: Field = {
      key: "service", label: "Which services would you like?", type: "multi_select", required: true,
      config: { options: [{ label: GEL, price: "$35", duration: "45 min", group: "Manicures" }, { label: BASIC, price: "$25", duration: "30 min", group: "Manicures" }, { label: PEDI, price: "$50", group: "Pedicures" }], allowOther: true },
    };

    const menuHtml = draw([menu]);
    check("E1 a menu is drawn as one checkbox per option", (menuHtml.match(/type="checkbox"/g) ?? []).length === 4, String((menuHtml.match(/type="checkbox"/g) ?? []).length));
    check("E1 …each with its name and price", menuHtml.includes(GEL) && menuHtml.includes("$35") && menuHtml.includes("45 min"));
    check("E1 …under its section headings", menuHtml.includes("Manicures") && menuHtml.includes("Pedicures"));
    check("E1 …with a way to ask for something else", menuHtml.includes("Something else"));
    check("E1 …and no text box to retype a service into", !/<input[^>]*type="text"/.test(menuHtml));
    check("E1 a required menu can't be skipped while nothing is picked", /<button[^>]*aria-disabled="true"[^>]*>Next<\/button>/.test(menuHtml), menuHtml.slice(-260));

    const oneHtml = draw([{ ...menu, type: "select" }]);
    check("E2 pick-one is drawn as radios", (oneHtml.match(/type="radio"/g) ?? []).length === 4 && !oneHtml.includes('type="checkbox"'));

    const towns = Array.from({ length: 12 }, (_, i) => ({ label: `Branch ${i + 1}`, group: i < 6 ? "North" : "South" }));
    const dropHtml = draw([{ key: "branch", label: "Which branch?", type: "select", required: true, config: { options: towns } }]);
    check("E3 a long plain list is a dropdown", dropHtml.includes("<select") && (dropHtml.match(/<option/g) ?? []).length === 13 && !dropHtml.includes('type="radio"'));
    check("E3 …with its sections as optgroups", dropHtml.includes('<optgroup label="North"') && dropHtml.includes('<optgroup label="South"'));

    const countHtml = draw([{ key: "party", label: "Party size", type: "number", required: true, config: { min: 1, max: 8 } }]);
    check("E4 a count is a stepper", countHtml.includes('aria-label="One fewer"') && countHtml.includes('aria-label="One more"') && (countHtml.includes('inputMode="numeric"') || countHtml.includes('inputmode="numeric"')));
    const ynHtml = draw([{ key: "first", label: "First visit?", type: "yes_no", required: false, config: {} }]);
    check("E5 yes/no is two buttons, and optional means Skip", ynHtml.includes(">Yes</button>") && ynHtml.includes(">No</button>") && ynHtml.includes(">Skip</button>"));
    const oldHtml = draw([{ key: "name", label: "Your name", type: "short_text", required: true, config: {} }]);
    check("E6 a text question draws its text box, required marked on the label", /<input[^>]*type="text"/.test(oldHtml) && oldHtml.includes("Your name *"));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
    const left = await prisma.user.count({ where: { email: { startsWith: "proof-booking-menu-" } } });
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

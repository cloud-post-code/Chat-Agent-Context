/**
 * Primary proof for booking-menu-fields (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/booking-menu-fields/tsconfig.proof.json docs/features/booking-menu-fields/proof.ts
 *
 * Section A exercises the pure rules. Sections B–D run the real store, the
 * real card hydration and the real onboarding stage against the local dev
 * Postgres under throwaway users (the scripted `llm` is the one doubled
 * boundary). Section E renders the real wizard to static markup and asserts
 * the controls the visitor is handed. Everything made is deleted at the end.
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

async function main() {
  const T = await import("../../../lib/appointmentTypes");
  const M = await import("../../../lib/bookingMenu");

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
    check("A5 one stated amount is the price", M.priceFromText("Classic gel polish. $35, about 45 minutes.") === "$35");
    check("A5 'starting at' is a floor", M.priceFromText("Full sets starting at $60") === "$60+");
    check("A5 several amounts are a floor at the lowest", M.priceFromText("Short $45, long $30") === "$30+");
    check("A5 no amount, no price", M.priceFromText("Ask us about pricing") === "");
    check("A5 one stated duration", M.durationFromText("Classic gel polish. $35, about 45 minutes.") === "45 minutes");
    check("A5 two durations are not guessed between", M.durationFromText("30 minutes or 1 hour") === "");
    const opts = M.serviceOptions([
      { name: GEL, description: "Long-wear gel polish with cuticle care. $35, 45 minutes.", category: "Manicures" },
      { name: BASIC, description: "$25", price: "$20", category: "Manicures" },
      { name: PEDI, description: "", category: "Pedicures" },
      { name: FRENCH, description: "", category: "Manicures" },
    ]);
    check("A5 price and duration are read out of a description", opts[0].price === "$35" && opts[0].duration === "45 minutes", JSON.stringify(opts[0]));
    check("A5 a stated price beats one found in prose", opts.find((o) => o.label === BASIC)?.price === "$20");
    check("A5 a description that is only a price is not repeated", opts.find((o) => o.label === BASIC)?.description === undefined);
    check(
      "A5 sections stay together, in the menu's order",
      opts.map((o) => o.group).join(",") === "Manicures,Manicures,Manicures,Pedicures",
      opts.map((o) => `${o.group}:${o.label}`).join(" | "),
    );
    const flatMenu = M.serviceOptions([{ name: GEL, description: "", category: "All" }, { name: PEDI, description: "", category: "All" }]);
    check("A5 a single section is no section", flatMenu.every((o) => o.group === undefined));
    check("A5 no services, no picker", M.servicePickerField([]) === null);
  }

  // ══ B–D. The store, the card block, onboarding ══════════════════════════
  const { prisma } = await import("../../../lib/db");
  const { getBookingConfig, saveAppointmentField, createAppointment, listAppointments } = await import(
    "../../../lib/appointments"
  );
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

  try {
    // ── B. A menu question round-trips, and the server enforces it ──
    const owner = await newUser("store");
    await saveAppointmentField(owner.id, { key: "name", label: "Your name", type: "short_text", required: true });
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
      "B3 the A2UI block hands the card the type and the menu",
      blockMenu?.type === "multi_select" && blockMenu.config.options?.[0]?.price === "$35",
      JSON.stringify(blockMenu),
    );
    check(
      "B3 …and a number's bounds",
      block?.type === "booking" && block.fields.find((f) => f.key === "party")?.config.max === 6,
    );

    const ok = await createAppointment(owner.id, {
      startsAt: tomorrowAt(10),
      answers: { name: "Wren", service: [GEL, FRENCH], party: 2 },
    });
    check("B4 a booking with two services is accepted", ok.ok, JSON.stringify(ok));
    const booked = (await listAppointments(owner.id))[0]?.answers ?? {};
    check(
      "B4 the owner sees each service, its price, and the total",
      booked.service === `${GEL} ($35 · 45 min), ${FRENCH} ($5) — total $40 · 45 min+` && booked.party === "2",
      JSON.stringify(booked),
    );
    const offMenu = await createAppointment(owner.id, { startsAt: tomorrowAt(11), answers: { name: "Wren", service: ["Free car"] } });
    check("B5 the server refuses a pick that isn't on the menu", !offMenu.ok, JSON.stringify(offMenu));
    const none = await createAppointment(owner.id, { startsAt: tomorrowAt(11), answers: { name: "Wren", service: [] } });
    check("B5 a required menu needs at least one pick", !none.ok && none.error.includes("required"), JSON.stringify(none));
    const crowd = await createAppointment(owner.id, { startsAt: tomorrowAt(11), answers: { name: "Wren", service: GEL, party: 40 } });
    check("B5 the server refuses a count past its bounds", !crowd.ok, JSON.stringify(crowd));
    const asText = await createAppointment(owner.id, { startsAt: tomorrowAt(12), answers: { name: "Wren", service: GEL } });
    check("B5 a bare-text pick (the services card's prefill shape) is accepted", asText.ok, JSON.stringify(asText));

    // ── C. The old generated text box is presented as the menu ──
    const legacy = await newUser("legacy");
    const LEGACY_LABEL = `Which service are you booking? ${BASIC}, ${GEL}, or something else`;
    await saveAppointmentField(legacy.id, { key: "name", label: "Your name", type: "short_text", required: true });
    await saveAppointmentField(legacy.id, { key: "service", label: LEGACY_LABEL, type: "short_text", required: true });
    const before = (await getBookingConfig(legacy.id)).fields.find((f) => f.key === "service");
    check("C1 with no services on file the question is left alone", before?.type === "short_text" && before.label === LEGACY_LABEL);

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
    const upgraded = (await getBookingConfig(legacy.id)).fields.find((f) => f.key === "service");
    const upOpts = upgraded?.config.options ?? [];
    check("C2 it is presented as a pick-any menu", upgraded?.type === "multi_select" && upgraded.label === M.SERVICE_PICKER_LABEL, JSON.stringify(upgraded));
    check("C2 every service on file is an option — not just the ones the label had room for", upOpts.map((o) => o.label).join("|") === [BASIC, GEL, PEDI].join("|"), JSON.stringify(upOpts));
    check(
      "C2 prices and durations come from what the catalog says",
      upOpts[0]?.price === "$25" && upOpts[0]?.duration === "30 minutes" && upOpts[1]?.price === "$35+" && upOpts[2]?.price === undefined,
      JSON.stringify(upOpts),
    );
    check("C2 'something else' stays open and required stays required", upgraded?.config.allowOther === true && upgraded.required === true);
    const row = await prisma.appointmentField.findFirst({ where: { userId: legacy.id, key: "service" } });
    check("C3 the upgrade is a presentation — the stored row is untouched", row?.type === "short_text" && row.label === LEGACY_LABEL && row.config === "{}");
    const viaMenu = await createAppointment(legacy.id, { startsAt: tomorrowAt(13), answers: { name: "Wren", service: [BASIC, PEDI] } });
    check("C4 the validator sees the same menu the card does", viaMenu.ok, JSON.stringify(viaMenu));
    check(
      "C4 …and stores the priced picks",
      ((await listAppointments(legacy.id))[0]?.answers.service ?? "").startsWith(`${BASIC} ($25 · 30 minutes), ${PEDI}`),
      JSON.stringify((await listAppointments(legacy.id))[0]?.answers),
    );
    await saveAppointmentField(legacy.id, { key: "service", label: "What can we do for you?", type: "short_text", required: true });
    const owned = (await getBookingConfig(legacy.id)).fields.find((f) => f.key === "service");
    check("C5 a question the tenant has reworded is theirs — never upgraded", owned?.type === "short_text" && owned.label === "What can we do for you?");

    // ── D. Onboarding builds the menu by itself ──
    const EXTRACT = {
      services: [
        { name: GEL, description: "Long-wear gel polish.", price: "$35", duration: "45 min", category: "Manicures" },
        { name: BASIC, description: "Shape, buff and polish.", price: "$25", duration: "30 min", category: "Manicures" },
        { name: PEDI, description: "Soak, scrub and polish. $50.", price: "", duration: "", category: "Pedicures" },
      ],
      booking: {
        takesAppointments: true,
        requirements: [
          { label: "Preferred technician", type: "select", required: false, options: ["Mara", "Oksana", "Mara", ""] },
          { label: "Party size", type: "number", required: true, options: ["ignored"] },
          { label: "Is this your first visit?", type: "yes_no", required: false },
          { label: "Nail shape", type: "select", required: false, options: ["Almond"] },
        ],
      },
    };
    const clean = sanitizeServices(EXTRACT as unknown as Record<string, unknown>);
    check("D1 the sanitizer keeps price, duration and category", clean.services[0].price === "$35" && clean.services[0].category === "Manicures");
    check(
      "D1 a requirement's choices are de-duplicated; other types carry none",
      clean.requirements[0].options.join(",") === "Mara,Oksana" && clean.requirements[1].options.length === 0,
      JSON.stringify(clean.requirements),
    );
    check("D1 a choice with fewer than two choices is a text question", clean.requirements[3].type === "short_text" && clean.requirements[3].options.length === 0);

    const fresh = await newUser("onboard");
    await extractServicesAndBooking(PAGES as never, fresh.id, () => {}, { llm: async () => EXTRACT as unknown as Record<string, unknown> });
    const seeded = (await getBookingConfig(fresh.id)).fields;
    const picker = seeded.find((f) => f.key === "service");
    check(
      "D2 the seeded service question is a required pick-any menu",
      picker?.type === "multi_select" && picker.required && picker.label === M.SERVICE_PICKER_LABEL && picker.config.allowOther === true,
      JSON.stringify(picker),
    );
    check(
      "D2 each service is an option with its price, duration and section",
      JSON.stringify(picker?.config.options?.[0]) === JSON.stringify({ label: GEL, price: "$35", duration: "45 min", description: "Long-wear gel polish.", group: "Manicures" }),
      JSON.stringify(picker?.config.options?.[0]),
    );
    check("D2 a price only the description states is still found", picker?.config.options?.find((o) => o.label === PEDI)?.price === "$50");
    check("D2 the label no longer tries to be the menu", !seeded.some((f) => f.label.includes(GEL)), seeded.map((f) => f.label).join(" | "));
    const tech = seeded.find((f) => f.label === "Preferred technician");
    check(
      "D3 a requirement with listed choices becomes a pick-one with those choices",
      tech?.type === "select" && tech.config.options?.map((o) => o.label).join(",") === "Mara,Oksana" && tech.config.allowOther === true,
      JSON.stringify(tech),
    );
    check("D3 a count and a yes/no keep their types", seeded.find((f) => f.label === "Party size")?.type === "number" && seeded.find((f) => f.label === "Is this your first visit?")?.type === "yes_no");
    check(
      "D4 the order is who → what → the specifics",
      seeded.map((f) => f.key).join(",").startsWith("name,email,service,preferred_technician"),
      seeded.map((f) => f.key).join(","),
    );

    // ══ E. What the visitor is actually handed ══════════════════════════════
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = (await import("react")).default;
    const { Cards } = await import("../../../app/cards/Cards");
    const draw = (fields: unknown[]) =>
      renderToStaticMarkup(React.createElement(Cards, { slug: "proof", block: { type: "booking", fields } } as never));

    const menuHtml = draw([picker]);
    check("E1 a menu is drawn as one checkbox per service", (menuHtml.match(/type="checkbox"/g) ?? []).length === 4, String((menuHtml.match(/type="checkbox"/g) ?? []).length));
    check("E1 …each with its name and price", menuHtml.includes(GEL) && menuHtml.includes("$35") && menuHtml.includes("45 min"));
    check("E1 …under its section headings", menuHtml.includes("Manicures") && menuHtml.includes("Pedicures"));
    check("E1 …with a way to ask for something else", menuHtml.includes("Something else"));
    check("E1 …and no text box to retype a service into", !/<input[^>]*type="text"/.test(menuHtml));
    check("E1 a required menu can't be skipped while nothing is picked", /<button[^>]*disabled[^>]*>Next<\/button>/.test(menuHtml), menuHtml.slice(-260));

    const oneHtml = draw([{ ...picker, type: "select" }]);
    check("E2 pick-one is drawn as radios", (oneHtml.match(/type="radio"/g) ?? []).length === 4 && !oneHtml.includes('type="checkbox"'));

    const towns = Array.from({ length: 12 }, (_, i) => ({ label: `Branch ${i + 1}`, group: i < 6 ? "North" : "South" }));
    const dropHtml = draw([{ key: "branch", label: "Which branch?", type: "select", required: true, config: { options: towns } }]);
    check("E3 a long plain list is a dropdown", dropHtml.includes("<select") && (dropHtml.match(/<option/g) ?? []).length === 13 && !dropHtml.includes('type="radio"'));
    check("E3 …with its sections as optgroups", dropHtml.includes('<optgroup label="North"') && dropHtml.includes('<optgroup label="South"'));

    const countHtml = draw([{ key: "party", label: "Party size", type: "number", required: true, config: { min: 1, max: 8 } }]);
    check("E4 a count is a stepper", countHtml.includes('aria-label="One fewer"') && countHtml.includes('aria-label="One more"') && countHtml.includes('inputMode="numeric"') || countHtml.includes('inputmode="numeric"'));
    const ynHtml = draw([{ key: "first", label: "First visit?", type: "yes_no", required: false, config: {} }]);
    check("E5 yes/no is two buttons, and optional means Skip", ynHtml.includes(">Yes</button>") && ynHtml.includes(">No</button>") && ynHtml.includes(">Skip</button>"));
    const oldHtml = draw([{ key: "name", label: "Your name", type: "short_text", required: true }]);
    check("E6 a field with no config (an old stored block) still draws its text box", /<input[^>]*type="text"/.test(oldHtml));
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

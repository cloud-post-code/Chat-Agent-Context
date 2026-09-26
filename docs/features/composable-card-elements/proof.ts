/**
 * Primary proof for composable-card-elements (see PROOF.md).
 * Run: npx tsx docs/features/composable-card-elements/proof.ts
 *
 * Seeds a throwaway tenant with real rows (8 tagged photos + 1 caption-only
 * red photo, 5 priced services across 3 categories, 2 social links, booking
 * enabled — so show_gallery and show_services are offered from the data), drives the real
 * brain's tool loop with a scripted model client (the only doubled
 * boundary), and asserts the filtered/composed cards, the prompt sections,
 * the pure selectors, card memory across turns, and rendered markup.
 *
 * lib/photoIndex.ts, lib/serviceIndex.ts and lib/social.ts do not exist yet
 * (this proof is written red, before Phase 1/2 implementation) — each
 * scenario group that needs one of them is guarded by its own dynamic
 * `await import()` in a try/catch, so a missing module fails only that
 * group's checks instead of crashing the whole run.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement as h } from "react";
import * as cheerio from "cheerio";

(globalThis as { React?: typeof React }).React = React;

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

// Prisma's own `log: ["error"]` writes a "prisma:error" line straight to
// stdout/stderr the moment a query throws — catching the exception
// afterward (e.g. a retry) does not unprint it. The social-links race this
// proof exists to guard against (concurrent getProfile upserts on a
// brand-new tenant, lib/db.ts) showed up exactly this way before the fix:
// every check still passed while a prisma:error line leaked into the run.
// Count every such line on both streams and fail the run if any appear, so
// a regression can't hide behind otherwise-green checks.
let prismaErrorLines = 0;
const origStdoutWrite = process.stdout.write.bind(process.stdout);
const origStderrWrite = process.stderr.write.bind(process.stderr);
function countPrismaErrors(chunk: unknown): void {
  if (typeof chunk === "string" && chunk.includes("prisma:error")) prismaErrorLines++;
  else if (Buffer.isBuffer(chunk) && chunk.includes("prisma:error")) prismaErrorLines++;
}
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  countPrismaErrors(chunk);
  return (origStdoutWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
  countPrismaErrors(chunk);
  return (origStderrWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

/** One scripted model turn: optional text, then tool calls (or none = done). */
type Turn = { text?: string; tools?: { name: string; input: Record<string, unknown> }[] };

/** A ModelClient whose stream() pops the next scripted turn and records what it was called with. */
function scriptedClient(turns: Turn[], seen: { system: string[]; messages: unknown[][]; calls: number; toolNames: string[] }) {
  let i = 0;
  return {
    messages: {
      stream(params: { system?: unknown; messages?: unknown[]; tools?: { name: string }[] }) {
        seen.calls++;
        seen.system.push(String(params.system ?? ""));
        seen.messages.push((params.messages ?? []) as unknown[]);
        seen.toolNames = (params.tools ?? []).map((t) => t.name);
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
}

type Ev = { t: string; v: unknown };
type CardEv = { type: string; [k: string]: unknown };
const cards = (events: Ev[]) => events.filter((e) => e.t === "card").map((e) => e.v as CardEv);
const cardsOf = (events: Ev[], type: string) => cards(events).filter((c) => c.type === type);

async function main() {
  const { prisma } = await import("../../../lib/db");
  const { answer } = await import("../../../lib/brain");
  const { CARD_TOOLS } = await import("../../../lib/canned");
  const { availableCardTools } = await import("../../../lib/cardTools");
  const { saveBookingSettings, saveService } = await import("../../../lib/booking/store");
  const { setBookingEnabled } = await import("../../../lib/appointments");

  // Modules under proof — imported lazily so a red run reports the missing
  // module as a FAIL instead of crashing before any check prints.
  let photoIndex: typeof import("../../../lib/photoIndex") | null = null;
  let serviceIndex: typeof import("../../../lib/serviceIndex") | null = null;
  let social: typeof import("../../../lib/social") | null = null;
  let terms: typeof import("../../../lib/terms") | null = null;
  try { photoIndex = await import("../../../lib/photoIndex"); } catch { /* red */ }
  try { serviceIndex = await import("../../../lib/serviceIndex"); } catch { /* red */ }
  try { social = await import("../../../lib/social"); } catch { /* red */ }
  try { terms = await import("../../../lib/terms"); } catch { /* red */ }
  check("lib/photoIndex.ts exists", photoIndex !== null);
  check("lib/serviceIndex.ts exists", serviceIndex !== null);
  check("lib/social.ts exists", social !== null);
  check("lib/terms.ts exists", terms !== null);

  const user = await prisma.user.create({
    data: {
      email: "proof-composable-cards@example.invalid",
      name: "Proof Composable Cards",
      slug: `proof-composable-cards-${Date.now()}`,
      passwordHash: "",
      onboardedAt: new Date(),
    },
  });

  const run = async (turns: Turn[], history?: unknown[]) => {
    const seen = { system: [] as string[], messages: [] as unknown[][], calls: 0, toolNames: [] as string[] };
    const events: Ev[] = [];
    for await (const e of answer(
      { userId: user.id, message: "scripted", sessionId: `proof-${Date.now()}`, history: history as never },
      { client: scriptedClient(turns, seen) as never },
    )) {
      events.push(e as Ev);
    }
    return { events, seen };
  };
  const show = (name: string, input: Record<string, unknown>): Turn[] => [
    { tools: [{ name, input }] },
    { text: "Here you go." },
  ];

  try {
    // ══ Seed ══════════════════════════════════════════════════════════════
    // Profile.social_links is the real column (prisma/schema.prisma); the
    // row is lazily created by getProfile()'s upsert elsewhere, so update
    // it directly rather than racing a second create.
    const socialLinksJson = JSON.stringify([
      { platform: "instagram", url: "https://instagram.com/x" },
      { platform: "facebook", url: "https://facebook.com/x" },
    ]);
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: { social_links: socialLinksJson },
      create: { userId: user.id, social_links: socialLinksJson },
    });

    const photoTagSets = [
      ["nails", "red", "gel"],
      ["nails", "red", "gel"],
      ["nails", "red", "gel"],
      ["nails", "french"],
      ["nails", "french"],
      ["storefront"],
      ["team"],
      ["pedicure"],
    ];
    const photoIds: string[] = [];
    for (const [i, tags] of photoTagSets.entries()) {
      const p = await prisma.photo.create({
        data: {
          userId: user.id,
          filename: `proof-photo-${i}.jpg`,
          description: `Photo ${i}`,
          caption: `Photo ${i} caption`,
          kind: "gallery",
          order: i,
          tags: JSON.stringify(tags),
        } as never,
      });
      photoIds.push(p.id);
    }
    const captionOnlyRed = await prisma.photo.create({
      data: {
        userId: user.id,
        filename: "proof-photo-caption-red.jpg",
        description: "",
        caption: "red gel nails close-up",
        kind: "gallery",
        order: 8,
        tags: JSON.stringify([]),
      } as never,
    });
    photoIds.push(captionOnlyRed.id);
    const redNailIds = [photoIds[0], photoIds[1], photoIds[2], captionOnlyRed.id];

    await setBookingEnabled(user.id, true);
    await saveBookingSettings(user.id, { timezone: "America/New_York" });
    const svc = async (name: string, amount: number, category: string) => {
      const r = await saveService(user.id, { name, category, pricing: { kind: "fixed", amount }, durationMinutes: 30, enabled: true });
      if (!r.ok) throw new Error(r.error);
      return r.id;
    };
    const gel = await svc("Gel Manicure", 45, "nails");
    const classic = await svc("Classic Manicure", 30, "nails");
    const french = await svc("French Tips", 50, "nails");
    const pedicure = await svc("Pedicure", 55, "feet");
    const browWax = await svc("Brow Wax", 20, "brows");
    const nailsIds = [gel, classic, french];

    // Nothing to curate: show_gallery and show_services are on offer because
    // the tenant has photos and services on file (lib/cardTools.ts).
    const offeredTools = await availableCardTools(user.id);
    check("show_gallery is offered from the photos on file", offeredTools.has("show_gallery"), [...offeredTools].join(","));
    check("show_services is offered from the services on file", offeredTools.has("show_services"), [...offeredTools].join(","));

    // ══ 1. Pure: filterPhotos / tagVocabulary ═══════════════════════════════
    if (photoIndex) {
      const { filterPhotos, tagVocabulary, isEmptyPhotoFilter } = photoIndex;
      const items = [
        { id: "a", src: "/a.jpg", caption: "red gel nails close-up", description: "", tags: [] },
        { id: "b", src: "/b.jpg", caption: "storefront", description: "", tags: ["storefront"] },
        { id: "c", src: "/c.jpg", caption: "french tips", description: "", tags: ["nails", "french"] },
        { id: "d", src: "/d.jpg", caption: "gel set", description: "", tags: ["nails", "red", "gel"] },
      ];
      check("isEmptyPhotoFilter: no ids/tags/query is empty", isEmptyPhotoFilter({}));
      check("isEmptyPhotoFilter: a tag filter is not empty", !isEmptyPhotoFilter({ tags: ["red"] }));
      check(
        "filterPhotos: ids in caller order, unknown dropped",
        filterPhotos(items, { ids: ["c", "zz", "a"] }).map((p) => p.id).join(",") === "c,a",
      );
      check(
        "filterPhotos: tags AND, caption-only match included via meaningfulWords",
        filterPhotos(items, { tags: ["red"] }).map((p) => p.id).sort().join(",") === "a,d",
      );
      check(
        "filterPhotos: query overlap scoring",
        filterPhotos(items, { query: "storefront" }).map((p) => p.id).join(",") === "b",
      );
      check("filterPhotos: empty filter returns all, no limit", filterPhotos(items, {}).length === items.length);
      const limited = filterPhotos(items, { tags: ["nails"], limit: 1 });
      check("filterPhotos: limit only applies with a non-empty filter", limited.length === 1);
      check(
        "tagVocabulary: unique tags by frequency",
        tagVocabulary(items).includes("nails") && tagVocabulary(items).includes("storefront"),
      );
    }

    // ══ 2. Pure: filterServices / similarServices / filterProjects ═════════
    if (serviceIndex) {
      const { filterServices, similarServices, filterProjects, isEmptyServiceFilter } = serviceIndex;
      const svcs = [
        { id: "gel", name: "Gel Manicure", description: "Long-lasting gel polish manicure.", category: "nails", priceAmount: 45 },
        { id: "classic", name: "Classic Manicure", description: "Traditional polish manicure.", category: "nails", priceAmount: 30 },
        { id: "french", name: "French Tips", description: "Manicure with french tip style.", category: "nails", priceAmount: 50 },
        { id: "pedi", name: "Pedicure", description: "Foot and toenail care treatment.", category: "feet", priceAmount: 55 },
        { id: "brow", name: "Brow Wax", description: "Eyebrow shaping with hot wax.", category: "brows", priceAmount: 20 },
      ];
      check("isEmptyServiceFilter: no ids/category/query is empty", isEmptyServiceFilter({}));
      check("filterServices: empty filter returns all, no limit", filterServices(svcs, {}).length === svcs.length);
      check(
        "filterServices: category case-insensitive exact",
        filterServices(svcs, { category: "NAILS" }).map((s) => s.id).sort().join(",") === "classic,french,gel",
      );
      check(
        "filterServices: ids ordered, unknown dropped",
        filterServices(svcs, { ids: ["pedi", "zz", "gel"] }).map((s) => s.id).join(",") === "pedi,gel",
      );
      const near = similarServices(svcs, [svcs[0]], 2);
      check(
        "similarServices: excludes focus, prefers same category",
        !near.items.some((s) => s.id === "gel") && near.items.every((s) => s.category === "nails"),
        JSON.stringify(near),
      );
      // No shared category/terms at all: never empty, falls back to catalog order.
      const noCatalogInfo = [
        { id: "x1", name: "Alpha", description: "", priceAmount: null },
        { id: "x2", name: "Beta", description: "", priceAmount: null },
        { id: "x3", name: "Gamma", description: "", priceAmount: null },
      ];
      const fallback = similarServices(noCatalogInfo, [noCatalogInfo[0]], 2);
      check(
        "similarServices: never empty even with zero score overlap",
        fallback.items.length === 2 && !fallback.close,
        JSON.stringify(fallback),
      );
      const projects = [
        { id: "p1", name: "Alpha", blurb: "red project", tags: ["red"] },
        { id: "p2", name: "Beta", blurb: "blue project", tags: ["blue"] },
      ];
      check(
        "filterProjects: tag filter",
        filterProjects(projects, { tags: ["red"] }).map((p) => p.id).join(",") === "p1",
      );
    }

    // ══ 3. System prompt sections ════════════════════════════════════════
    {
      const { buildSystemPrompt } = await import("../../../lib/knowledge");
      const system = await buildSystemPrompt(user.id);
      check("system prompt has a PHOTO INDEX section (photos on file put show_gallery on offer)", /PHOTO INDEX/.test(system), system.slice(0, 200));
      check("PHOTO INDEX carries tags", /nails/.test(system) && /red/.test(system));
      check("system prompt has a SERVICE INDEX section (services on file + booking on)", /SERVICE INDEX/.test(system));
      check("SERVICE INDEX carries prices", /45|\$45/.test(system));
      check("system prompt has a COMPOSING CARDS section", /COMPOSING CARDS/i.test(system));
      check("system prompt explains the [shown: …] history marker", /\[shown:/.test(system));

      const bare = await prisma.user.create({
        data: { email: `proof-composable-cards-bare-${Date.now()}@example.invalid`, name: "Bare", slug: `proof-bare-${Date.now()}`, passwordHash: "", onboardedAt: new Date() },
      });
      try {
        const bareSystem = await buildSystemPrompt(bare.id);
        check("no PHOTO INDEX for a tenant with no photos (show_gallery not offered)", !/PHOTO INDEX/.test(bareSystem));
      } finally {
        await prisma.user.delete({ where: { id: bare.id } }).catch(() => {});
      }
    }

    // ══ 1/4. show_gallery filtering (Scenario 1: "pictures of nails") ═══════
    {
      // Exact expected set, computed from the fixture rather than hardcoded:
      // every photo tagged "nails" (the 3 red-gel + 2 french, photoIds[0..4])
      // plus the caption-only "red gel nails close-up" photo, which carries no
      // tags at all and matches only through its caption words. All 9 fixture
      // photos are the superset, so this must be a strict subset of that.
      const nailPhotoIds = [...photoIds.slice(0, 5), captionOnlyRed.id];
      check("nail photo fixture set is a strict subset of all 9 photos", nailPhotoIds.length < photoIds.length);

      const nailsTagRun = await run(show("show_gallery", { layout: "filmstrip", tags: ["nails"] }));
      const nailsTagCard = cardsOf(nailsTagRun.events, "gallery")[0] as { items?: { id: string }[] } | undefined;
      check(
        "show_gallery tags:[nails] yields exactly the nail-photo fixture set",
        JSON.stringify((nailsTagCard?.items ?? []).map((i) => i.id).sort()) === JSON.stringify([...nailPhotoIds].sort()),
        JSON.stringify(nailsTagCard),
      );

      const nailsQueryRun = await run(show("show_gallery", { layout: "filmstrip", query: "nails" }));
      const nailsQueryCard = cardsOf(nailsQueryRun.events, "gallery")[0] as { items?: { id: string }[] } | undefined;
      check(
        "show_gallery query:nails yields exactly the same nail-photo fixture set",
        JSON.stringify((nailsQueryCard?.items ?? []).map((i) => i.id).sort()) === JSON.stringify([...nailPhotoIds].sort()),
        JSON.stringify(nailsQueryCard),
      );

      const redRun = await run(show("show_gallery", { layout: "carousel", tags: ["nails", "red"] }));
      const g = cardsOf(redRun.events, "gallery")[0] as { items?: { id: string }[]; title?: string } | undefined;
      check(
        "show_gallery tags:[nails,red] yields exactly the four red nail photos",
        JSON.stringify((g?.items ?? []).map((i) => i.id).sort()) === JSON.stringify([...redNailIds].sort()),
        JSON.stringify(g),
      );
      check("gallery card carries a title", !!g?.title);

      const storeRun = await run(show("show_gallery", { layout: "carousel", query: "storefront" }));
      const g2 = cardsOf(storeRun.events, "gallery")[0] as { items?: { id: string }[] } | undefined;
      check("show_gallery query:storefront yields one photo", (g2?.items ?? []).length === 1, JSON.stringify(g2));

      const noneRun = await run(show("show_gallery", { layout: "carousel", tags: ["blue"] }));
      check("show_gallery tags:[blue] yields no gallery card", cardsOf(noneRun.events, "gallery").length === 0);
      const lastToolResult = JSON.stringify(noneRun.seen.messages.slice(-1));
      check(
        "no-match tool result names the tag vocabulary",
        /nails|storefront|team|pedicure/i.test(lastToolResult),
        lastToolResult.slice(0, 200),
      );
    }

    // ══ 8. Canned/no-filter gallery still returns everything, zero model calls ══
    {
      const { hydrate } = await import("../../../lib/brain").catch(() => ({ hydrate: null as unknown as (...a: unknown[]) => Promise<unknown> }));
      if (hydrate) {
        const result = (await hydrate(user.id, "show_gallery", { layout: "carousel" })) as { block?: { items?: unknown[] } } | null;
        check(
          "canned show_gallery with no filter renders all 8+1 fixture photos",
          (result?.block?.items ?? []).length === photoIds.length,
          String(result?.block?.items?.length),
        );
      } else {
        check("lib/brain.ts exports hydrate()", false, "hydrate not exported yet");
      }
    }

    // ══ 5. show_services with similar ═══════════════════════════════════════
    {
      const similarRun = await run(show("show_services", { ids: [gel], similar: 2 }));
      const s = cardsOf(similarRun.events, "services")[0] as
        | { focusIds?: string[]; items?: { id: string }[]; booking?: { flow?: { services?: { id: string }[] } } | null }
        | undefined;
      check("show_services focusIds is exactly the gel id", JSON.stringify(s?.focusIds) === JSON.stringify([gel]), JSON.stringify(s?.focusIds));
      const ids = (s?.items ?? []).map((i) => i.id);
      check(
        "show_services items are gel + two nails services, no other category",
        ids.includes(gel) && ids.length === 3 && ids.every((id) => nailsIds.includes(id)),
        JSON.stringify(ids),
      );
      check("similar services never spill into feet/brows categories", !ids.includes(pedicure) && !ids.includes(browWax));
    }

    // ══ 6. Card memory ══════════════════════════════════════════════════════
    // (show_booking's own narrowing was retired when booking became a
    // conversation of cards — the wizard it narrowed no longer exists.)
    {
      const redRun2 = await run(show("show_gallery", { layout: "carousel", tags: ["red"] }));
      const shownIds = (cardsOf(redRun2.events, "gallery")[0] as { items?: { id: string }[] } | undefined)?.items?.map((i) => i.id) ?? [];
      const history = [
        { role: "user", content: "red nails" },
        { role: "assistant", content: "Here are the red ones.", shown: [{ type: "gallery", ids: shownIds, tags: ["red"] }] },
      ];
      const bookRun = await run(show("show_booking", {}), history);
      const historyPayload = JSON.stringify(bookRun.seen.messages);
      check(
        "the messages the client received carry the folded shown marker",
        historyPayload.includes("[shown: gallery ids="),
        historyPayload.slice(0, 300),
      );
      const b = cardsOf(bookRun.events, "booking")[0] as { flow?: { services?: unknown[] } } | undefined;
      check("show_booking draws the full booking block", (b?.flow?.services ?? []).length >= 5, JSON.stringify(b).slice(0, 200));
    }

    // ══ 7. show_social ═══════════════════════════════════════════════════════
    {
      const igRun = await run(show("show_social", { platforms: ["instagram"] }));
      check("show_social is offered from the profile's links, gated on data like the rest", igRun.seen.toolNames.includes("show_social"), igRun.seen.toolNames.join(","));
      const soc = cardsOf(igRun.events, "social")[0] as { items?: { platform: string; url: string }[] } | undefined;
      check("show_social platforms:[instagram] yields exactly the instagram link", (soc?.items ?? []).length === 1 && soc?.items?.[0]?.platform === "instagram", JSON.stringify(soc));

      const aliasRun = await run(show("show_social", { platforms: ["ig"] }));
      const socAlias = cardsOf(aliasRun.events, "social")[0] as { items?: { platform: string }[] } | undefined;
      check("show_social platforms:[ig] normalizes to instagram", socAlias?.items?.[0]?.platform === "instagram", JSON.stringify(socAlias));

      const tiktokRun = await run(show("show_social", { platforms: ["tiktok"] }));
      check("show_social platforms:[tiktok] yields no card", cardsOf(tiktokRun.events, "social").length === 0);

      const noLinksUser = await prisma.user.create({
        data: { email: `proof-composable-cards-nolinks-${Date.now()}@example.invalid`, name: "No Links", slug: `proof-nolinks-${Date.now()}`, passwordHash: "", onboardedAt: new Date() },
      });
      try {
        const seenNoLinks = { system: [] as string[], messages: [] as unknown[][], calls: 0, toolNames: [] as string[] };
        const events: Ev[] = [];
        for await (const e of answer(
          { userId: noLinksUser.id, message: "scripted", sessionId: `proof-${Date.now()}` },
          { client: scriptedClient(show("show_social", {}), seenNoLinks) as never },
        )) events.push(e as Ev);
        // Assert the scripted client was actually invoked first — otherwise a
        // canned-answer short-circuit that never reaches runModel would leave
        // toolNames === [] and this check would pass vacuously, proving
        // nothing about the gate it claims to test.
        check("the scripted client was actually called for the no-links check", seenNoLinks.calls > 0, `calls=${seenNoLinks.calls}`);
        check("show_social is NOT offered to a profile with no social links", !seenNoLinks.toolNames.includes("show_social"), seenNoLinks.toolNames.join(","));
      } finally {
        await prisma.user.delete({ where: { id: noLinksUser.id } }).catch(() => {});
      }
    }

    // ══ 9. Rendering: Cards via react-dom/server + cheerio ═══════════════════
    {
      const CardsMod = await import("../../../app/cards/Cards").catch(() => null);
      const { renderToStaticMarkup } = await import("react-dom/server");
      if (CardsMod) {
        const Cards = (CardsMod as { Cards?: unknown; default?: unknown }).Cards ?? (CardsMod as { default: unknown }).default;
        // Each render is its own try/catch: a crash in one block's renderer
        // (a shape the current Cards.tsx doesn't yet handle) must fail only
        // that check, not abort every later assertion in the script.
        try {
          const threePhotoBlock = {
            type: "gallery",
            layout: "carousel",
            title: "Red nails",
            items: redNailIds.slice(0, 3).map((id) => ({ id, src: `/api/uploads/${id}.jpg`, description: "", caption: "" })),
          };
          const galleryHtml = renderToStaticMarkup(h(Cards as never, { block: threePhotoBlock } as never));
          const $g = cheerio.load(galleryHtml);
          check("3-photo gallery renders 3 images", $g("img").length === 3, String($g("img").length));
          check("3-photo gallery has no carousel controls", $g("[class*=carousel-control],[aria-label*=Next],[aria-label*=Previous]").length === 0);
        } catch (e) {
          check("3-photo gallery renders 3 images", false, String(e));
          check("3-photo gallery has no carousel controls", false, String(e));
        }

        try {
          const servicesBlockSample = {
            type: "services",
            title: "Gel Manicure",
            focusIds: [gel],
            items: [
              { id: gel, name: "Gel Manicure", description: "", priceLabel: "$45" },
              { id: classic, name: "Classic Manicure", description: "", priceLabel: "$30" },
            ],
            booking: null,
          };
          const servicesHtml = renderToStaticMarkup(h(Cards as never, { block: servicesBlockSample } as never));
          check("services card with focusIds renders a Similar label", /Similar/i.test(servicesHtml), servicesHtml.slice(0, 300));
        } catch (e) {
          check("services card with focusIds renders a Similar label", false, String(e));
        }

        try {
          const socialBlockSample = { type: "social", items: [{ platform: "instagram", url: "https://instagram.com/x" }] };
          const socialHtml = renderToStaticMarkup(h(Cards as never, { block: socialBlockSample } as never));
          check("social card renders one button with the instagram URL", socialHtml.includes("https://instagram.com/x"), socialHtml.slice(0, 300));
        } catch (e) {
          check("social card renders one button with the instagram URL", false, String(e));
        }

      } else {
        check("app/cards/Cards.tsx exports a Cards component", false, "module not found");
      }
    }
  } finally {
    await prisma.photo.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.service.deleteMany({ where: { userId: user.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }

  // Checked last, after cleanup, so a race anywhere in the run — including
  // the seed or the finally block's own deletes — is caught, not just the
  // scenarios above.
  check("no prisma:error lines logged during the run", prismaErrorLines === 0, `prismaErrorLines=${prismaErrorLines}`);

  process.stdout.write = origStdoutWrite;
  process.stderr.write = origStderrWrite;

  console.log(`failures: ${failures}`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

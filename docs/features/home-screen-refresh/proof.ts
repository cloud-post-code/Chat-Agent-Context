/**
 * Primary proof for home-screen-refresh (see PROOF.md).
 * Run: npx tsx docs/features/home-screen-refresh/proof.ts
 *
 * homePhotos runs for real against the database, and the home screen is the
 * real app/Chat.tsx rendered on the server. Photo filenames are random per
 * run, so the strip assertions cannot be met by hardcoded markup.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";

// The app components are compiled by Next with the automatic JSX runtime;
// tsx compiles them with the classic one, which expects `React` in scope.
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

const PREFIX = "homerefreshproof";
const COMPANY = "Moonlight Nails and Spa";
const TAGLINE = "Quiet hands, bright colors.";
const FOOTNOTE = `An AI host answers as ${COMPANY}, using only what they&#x27;ve shared.`;

type HomePhoto = { src: string; alt: string };

async function main() {
  const { prisma } = await import("../../../lib/db");
  const cards = (await import("../../../lib/cards")) as unknown as {
    homePhotos?: (userId: string, limit?: number) => Promise<HomePhoto[]>;
  };
  const { renderToStaticMarkup } = await import("react-dom/server");
  const Chat = (await import("../../../app/Chat")).default as React.ComponentType<
    Record<string, unknown>
  >;

  const baseUsers = await prisma.user.count();
  const basePhotos = await prisma.photo.count();
  const run = randomBytes(4).toString("hex");

  async function makeUser(tag: string) {
    const id = `${PREFIX}-${tag}`;
    await prisma.user.create({
      data: { id, email: `${id}@example.test`, name: `Proof ${tag}`, slug: id, passwordHash: "x" },
    });
    return id;
  }

  function render(props: Record<string, unknown>) {
    return renderToStaticMarkup(
      React.createElement(Chat, { name: COMPANY, tagline: TAGLINE, starters: [], slug: "proof", ...props }),
    );
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } });
  }
  await cleanup();

  try {
    // ── homePhotos ──────────────────────────────────────────────────────────
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    // Inserted out of order on purpose; `order` decides the strip sequence.
    const curated = [2, 0, 1].map((order) => ({
      userId: owner,
      filename: `${run}-g${order}.jpg`,
      caption: `Gallery ${order}`,
      kind: order === 1 ? "project" : "gallery",
      order,
    }));
    await prisma.photo.createMany({
      data: [
        ...curated,
        { userId: owner, filename: `${run}-ingest.jpg`, kind: "ingest:menu", order: 3 },
        { userId: owner, filename: `${run}-profile.jpg`, kind: "profile", order: 4 },
        { userId: other, filename: `${run}-other.jpg`, kind: "gallery", order: 0 },
      ],
    });

    check("lib/cards exports homePhotos", typeof cards.homePhotos === "function");
    const homePhotos = cards.homePhotos ?? (async () => [] as HomePhoto[]);

    const photos = await homePhotos(owner);
    check(
      "homePhotos returns the curated photos in order, as upload URLs",
      photos.map((p) => p.src).join("|") ===
        [0, 1, 2].map((o) => `/api/uploads/${run}-g${o}.jpg`).join("|"),
      JSON.stringify(photos),
    );
    check(
      "homePhotos excludes ingest:*, profile and other tenants' photos",
      !photos.some((p) => /ingest|profile|other/.test(p.src)),
      JSON.stringify(photos),
    );
    check("homePhotos carries the caption as alt text", photos[0]?.alt === "Gallery 0", photos[0]?.alt);
    check("homePhotos respects its limit", (await homePhotos(owner, 2)).length === 2);

    await prisma.photo.createMany({
      data: Array.from({ length: 15 }, (_, i) => ({
        userId: owner,
        filename: `${run}-extra${i}.jpg`,
        kind: "gallery",
        order: 10 + i,
      })),
    });
    const capped = (await homePhotos(owner)).length;
    check("homePhotos defaults to at most 12", capped === 12, `got=${capped}`);

    // ── Home screen with photos and a logo ──────────────────────────────────
    const logo = `/api/uploads/${run}-logo.png`;
    const full = render({ photos, logo });
    const h1 = full.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "";
    check("the <h1> is the company name alone", h1 === COMPANY, `h1=${h1}`);
    check("the accent line reads 'Ask me anything.'", full.includes("Ask me anything."));
    check(
      "the old greeting is gone",
      !full.includes("Hey, I") && !full.includes("Talk to me"),
    );
    check("the logo renders on the home screen", full.includes(`src="${logo}"`));
    check(
      "every photo is in the strip",
      full.includes('data-home-strip="photos"') && photos.every((p) => full.includes(`src="${p.src}"`)),
    );
    check("the tagline renders", full.includes(TAGLINE));
    check("the footnote is the one-line version", full.includes(FOOTNOTE));
    check(
      "the long footnote is gone",
      !full.includes("This whole page is a conversation"),
    );
    check("the composer placeholder changed", full.includes('placeholder="Type your question…"'));
    const rises = (full.match(/class="[^"]*home-rise/g) ?? []).length;
    check("title, composer and strip rise in", rises >= 3, `home-rise elements=${rises}`);

    // ── Home screen with nothing: no logo, no photos, no tagline ────────────
    const bare = render({ tagline: "" });
    check("no photos renders the glow band", bare.includes('data-home-strip="glow"'));
    check("no photos and no logo renders no <img>", !bare.includes("<img"));
    check("the initial badge stands in for the logo", bare.includes(">M</div>"));
    // The footnote is the only other paragraph on the home screen.
    const bareParagraphs = (bare.match(/<p[\s>]/g) ?? []).length;
    check("an empty tagline renders no paragraph", bareParagraphs === 1, `<p> count=${bareParagraphs}`);
    check("omitting the photos prop does not crash", bare.length > 0);

    // ── CSS and mirrors ─────────────────────────────────────────────────────
    const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
    check("globals.css defines .home-rise", /\.home-rise\s*\{[^}]*animation:/.test(css));
    check(
      "home-rise is disabled under prefers-reduced-motion",
      /prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.home-rise\s*\{[^}]*animation:\s*none/.test(css),
    );
    const og = readFileSync(path.join(root, "app/opengraph-image.tsx"), "utf8");
    check(
      "the OG image uses the new title text",
      og.includes('"Ask me anything."') && !og.includes("Talk to me") && !og.includes("Hey, I"),
    );
    const picker = readFileSync(path.join(root, "app/admin/ThemePicker.tsx"), "utf8");
    check("the admin theme preview dropped 'Talk to me.'", !picker.includes("Talk to me"));
    const page = readFileSync(path.join(root, "app/a/[slug]/page.tsx"), "utf8");
    check("the agent page passes photos to Chat", /homePhotos\(/.test(page) && /photos=\{/.test(page));
  } finally {
    await cleanup();
  }

  check("users cleaned up", (await prisma.user.count()) === baseUsers);
  check("photos cleaned up", (await prisma.photo.count()) === basePhotos);

  await prisma.$disconnect();
  if (failures) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll proof assertions passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

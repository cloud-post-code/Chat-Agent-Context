/**
 * Primary proof for unified-ingested-items (see PROOF.md).
 * Run: npx tsx docs/features/unified-ingested-items/proof.ts
 *
 * Local dev Postgres only, no model calls. Seeded rows carry `proof-uni-`
 * markers and are deleted in a finally.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

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

const M = "proof-uni";

async function main() {
  const { listIngestedItems } = await import("@/lib/ingestedItems");
  const { prisma } = await import("@/lib/db");

  try {
    // Seed one row of each flavor.
    await prisma.source.createMany({
      data: [
        { type: "link", url: `https://example.com/${M}`, title: `${M}-link`, rawText: "L", status: "scanned" },
        { type: "pdf", filename: `${M}.pdf`, title: `${M}-pdf`, rawText: "P", status: "scanned" },
        { type: "text", title: `${M}-text`, rawText: "T", status: "scanned" },
        { type: "text", kind: `ingest:${M}-custom`, title: `${M}-custom-note`, rawText: "C", status: "scanned" },
      ],
    });
    const photo = await prisma.photo.create({
      data: { filename: "00000000-0000-0000-0000-000000000000.png", description: `${M} photo desc`, caption: `${M}-photo`, kind: "gallery" },
    });
    const customPhoto = await prisma.photo.create({
      data: { filename: "00000000-0000-0000-0000-000000000001.png", description: `${M} custom photo`, caption: `${M}-cphoto`, kind: `ingest:${M}-custom` },
    });
    const project = await prisma.project.create({
      data: { name: `${M}-project`, blurb: "b", detail: "d", imageUrl: "/api/uploads/x.png", tags: "[]" },
    });

    // 1. Uniform shape everywhere.
    const keys = ["experience", "projects", "links", "pdfs", "text", "photos", "persona", `${M}-custom`];
    let uniform = true;
    for (const k of keys) {
      for (const it of await listIngestedItems(k)) {
        const okKind = it.kind === "text" || it.kind === "image";
        const okInv = (it.kind === "image") === (it.imageUrl !== null);
        if (!okKind || !okInv) {
          uniform = false;
          console.error(`    bad item from ${k}: ${JSON.stringify(it)}`);
        }
      }
    }
    check("every item is text or image, imageUrl iff image", uniform);

    // 2. links: only link rows.
    const links = await listIngestedItems("links");
    check(
      "links has the link row and no pdf/text/custom rows",
      links.some((i) => i.title === `${M}-link`) &&
        !links.some((i) => [`${M}-pdf`, `${M}-text`, `${M}-custom-note`].includes(i.title)),
    );

    // 3. pdfs and text.
    const pdfs = await listIngestedItems("pdfs");
    check("pdfs has the pdf row", pdfs.some((i) => i.title === `${M}-pdf`));
    const texts = await listIngestedItems("text");
    check(
      "text has the pasted row and excludes ingest:* rows",
      texts.some((i) => i.title === `${M}-text`) && !texts.some((i) => i.title === `${M}-custom-note`),
    );

    // 4. photos are image items with the description as text.
    const photos = await listIngestedItems("photos");
    const p = photos.find((i) => i.id === `photo:${photo.id}`);
    check(
      "photo is an image item with description text and uploads url",
      !!p && p.kind === "image" && p.text === `${M} photo desc` && !!p.imageUrl?.startsWith("/api/uploads/"),
      JSON.stringify(p),
    );
    check("builtin photos exclude custom-marked photos", !photos.some((i) => i.id === `photo:${customPhoto.id}`));

    // 5. projects yield text + image items.
    const projItems = await listIngestedItems("projects");
    check(
      "project yields a text item and an image item",
      projItems.some((i) => i.id === `project:${project.id}` && i.kind === "text") &&
        projItems.some((i) => i.id === `project-image:${project.id}` && i.kind === "image"),
    );

    // 6. custom key returns exactly its own marked rows.
    const custom = await listIngestedItems(`${M}-custom`);
    check(
      "custom key returns its marked text and image rows only",
      custom.length === 2 &&
        custom.some((i) => i.kind === "text" && i.title === `${M}-custom-note`) &&
        custom.some((i) => i.kind === "image" && i.id === `photo:${customPhoto.id}`),
      JSON.stringify(custom.map((i) => i.id)),
    );

    // 7. Malformed experience JSON degrades to empty.
  } finally {
    const { prisma } = await import("@/lib/db");
    await prisma.source.deleteMany({ where: { title: { startsWith: M } } }).catch(() => {});
    await prisma.photo.deleteMany({ where: { caption: { startsWith: M } } }).catch(() => {});
    await prisma.project.deleteMany({ where: { name: { startsWith: M } } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(failures ? `\n${failures} assertion(s) failed` : "\nAll assertions passed");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("Proof crashed:", err);
  process.exit(1);
});

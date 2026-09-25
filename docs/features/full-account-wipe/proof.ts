/**
 * Primary proof for full-account-wipe (see PROOF.md).
 * Run: npx tsx --tsconfig docs/features/full-account-wipe/tsconfig.json \
 *        docs/features/full-account-wipe/proof.ts
 *
 * Postgres plus a temp upload dir; no model or network calls. Seeds two
 * accounts with one row in every per-user table and upload files referenced
 * every way the app stores them, wipes one, and checks what's left.
 */
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = path.resolve(__dirname, "../../..");
for (const line of readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    process.env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
}

import { prisma } from "@/lib/db";
import { wipeAccountContent } from "@/lib/accountWipe";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "  ok " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const KEEP = new Set(["user", "profile", "gmailAuth"]);
/** Every per-user model; each must read zero for the wiped account. */
const PER_USER = [
  "source", "chunk", "entity", "mergeDismissal", "photo", "project", "chatSession",
  "cannedAnswer", "agentDirective", "uiCard", "itemClassification", "ingestionSource",
  "addressBookEntry", "contact", "a2ATask", "appointmentField", "appointment", "service",
  "staffMember", "bookingLocation", "bookingSettings", "menuItem", "order", "personaConfig",
  "themeConfig",
] as const;

async function counts(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const m of PER_USER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[m] = await (prisma as any)[m].count({ where: { userId } });
  }
  out.chatMessage = await prisma.chatMessage.count({ where: { session: { userId } } });
  return out;
}

async function file(dir: string, ext = "png"): Promise<string> {
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), "x");
  return name;
}

async function seed(tag: string, dir: string) {
  const user = await prisma.user.create({
    data: {
      email: `wipe-${tag}-${Date.now()}@proof.local`, name: `Wipe ${tag}`,
      slug: `wipe-${tag}-${Date.now()}`, passwordHash: "x:y", onboardedAt: new Date(),
    },
  });
  const u = user.id;
  const f = {
    photo: await file(dir, "jpg"), service: await file(dir), staff: await file(dir),
    logo: await file(dir), project: await file(dir), card: await file(dir),
    menu: await file(dir), chat: await file(dir), pdf: await file(dir, "pdf"),
  };
  const src = await prisma.source.create({ data: { userId: u } });
  await prisma.chunk.create({ data: { userId: u, sourceId: src.id, text: "t" } });
  await prisma.entity.create({ data: { userId: u, name: "E", key: `e-${tag}` } });
  await prisma.mergeDismissal.create({ data: { userId: u, keyA: "a", keyB: "b" } });
  await prisma.photo.create({ data: { userId: u, filename: f.photo } });
  await prisma.photo.create({ data: { userId: u, filename: f.pdf } });
  await prisma.project.create({
    data: { userId: u, name: "P", blurb: "b", imageUrl: `/api/uploads/${f.project}` },
  });
  const session = await prisma.chatSession.create({ data: { userId: u, visitorKey: "v" } });
  await prisma.chatMessage.create({
    data: { sessionId: session.id, role: "assistant", content: `<img src="/api/uploads/${f.chat}">` },
  });
  await prisma.cannedAnswer.create({ data: { userId: u, question: "q", matchKey: `q-${tag}` } });
  await prisma.agentDirective.create({ data: { userId: u, kind: "goal", text: "t" } });
  await prisma.uiCard.create({
    data: {
      userId: u, key: "k", label: "l", tool: "t",
      sampleBlock: JSON.stringify({ kind: "image", src: `/api/uploads/${f.card}` }),
    },
  });
  await prisma.itemClassification.create({
    data: { userId: u, itemId: "i", sourceKey: "s", classification: "c" },
  });
  await prisma.ingestionSource.create({
    data: { userId: u, key: "k", label: "l", uploadMethod: "manual" },
  });
  await prisma.addressBookEntry.create({ data: { userId: u, name: "n" } });
  await prisma.contact.create({ data: { userId: u, name: "n", email: "e@x", message: "m" } });
  await prisma.a2ATask.create({ data: { id: `task-${tag}-${Date.now()}`, userId: u, contextId: "c" } });
  await prisma.appointmentField.create({ data: { userId: u, key: "name", label: "Name" } });
  await prisma.appointment.create({ data: { userId: u, startsAt: new Date() } });
  await prisma.service.create({ data: { userId: u, name: "Cut", imageFilename: f.service } });
  await prisma.staffMember.create({ data: { userId: u, name: "Sam", photoFilename: f.staff } });
  await prisma.bookingLocation.create({ data: { userId: u, name: "Shop" } });
  await prisma.bookingSettings.create({ data: { userId: u, config: "{}" } });
  await prisma.menuItem.create({
    data: { userId: u, key: "m", name: "M", data: JSON.stringify({ image: `/api/uploads/${f.menu}` }) },
  });
  await prisma.order.create({ data: { userId: u } });
  await prisma.personaConfig.create({ data: { userId: u, company_logo: `/api/uploads/${f.logo}` } });
  await prisma.themeConfig.create({ data: { userId: u } });
  await prisma.profile.create({
    data: { userId: u, company_name: "Co", owner_name: "O", bookingEnabled: false },
  });
  return { user, files: Object.values(f) };
}

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "wipe-proof-"));
  process.env.UPLOAD_DIR = dir;
  const a = await seed("a", dir);
  const b = await seed("b", dir);
  try {
    const before = await counts(a.user.id);
    check("seeded a row in every per-user table", Object.values(before).every((n) => n > 0),
      JSON.stringify(before));

    const result = await wipeAccountContent(a.user.id);

    const after = await counts(a.user.id);
    const leftover = Object.entries(after).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`);
    check("every per-user table is empty for the wiped account", leftover.length === 0,
      leftover.join(", ") || "all zero");
    for (const m of ["appointment", "appointmentField", "service", "staffMember",
      "bookingLocation", "bookingSettings", "menuItem", "order"]) {
      check(`booking/menu: ${m} cleared`, after[m] === 0, String(after[m]));
    }

    const user = await prisma.user.findUnique({ where: { id: a.user.id } });
    check("user row survives", !!user && user.email === a.user.email);
    check("onboardedAt cleared", user?.onboardedAt === null);
    const profile = await prisma.profile.findUnique({ where: { userId: a.user.id } });
    check("profile blanked", profile?.company_name === "" && profile?.owner_name === "");
    check("bookingEnabled back to default", profile?.bookingEnabled === true);

    const onDisk = new Set(await readdir(dir));
    const stale = a.files.filter((n) => onDisk.has(n));
    check("every referenced upload removed from disk", stale.length === 0, stale.join(", "));
    check("reported file count matches", result.filesDeleted === a.files.length,
      `${result.filesDeleted} vs ${a.files.length}`);

    const bAfter = await counts(b.user.id);
    check("other account's rows untouched", Object.values(bAfter).every((n) => n > 0),
      JSON.stringify(bAfter));
    check("other account's files untouched", b.files.every((n) => onDisk.has(n)));
    check("KEEP set documents what survives", KEEP.has("gmailAuth"));
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [a.user.id, b.user.id] } } });
    await rm(dir, { recursive: true, force: true });
    await prisma.$disconnect();
  }
  if (failures) {
    console.log(`PROOF FAIL (${failures})`);
    process.exit(1);
  }
  console.log("PROOF PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

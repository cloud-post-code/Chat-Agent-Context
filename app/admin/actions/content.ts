"use server";

import { prisma } from "@/lib/db";
import { extractLink, extractDocument, extractText } from "@/lib/scrape";
import { dropOrigin } from "@/lib/retrieval/indexer";
import { indexProject, indexPhoto } from "@/lib/retrieval/origins";
import { saveUpload, saveBytes } from "@/lib/uploads";
import { describeAndTagImage } from "@/lib/vision";
import path from "node:path";
import { requireUser, indexScanned, reindex, isUpload, revalidateAll, err, toData } from "./_shared";

// ── Sources (unified extraction: link / pdf / text) ──
export async function addSource(formData: FormData) {
  const user = await requireUser();
  const type = String(formData.get("type") ?? "link");

  if (type === "link") {
    const url = String(formData.get("url") ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    const src = await prisma.source.upsert({
      where: { userId_url: { userId: user.id, url } },
      update: { status: "pending", error: null, type: "link" },
      create: { userId: user.id, url, type: "link", status: "pending" },
    });
    try {
      const r = await extractLink(url);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(user.id, src.id);
    } catch (e) {
      await prisma.source.update({
        where: { id: src.id },
        data: { status: "failed", error: err(e) },
      });
    }
  } else if (type === "pdf" || type === "doc") {
    const file = formData.get("file");
    if (!isUpload(file) || file.size === 0) return;
    const bytes = Buffer.from(await file.arrayBuffer());
    const isWord = /\.docx$/i.test(file.name);
    const src = await prisma.source.create({
      data: {
        userId: user.id,
        type: isWord ? "doc" : "pdf",
        filename: file.name,
        status: "pending",
      },
    });
    try {
      const r = await extractDocument(bytes, file.name);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(user.id, src.id);
    } catch (e) {
      await prisma.source.update({
        where: { id: src.id },
        data: { status: "failed", error: err(e) },
      });
    }
  } else if (type === "text") {
    const text = String(formData.get("text") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim() || null;
    if (text.length < 2) return;
    const src = await prisma.source.create({
      data: { userId: user.id, type: "text", title, status: "pending" },
    });
    try {
      const r = await extractText(text, title);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(user.id, src.id);
    } catch (e) {
      await prisma.source.update({
        where: { id: src.id },
        data: { status: "failed", error: err(e) },
      });
    }
  }
  revalidateAll();
}

export async function rescanSource(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const src = await prisma.source.findFirst({ where: { id, userId: user.id } });
  if (!src || src.type !== "link" || !src.url) return;
  try {
    const r = await extractLink(src.url);
    await prisma.source.update({
      where: { id: src.id },
      data: { ...toData(r), status: "scanned", error: null },
    });
    await indexScanned(user.id, src.id);
  } catch (e) {
    await prisma.source.update({ where: { id: src.id }, data: { status: "failed", error: err(e) } });
  }
  revalidateAll();
}

export async function updateSourceSummary(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const updated = await prisma.source.updateMany({
    where: { id, userId: user.id },
    data: { summary: String(formData.get("summary") ?? ""), status: "scanned" },
  });
  if (updated.count === 0) return;
  // Re-index: for summary-only sources the summary IS the chunked content.
  await indexScanned(user.id, id);
  revalidateAll();
}

export async function deleteSource(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.source.deleteMany({ where: { id, userId: user.id } }).catch(() => {});
  // Chunks cascade off the Source row, but the entities and relations extracted
  // from it don't — dropOrigin retracts those too.
  if (id) await reindex(`source ${id}`, () => dropOrigin(user.id, "source", id));
  revalidateAll();
}

// ── Projects (github + live links) ──
export async function addProject(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  let blurb = String(formData.get("blurb") ?? "").trim();
  const githubUrl = String(formData.get("githubUrl") ?? "").trim() || null;
  const liveUrl = String(formData.get("liveUrl") ?? "").trim() || null;
  if (!name) return;

  // Auto-generate the short description from the GitHub/Live URL when the
  // admin left it blank. Scrape the page + summarize into one line.
  if (!blurb) {
    const src = liveUrl || githubUrl;
    if (src) {
      try {
        const r = await extractLink(src);
        blurb =
          (r.summary || "").split(/(?<=\.)\s/)[0]?.slice(0, 200).trim() ||
          `${name} — see the link.`;
      } catch {
        blurb = `${name} — see the link.`;
      }
    } else {
      blurb = name;
    }
  }

  let imageUrl: string | null = null;
  const file = formData.get("image");
  if (isUpload(file) && file.size > 0) {
    imageUrl = `/api/uploads/${await saveUpload(file)}`;
  }

  const created = await prisma.project.create({
    data: {
      userId: user.id,
      name,
      blurb,
      githubUrl,
      liveUrl,
      imageUrl,
      order: Number(formData.get("order") ?? 0) || 0,
    },
  });
  await reindex(`project ${created.id}`, () => indexProject(user.id, created.id));
  revalidateAll();
}

/**
 * Save hand-edits to a project card. Tags arrive as a comma-separated string.
 * Editing bumps updatedAt, so a GitHub re-import only overwrites this card if
 * the repo is pushed to again after the edit.
 */
export async function updateProject(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  const updated = await prisma.project.updateMany({
    where: { id, userId: user.id },
    data: {
      name,
      blurb: String(formData.get("blurb") ?? "").trim(),
      detail: String(formData.get("detail") ?? "").trim() || null,
      tags: JSON.stringify(tags),
      githubUrl: String(formData.get("githubUrl") ?? "").trim() || null,
      liveUrl: String(formData.get("liveUrl") ?? "").trim() || null,
      order: Number(formData.get("order") ?? 0) || 0,
    },
  });
  if (updated.count === 0) return;
  await reindex(`project ${id}`, () => indexProject(user.id, id));
  revalidateAll();
}

export async function deleteProject(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.project.deleteMany({ where: { id, userId: user.id } }).catch(() => {});
    await reindex(`project ${id}`, () => dropOrigin(user.id, "project", id));
  }
  revalidateAll();
}

// ── Photos (vision auto-caption) ──
export async function uploadPhoto(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;

  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = await saveBytes(bytes, file.type);

  // Ask Claude vision for a one-paragraph description plus facet tags
  // (best-effort — a failure leaves description/tags empty, not the upload).
  const ext = path.extname(filename);
  const { description, tags } = await describeAndTagImage(bytes, ext);

  const photo = await prisma.photo.create({
    data: {
      userId: user.id,
      filename,
      description,
      tags: JSON.stringify(tags),
      caption: String(formData.get("caption") ?? ""),
      kind: String(formData.get("kind") ?? "gallery"),
      order: Number(formData.get("order") ?? 0) || 0,
    },
  });
  await reindex(`photo ${photo.id}`, () => indexPhoto(user.id, photo.id));
  revalidateAll();
}

export async function updatePhoto(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const updated = await prisma.photo.updateMany({
    where: { id, userId: user.id },
    data: {
      description: String(formData.get("description") ?? ""),
      caption: String(formData.get("caption") ?? ""),
    },
  });
  if (updated.count === 0) return;
  await reindex(`photo ${id}`, () => indexPhoto(user.id, id));
  revalidateAll();
}

export async function deletePhoto(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.photo.deleteMany({ where: { id, userId: user.id } }).catch(() => {});
    await reindex(`photo ${id}`, () => dropOrigin(user.id, "photo", id));
  }
  revalidateAll();
}

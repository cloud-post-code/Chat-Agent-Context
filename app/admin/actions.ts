"use server";

// Ensure the `File` global exists even during Next's build-time page-data
// collection on Node runtimes where it isn't defined (Railway). Node 20+ ships
// File in node:buffer; we pull it onto globalThis as a safety net.
import { File as NodeFile } from "node:buffer";
if (typeof (globalThis as { File?: unknown }).File === "undefined") {
  (globalThis as { File?: unknown }).File = NodeFile;
}

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma, getProfile } from "@/lib/db";
import { checkPassword, createSession, destroySession, isAuthed } from "@/lib/auth";
import { extractLink, extractDocument, extractText } from "@/lib/scrape";
import { indexSource, embedMissingChunks } from "@/lib/retrieval/indexer";
import {
  renameEntity,
  deleteEntity,
  addEdge,
  deleteEdge,
  mergeEntities,
  dismissMerge,
  retrievalPreview,
  type RetrievalPreview,
} from "@/lib/retrieval/graph";
import { dropOrigin } from "@/lib/retrieval/indexer";
import {
  indexProfile,
  indexPersona,
  indexProject,
  indexPhoto,
  indexApprovedAnswer,
} from "@/lib/retrieval/origins";
import { saveCannedAnswer, deleteCannedAnswer } from "@/lib/canned";
import {
  saveDirective,
  deleteDirective,
  DIRECTIVE_KINDS,
  type DirectiveKind,
} from "@/lib/directives";
import { saveAddressBookEntry, deleteAddressBookEntry } from "@/lib/addressBook";
import { saveUiCard, deleteUiCard } from "@/lib/uiCards";
import { saveIngestionSource, setIngestionSourceHidden } from "@/lib/ingestionSources";
import { deleteIngestionSourceAndData } from "@/lib/ingestedItems";
import {
  ingestCustomText,
  ingestCustomImage,
  ingestCustomUrl,
  ingestCustomFile,
  deleteIngestedItem,
} from "@/lib/customIngest";
import { checkEditPassword, createEditSession, isEditAuthed } from "@/lib/ingestionAuth";
import { draftUiCard, type CardDraft } from "@/lib/cardBuilder";
import { redraftAnswer } from "@/lib/answerDrafts";
import { PERSONA_SECTIONS, writePersonaSections } from "@/lib/persona";
import { COLOR_ROLES } from "@/lib/theme";
import { saveUpload, saveBytes } from "@/lib/uploads";
import { describeImage } from "@/lib/vision";
import path from "node:path";

async function requireAuth() {
  if (!(await isAuthed())) redirect("/admin");
}

/**
 * Chunk + embed + entity-extract a freshly scanned source, inline with the
 * ingest request. Best-effort: an indexing failure must never un-scan the
 * source (retrieval falls back to its summary until a rescan/reindex).
 */
async function indexScanned(sourceId: string): Promise<void> {
  await reindex(`source ${sourceId}`, () => indexSource(sourceId));
}

/**
 * Re-index one origin inline with the admin save that changed it, so edits are
 * retrievable immediately. Best-effort by design: indexing calls the embedding
 * and extraction APIs, and neither may ever cost Blake a saved edit.
 */
async function reindex(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(`reindex(${label}) failed:`, e);
  }
}

/**
 * Duck-typed uploaded-file check. We avoid `instanceof File` because the `File`
 * global isn't defined during Next's build-time page-data collection on some
 * Node runtimes (Railway), which throws a ReferenceError at build. A real
 * FormData upload is a Blob-like with arrayBuffer()/size/name.
 */
type UploadLike = { arrayBuffer: () => Promise<ArrayBuffer>; size: number; name: string; type: string };
function isUpload(v: FormDataEntryValue | null): v is File {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as UploadLike).arrayBuffer === "function" &&
    typeof (v as UploadLike).size === "number"
  );
}

function revalidateAll() {
  revalidatePath("/admin/dashboard");
  revalidatePath("/projects");
  revalidatePath("/");
}

// ── Auth ──
export async function login(formData: FormData) {
  const pw = String(formData.get("password") ?? "");
  if (!checkPassword(pw)) redirect("/admin?error=1");
  await createSession();
  redirect("/admin/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/admin");
}

// ── Profile (business identity) ──
export async function saveProfile(formData: FormData) {
  await requireAuth();
  await getProfile();

  await prisma.profile.update({
    where: { id: 1 },
    data: {
      company_name: String(formData.get("company_name") ?? ""),
      owner_name: String(formData.get("owner_name") ?? ""),
      company_address: String(formData.get("company_address") ?? ""),
      company_phone_number: String(formData.get("company_phone_number") ?? ""),
      company_email: String(formData.get("company_email") ?? ""),
      company_hours: String(formData.get("company_hours") ?? ""),
    },
  });
  await reindex("profile", indexProfile);
  revalidateAll();
}

// ── Persona (the section catalogue in lib/persona.ts) ──
export async function savePersona(formData: FormData) {
  await requireAuth();

  // Driven by the catalogue so adding a section can't silently fail to save.
  const sections: Record<string, string> = {};
  for (const s of PERSONA_SECTIONS) {
    sections[s.key] = String(formData.get(`section_${s.key}`) ?? "");
  }

  await prisma.personaConfig.upsert({
    where: { id: 1 },
    update: { tagline: String(formData.get("tagline") ?? "") },
    create: { id: 1, tagline: String(formData.get("tagline") ?? "") },
  });
  await writePersonaSections(sections);
  await reindex("persona", indexPersona);
  revalidateAll();
}

// ── Theme (aesthetic description + the design tokens the site renders from) ──
export async function saveTheme(formData: FormData) {
  await requireAuth();

  // Driven by COLOR_ROLES so adding a role to the design panel can't silently
  // fail to save. Only valid hex values are stored — a blank or malformed entry
  // is omitted entirely so the role falls back to its default rather than being
  // persisted as an empty string.
  const colors: Record<string, string> = {};
  for (const role of COLOR_ROLES) {
    const v = String(formData.get(`color_${role.key}`) ?? "").trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) colors[role.key] = v;
  }

  const theme = {
    aesthetic: String(formData.get("aesthetic") ?? ""),
    themeFont: String(formData.get("themeFont") ?? "space-grotesk"),
    themeBodyFont: String(formData.get("themeBodyFont") ?? "inter"),
    themeRadius: String(formData.get("themeRadius") ?? "rounded"),
    themeFontSize: String(formData.get("themeFontSize") ?? "").trim(),
    themeHeadingWeight: String(formData.get("themeHeadingWeight") ?? "").trim(),
    themeColors: JSON.stringify(colors),
  };
  await prisma.themeConfig.upsert({ where: { id: 1 }, update: theme, create: { id: 1, ...theme } });
  revalidateAll();
}

/** Company logo image upload. */
export async function uploadLogo(formData: FormData) {
  await requireAuth();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  const filename = await saveUpload(file);
  const company_logo = `/api/uploads/${filename}`;
  await prisma.personaConfig.upsert({
    where: { id: 1 },
    update: { company_logo },
    create: { id: 1, company_logo },
  });
  revalidateAll();
}

// ── Sources (unified extraction: link / pdf / text) ──
export async function addSource(formData: FormData) {
  await requireAuth();
  const type = String(formData.get("type") ?? "link");

  if (type === "link") {
    const url = String(formData.get("url") ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return;
    const src = await prisma.source.upsert({
      where: { url },
      update: { status: "pending", error: null, type: "link" },
      create: { url, type: "link", status: "pending" },
    });
    try {
      const r = await extractLink(url);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(src.id);
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
      data: { type: isWord ? "doc" : "pdf", filename: file.name, status: "pending" },
    });
    try {
      const r = await extractDocument(bytes, file.name);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(src.id);
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
      data: { type: "text", title, status: "pending" },
    });
    try {
      const r = await extractText(text, title);
      await prisma.source.update({
        where: { id: src.id },
        data: { ...toData(r), status: "scanned", error: null },
      });
      await indexScanned(src.id);
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
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const src = await prisma.source.findUnique({ where: { id } });
  if (!src || src.type !== "link" || !src.url) return;
  try {
    const r = await extractLink(src.url);
    await prisma.source.update({
      where: { id: src.id },
      data: { ...toData(r), status: "scanned", error: null },
    });
    await indexScanned(src.id);
  } catch (e) {
    await prisma.source.update({ where: { id: src.id }, data: { status: "failed", error: err(e) } });
  }
  revalidateAll();
}

export async function updateSourceSummary(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.source.update({
    where: { id },
    data: { summary: String(formData.get("summary") ?? ""), status: "scanned" },
  });
  // Re-index: for summary-only sources the summary IS the chunked content.
  await indexScanned(id);
  revalidateAll();
}

export async function deleteSource(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.source.delete({ where: { id } }).catch(() => {});
  // Chunks cascade off the Source row, but the entities and relations extracted
  // from it don't — dropOrigin retracts those too.
  if (id) await reindex(`source ${id}`, () => dropOrigin("source", id));
  revalidateAll();
}

// ── Projects (github + live links) ──
export async function addProject(formData: FormData) {
  await requireAuth();
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
      name,
      blurb,
      githubUrl,
      liveUrl,
      imageUrl,
      order: Number(formData.get("order") ?? 0) || 0,
    },
  });
  await reindex(`project ${created.id}`, () => indexProject(created.id));
  revalidateAll();
}

/**
 * Save hand-edits to a project card. Tags arrive as a comma-separated string.
 * Editing bumps updatedAt, so a GitHub re-import only overwrites this card if
 * the repo is pushed to again after the edit.
 */
export async function updateProject(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;

  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);

  await prisma.project.update({
    where: { id },
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
  await reindex(`project ${id}`, () => indexProject(id));
  revalidateAll();
}

export async function deleteProject(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.project.delete({ where: { id } }).catch(() => {});
    await reindex(`project ${id}`, () => dropOrigin("project", id));
  }
  revalidateAll();
}

// ── Photos (vision auto-caption) ──
export async function uploadPhoto(formData: FormData) {
  await requireAuth();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;

  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = await saveBytes(bytes, file.type);

  // Ask Claude vision for a one-paragraph description (best-effort).
  const ext = path.extname(filename);
  const description = await describeImage(bytes, ext);

  const photo = await prisma.photo.create({
    data: {
      filename,
      description,
      caption: String(formData.get("caption") ?? ""),
      kind: String(formData.get("kind") ?? "gallery"),
      order: Number(formData.get("order") ?? 0) || 0,
    },
  });
  await reindex(`photo ${photo.id}`, () => indexPhoto(photo.id));
  revalidateAll();
}

export async function updatePhoto(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.photo.update({
    where: { id },
    data: {
      description: String(formData.get("description") ?? ""),
      caption: String(formData.get("caption") ?? ""),
    },
  });
  await reindex(`photo ${id}`, () => indexPhoto(id));
  revalidateAll();
}

export async function deletePhoto(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.photo.delete({ where: { id } }).catch(() => {});
    await reindex(`photo ${id}`, () => dropOrigin("photo", id));
  }
  revalidateAll();
}

// ── Contacts (submissions from the in-chat contact form) ──
export async function toggleContactHandled(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const handled = String(formData.get("handled") ?? "") === "true";
  if (id) await prisma.contact.update({ where: { id }, data: { handled: !handled } }).catch(() => {});
  revalidatePath("/admin/dashboard");
}

export async function deleteContact(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.contact.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/dashboard");
}

function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Delete one recorded conversation (messages cascade). */
export async function deleteChatSession(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (!id) return revalidatePath("/admin/dashboard");

  // Any approved answers in this conversation were indexed as knowledge;
  // chunks don't cascade off ChatMessage, so drop them before the rows go.
  const approved = await prisma.chatMessage.findMany({
    where: { sessionId: id, role: "assistant", rating: "up" },
    select: { id: true },
  });
  await prisma.chatSession.delete({ where: { id } }).catch(() => {});
  for (const m of approved) {
    await reindex(`activity ${m.id}`, () => dropOrigin("activity", m.id));
  }
  revalidatePath("/admin/dashboard");
}

/**
 * Save Blake's feedback on one bot answer from the Activity tab: a rating
 * (up/down) and an optional correction note. A "down" + note is injected into
 * future system prompts so the bot doesn't repeat the mistake.
 *
 * A 👍 also promotes the answer into the knowledge index. This rating is the
 * ONLY path by which chat content becomes knowledge — visitors type into the
 * public chat box, so nothing they produce is indexed until Blake vouches for
 * it here. Clearing or flipping the rating drops it again.
 */
export async function saveChatFeedback(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const ratingRaw = String(formData.get("rating") ?? "");
  const rating = ratingRaw === "up" || ratingRaw === "down" ? ratingRaw : null;
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw ? noteRaw.slice(0, 2000) : null;
  if (id) {
    await prisma.chatMessage
      .update({ where: { id }, data: { rating, note } })
      .catch(() => {});
    await reindex(`activity ${id}`, () => indexApprovedAnswer(id));
  }
  revalidatePath("/admin/dashboard");
}

// ── Knowledge graph (Graph tab) ──
// Thin auth + revalidate wrappers; the repair logic lives in lib/retrieval/graph.

/** Rename/retype an entity. A name that collides merges the two entities. */
export async function saveEntity(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  const type = String(formData.get("type") ?? "other");
  if (id && name.trim()) await renameEntity(id, name, type);
  revalidatePath("/admin/dashboard");
}

export async function removeEntity(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEntity(id);
  revalidatePath("/admin/dashboard");
}

/**
 * Recompute graph neighborhoods and rewrite their overview paragraphs — up to
 * 6 Claude calls, so it only runs when Blake presses the button.
 */
export async function rebuildOverviews() {
  await requireAuth();
  const { buildClusterOverviews } = await import("@/lib/retrieval/clusters");
  await buildClusterOverviews().catch((e) => console.error("rebuildOverviews failed:", e));
  revalidatePath("/admin/dashboard");
}

/**
 * Repair the chunks whose embedding failed, and only those — embedding calls
 * only, no Claude calls, graph untouched. Best-effort like every other index
 * write here: a provider outage leaves the chunks lexically searchable and the
 * Graph tab still reporting the gap.
 */
export async function backfillEmbeddings() {
  await requireAuth();
  await embedMissingChunks().catch((e) => console.error("backfillEmbeddings failed:", e));
  revalidatePath("/admin/dashboard");
}

/** Read-only: what retrieve() returns for a question. No revalidate needed. */
export async function previewRetrieval(query: string): Promise<RetrievalPreview> {
  await requireAuth();
  return retrievalPreview(String(query ?? "").slice(0, 500));
}

/** One-click merge for a suggested duplicate pair. Stale ids fail soft. */
export async function mergeSuggestedEntities(formData: FormData) {
  await requireAuth();
  await mergeEntities(
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

/** "Don't merge": persist that a suggested pair is not the same thing. */
export async function dismissSuggestedMerge(formData: FormData) {
  await requireAuth();
  await dismissMerge(
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

export async function createEntityEdge(formData: FormData) {
  await requireAuth();
  await addEdge(
    String(formData.get("fromId") ?? ""),
    String(formData.get("toId") ?? ""),
    String(formData.get("relation") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

export async function removeEntityEdge(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEdge(id);
  revalidatePath("/admin/dashboard");
}

// ── helpers ──
function toData(r: {
  title: string | null;
  rawText: string;
  imageUrl: string | null;
  summary: string;
  tags: string[];
  kind: string;
}) {
  return {
    title: r.title,
    rawText: r.rawText,
    imageUrl: r.imageUrl,
    summary: r.summary,
    tags: JSON.stringify(r.tags),
    kind: r.kind,
  };
}

// ── Canned answers ──────────────────────────────────────────────────────────
// Thin auth wrappers; the logic lives in lib/canned.ts so it stays testable.

export async function saveCanned(formData: FormData) {
  await requireAuth();
  await saveCannedAnswer({
    id: String(formData.get("id") ?? "").trim() || undefined,
    question: String(formData.get("question") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    cardTool: String(formData.get("cardTool") ?? "") || null,
    cardInput: String(formData.get("cardInput") ?? "") || null,
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidatePath("/admin/dashboard");
}

export async function deleteCanned(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteCannedAnswer(id);
  revalidatePath("/admin/dashboard");
}

// ── Agent directives (Goals / Rules tabs) ───────────────────────────────────
// Thin auth wrappers; the logic lives in lib/directives.ts so it stays testable.

export async function saveDirectiveAction(formData: FormData) {
  await requireAuth();
  const kind = String(formData.get("kind") ?? "");
  if (!DIRECTIVE_KINDS.includes(kind as DirectiveKind)) return;
  await saveDirective({
    id: String(formData.get("id") ?? "").trim() || undefined,
    kind: kind as DirectiveKind,
    text: String(formData.get("text") ?? ""),
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidatePath("/admin/dashboard");
}

export async function deleteDirectiveAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteDirective(id);
  revalidatePath("/admin/dashboard");
}

// ── Address book (Agent Behavior → Contacts tab) ────────────────────────────
// Thin auth wrappers; the logic lives in lib/addressBook.ts so it stays testable.

export async function saveAddressBookAction(formData: FormData) {
  await requireAuth();
  const error = await saveAddressBookEntry({
    id: String(formData.get("id") ?? "").trim() || undefined,
    name: String(formData.get("name") ?? ""),
    details: String(formData.get("details") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    trust: String(formData.get("trust") ?? "public"),
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidatePath("/admin/dashboard");
  if (error) {
    redirect(`/admin/dashboard?tab=contacts&gmail=${encodeURIComponent(error)}`);
  }
}

/**
 * Read sent mail and fold it into the address book. Synchronous inside the
 * button press, like every other ingestion path here — one Claude call per
 * new correspondent, bounded by MAX_CONTACTS_PER_SYNC.
 *
 * The outcome is reported through the same ?gmail= banner the OAuth routes
 * use, including partial results: a pass that hit its cap says so rather than
 * looking complete.
 */
export async function syncGmailContactsAction() {
  await requireAuth();
  const { gmailReader } = await import("@/lib/gmail/client");
  const { syncSentContacts } = await import("@/lib/gmail/sync");

  let message: string;
  try {
    const r = await syncSentContacts({ reader: gmailReader });
    if (!r.ok) {
      message = `Sync failed: ${r.error ?? "unknown error"}`;
    } else {
      const parts = [
        `Read ${r.messages} sent message${r.messages === 1 ? "" : "s"}`,
        `${r.created} new contact${r.created === 1 ? "" : "s"}`,
        `${r.updated} updated`,
      ];
      if (r.notesFailed) parts.push(`${r.notesFailed} without a note`);
      message = `${parts.join(" · ")}.${r.error ? ` ${r.error}` : ""}`;
    }
  } catch (e) {
    message = `Sync failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  revalidatePath("/admin/dashboard");
  redirect(`/admin/dashboard?tab=contacts&gmail=${encodeURIComponent(message)}`);
}

export async function disconnectGmailAction() {
  await requireAuth();
  const { disconnectGmail } = await import("@/lib/gmail/client");
  await disconnectGmail();
  revalidatePath("/admin/dashboard");
  redirect(
    "/admin/dashboard?tab=contacts&gmail=" +
      encodeURIComponent("Gmail disconnected. Contacts already saved are kept."),
  );
}

export async function deleteAddressBookAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteAddressBookEntry(id);
  revalidatePath("/admin/dashboard");
}

/**
 * Throw away a row's text and write a fresh draft. Best-effort like the
 * indexing wrappers above: a provider failure leaves the existing text in place
 * and logs, rather than throwing an error page over the whole dashboard.
 */
export async function redraftCanned(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  try {
    await redraftAnswer(id);
  } catch (e) {
    console.error(`redraftCanned(${id}) failed:`, e);
  }
  revalidatePath("/admin/dashboard");
}

export async function deleteCard(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteUiCard(id);
  revalidatePath("/admin/dashboard");
}

// The builder's model call moved to app/api/admin/build-card/route.ts: a
// server action returns one value, and the page needs the reasoning and
// searches as they happen. Auth still gates it, at the route.

/** Persist a builder draft — same validated write path as the form. */
export async function saveBuiltCard(input: {
  id?: string;
  key?: string;
  draft: CardDraft;
}): Promise<{ ok: boolean; error?: string }> {
  await requireAuth();
  const error = await saveUiCard({
    id: input.id,
    key: input.key ?? "",
    label: input.draft.label,
    tool: input.draft.tool,
    description: input.draft.description,
    reason: input.draft.reason,
    note: input.draft.note,
    sampleBlock: input.draft.sampleBlock,
  });
  revalidatePath("/admin/dashboard");
  return error ? { ok: false, error } : { ok: true };
}

// ── Ingestion sources (the Content tabs, stored as data) ──

/** Create a new ingestion source from /admin/sources/new. */
export async function createIngestionSourceAction(formData: FormData) {
  await requireAuth();
  const error = await saveIngestionSource({
    key: String(formData.get("key") ?? ""),
    label: String(formData.get("label") ?? ""),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? ""),
    uploadMethod: String(formData.get("uploadMethod") ?? "generic"),
    storageKinds: String(formData.get("storageKinds") ?? "text"),
    splitMode: String(formData.get("splitMode") ?? "split"),
    panelHtml: String(formData.get("panelHtml") ?? ""),
    classification: String(formData.get("classification") ?? "public"),
    outputMethod:
      String(formData.get("outputMethod") ?? "").trim() ||
      "Source/Photo rows, read back as unified text/image items",
  });
  if (error) redirect(`/admin/sources/new?error=${encodeURIComponent(error)}`);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/** Ingest pasted text into a custom source's marked rows. */
export async function ingestCustomTextAction(formData: FormData) {
  await requireAuth();
  await ingestCustomText(String(formData.get("sourceKey") ?? ""), {
    title: String(formData.get("title") ?? ""),
    text: String(formData.get("text") ?? ""),
    classification: String(formData.get("classification") ?? ""),
  });
  revalidateAll();
}

/** Scan a URL into a custom source's marked rows. */
export async function ingestCustomUrlAction(formData: FormData) {
  await requireAuth();
  await ingestCustomUrl(
    String(formData.get("sourceKey") ?? ""),
    String(formData.get("url") ?? ""),
    undefined,
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Ingest an uploaded document into a custom source's marked rows. */
export async function ingestCustomFileAction(formData: FormData) {
  await requireAuth();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomFile(
    String(formData.get("sourceKey") ?? ""),
    Buffer.from(await file.arrayBuffer()),
    file.name,
    undefined,
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Delete one ingested item from a custom source (content, not config). */
export async function deleteIngestedItemAction(formData: FormData) {
  await requireAuth();
  await deleteIngestedItem(
    String(formData.get("sourceKey") ?? ""),
    String(formData.get("itemId") ?? ""),
  );
  revalidateAll();
}

/** Ingest an image into a custom source's marked rows. */
export async function ingestCustomImageAction(formData: FormData) {
  await requireAuth();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomImage(
    String(formData.get("sourceKey") ?? ""),
    Buffer.from(await file.arrayBuffer()),
    file.type,
    String(formData.get("caption") ?? ""),
    undefined,
    String(formData.get("classification") ?? ""),
  );
  revalidateAll();
}

/** Persist a chat-built ingestion source draft (the builder's Save button). */
export async function saveBuiltSourceAction(draft: {
  label: string;
  key: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode?: string;
  panelHtml?: string;
  classification?: string;
  outputMethod: string;
}): Promise<{ ok: boolean; error?: string; key?: string }> {
  await requireAuth();
  const error = await saveIngestionSource({
    key: draft.key,
    label: draft.label,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    uploadMethod: draft.uploadMethod,
    storageKinds: draft.storageKinds,
    splitMode: draft.splitMode,
    panelHtml: draft.panelHtml,
    classification: draft.classification,
    outputMethod: draft.outputMethod,
  });
  if (error) return { ok: false, error };
  revalidateAll();
  // The saved key may differ from the draft's (slugified, collision-suffixed);
  // the newest row is the one this save just created.
  const saved = await prisma.ingestionSource.findFirst({ orderBy: { createdAt: "desc" } });
  return { ok: true, key: saved?.key };
}

/**
 * Save the builder's draft over an EXISTING source. Same edit-password rule
 * as the manual form, but returned as an error the builder can show inline —
 * a redirect would throw away the chat that produced the draft. Enabled and
 * order are not part of a draft; the row keeps its own.
 */
export async function updateBuiltSourceAction(draft: {
  id: string;
  label: string;
  key: string;
  description: string;
  systemPrompt: string;
  uploadMethod: string;
  storageKinds: string;
  splitMode?: string;
  panelHtml?: string;
  classification?: string;
  outputMethod: string;
}): Promise<{ ok: boolean; error?: string; key?: string }> {
  await requireAuth();
  if (!(await isEditAuthed())) {
    return { ok: false, error: "The edit session expired — go back and unlock again." };
  }
  const existing = await prisma.ingestionSource.findUnique({ where: { id: draft.id } });
  if (!existing) return { ok: false, error: "This ingestion source no longer exists." };
  const error = await saveIngestionSource({
    id: draft.id,
    key: draft.key,
    label: draft.label,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    uploadMethod: draft.uploadMethod,
    storageKinds: draft.storageKinds,
    splitMode: draft.splitMode,
    panelHtml: draft.panelHtml,
    classification: draft.classification,
    outputMethod: draft.outputMethod,
    enabled: existing.enabled,
    order: existing.order,
  });
  if (error) return { ok: false, error };
  revalidateAll();
  const saved = await prisma.ingestionSource.findUnique({ where: { id: draft.id } });
  return { ok: true, key: saved?.key };
}

/** Editing source CONFIG needs the local edit password's cookie too. */
async function requireEditAuth(key: string) {
  if (!(await isEditAuthed())) redirect(`/admin/sources/${key}?locked=1`);
}

/** Check the locally-stored edit password and unlock an edit session. */
export async function unlockIngestionEditAction(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("key") ?? "");
  if (!checkEditPassword(String(formData.get("password") ?? ""))) {
    redirect(`/admin/sources/${key}?error=1`);
  }
  await createEditSession();
  redirect(`/admin/sources/${key}`);
}

/**
 * Delete an ingestion source AND everything it ingested. Destructive, so it
 * keeps the edit-password gate on top of admin auth; the edit page's Danger
 * zone is the only caller and requires an explicit confirmation checkbox.
 */
export async function deleteIngestionSourceAction(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  // The checkbox is `required` client-side; re-check server-side so a raw
  // POST can't skip the confirmation.
  if (formData.get("confirm") !== "on") {
    redirect(`/admin/sources/${key}?error=${encodeURIComponent("Tick the confirmation box to delete this source.")}`);
  }
  const id = String(formData.get("id") ?? "");
  if (id) await deleteIngestionSourceAndData(id);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/** Hide or show a source's Content tab. Reversible, so admin auth suffices. */
export async function setIngestionSourceHiddenAction(formData: FormData) {
  await requireAuth();
  const id = String(formData.get("id") ?? "");
  if (id) await setIngestionSourceHidden(id, formData.get("hidden") === "1");
  revalidateAll();
}

/** Save edits to an existing ingestion source (config, not content). */
export async function updateIngestionSourceAction(formData: FormData) {
  await requireAuth();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  const error = await saveIngestionSource({
    id: String(formData.get("id") ?? ""),
    key,
    label: String(formData.get("label") ?? ""),
    description: String(formData.get("description") ?? ""),
    systemPrompt: String(formData.get("systemPrompt") ?? ""),
    uploadMethod: String(formData.get("uploadMethod") ?? "generic"),
    storageKinds: String(formData.get("storageKinds") ?? "text"),
    splitMode: String(formData.get("splitMode") ?? "split"),
    panelHtml: String(formData.get("panelHtml") ?? ""),
    classification: String(formData.get("classification") ?? "public"),
    outputMethod: String(formData.get("outputMethod") ?? ""),
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  if (error) redirect(`/admin/sources/${key}?error=${encodeURIComponent(error)}`);
  revalidateAll();
  // Land back on the ingestion that was just edited, not the first tab.
  redirect(`/admin/dashboard?tab=${key}`);
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : "operation failed";
}

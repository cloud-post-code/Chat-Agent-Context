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
import { sanitizeSocialLinks } from "@/lib/socialLinks";
import {
  accountActive,
  createSession,
  currentUser,
  destroySession,
} from "@/lib/auth";
import { authenticate } from "@/lib/bulkAccounts";
import {
  createAccount,
  deleteAccount,
  isOperator,
  issuePassword,
  setAccountDisabled,
  updateAccount,
} from "@/lib/accountAdmin";
import { createUser, provisionUserDefaults } from "@/lib/users";
import {
  deleteAppointmentField,
  moveAppointmentField,
  saveAppointmentField,
  setBookingEnabled,
} from "@/lib/appointments";
import { isFieldRole, parseOptionLines } from "@/lib/appointmentTypes";
import {
  saveService,
  deleteService,
  moveService,
  saveStaff,
  deleteStaff,
  moveStaff,
  saveLocation,
  deleteLocation,
  moveLocation,
  saveBookingSettings,
  setBookingStatus,
} from "@/lib/booking/store";
import { type Pricing, type Deposit, type ServiceMode, type LocationKind } from "@/lib/booking/types";
import {
  parseVariantLines,
  parseAddonLines,
  parseHolidayLines,
  parseTimeOffLines,
  parsePromoLines,
  parseMembershipLines,
} from "./booking/lines";
import { hoursFromForm, numOrUndef, intOrUndef, intOr, strOrUndef, listOf } from "./booking/forms";
import { refreshServicesFromSite } from "@/lib/onboarding/refreshServices";
import type { User } from "@prisma/client";
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
import { savePersonaBrand } from "@/lib/brand";
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
import { applyThemeColor, approveIngestion, type IngestMethod } from "@/lib/adminBrain";
import { draftUiCard, type CardDraft } from "@/lib/cardBuilder";
import { redraftAnswer } from "@/lib/answerDrafts";
import { regenerateStarterQuestions } from "@/lib/starterQuestions";
import { PERSONA_SECTIONS, writePersonaSections } from "@/lib/persona";
import { COLOR_ROLES } from "@/lib/theme";
import { saveUpload, saveBytes } from "@/lib/uploads";
import { describeImage } from "@/lib/vision";
import path from "node:path";

/** The logged-in user, or a redirect to the login page. */
async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/admin");
  return user;
}

/**
 * Chunk + embed + entity-extract a freshly scanned source, inline with the
 * ingest request. Best-effort: an indexing failure must never un-scan the
 * source (retrieval falls back to its summary until a rescan/reindex).
 */
async function indexScanned(userId: string, sourceId: string): Promise<void> {
  await reindex(`source ${sourceId}`, () => indexSource(userId, sourceId));
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
  // The chat renders the very same panels as the dashboard, and is where
  // signed-in owners land — leaving it out meant a save anywhere in the admin
  // left the chat's revealed panels showing stale data.
  revalidatePath("/admin/chat");
  revalidatePath("/projects");
  revalidatePath("/");
}

// ── Auth ──
/** The "email" field accepts an email or a bulk-built username (no "@"). */
export async function login(formData: FormData) {
  const identifier = String(formData.get("email") ?? "").trim();
  const pw = String(formData.get("password") ?? "");
  const user = identifier ? await authenticate(identifier, pw) : null;
  if (!user) redirect("/admin?error=1");
  await createSession(user.id);
  redirect("/admin/chat");
}

export async function signup(formData: FormData) {
  const result = await createUser({
    email: String(formData.get("email") ?? ""),
    name: String(formData.get("name") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if ("error" in result) {
    redirect(`/signup?error=${encodeURIComponent(result.error)}`);
  }
  await createSession(result.user.id);
  redirect("/admin/chat");
}

export async function logout() {
  await destroySession();
  redirect("/admin");
}

// ── Account administration (operator-gated Users tab) ──

/** The logged-in operator, or an authorization error for everyone else. */
async function requireOperator(): Promise<User> {
  const user = await requireUser();
  if (!(await isOperator(user))) throw new Error("Not authorized.");
  return user;
}

export async function updateAccountAction(formData: FormData) {
  await requireOperator();
  const result = await updateAccount(String(formData.get("id") ?? ""), {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    slug: String(formData.get("slug") ?? ""),
  });
  revalidatePath("/admin/dashboard");
  return result;
}

export async function setAccountDisabledAction(formData: FormData) {
  const operator = await requireOperator();
  const result = await setAccountDisabled(
    String(formData.get("id") ?? ""),
    formData.get("disabled") === "1",
    operator.id,
  );
  revalidatePath("/admin/dashboard");
  return result;
}

/** Returns the generated password once; it is never persisted in the clear. */
export async function issuePasswordAction(id: string) {
  await requireOperator();
  return issuePassword(id);
}

/** Returns the new account's generated password once. */
export async function createAccountAction(formData: FormData) {
  await requireOperator();
  const result = await createAccount({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  revalidatePath("/admin/dashboard");
  return result;
}

export async function deleteAccountAction(formData: FormData) {
  const operator = await requireOperator();
  const result = await deleteAccount(String(formData.get("id") ?? ""), operator.id);
  revalidatePath("/admin/dashboard");
  return result;
}

/**
 * "Log in as": swap the operator's session for the target account's and land
 * on its control room. One-way by design — log out to leave.
 */
export async function impersonateAction(formData: FormData) {
  await requireOperator();
  const id = String(formData.get("id") ?? "");
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || !accountActive(target)) throw new Error("No such active account.");
  await createSession(target.id);
  redirect("/admin/chat");
}

// ── Profile (business identity) ──
export async function saveProfile(formData: FormData) {
  const user = await requireUser();
  await getProfile(user.id);

  await prisma.profile.update({
    where: { userId: user.id },
    data: {
      company_name: String(formData.get("company_name") ?? ""),
      owner_name: String(formData.get("owner_name") ?? ""),
      company_address: String(formData.get("company_address") ?? ""),
      company_phone_number: String(formData.get("company_phone_number") ?? ""),
      company_email: String(formData.get("company_email") ?? ""),
      company_hours: String(formData.get("company_hours") ?? ""),
      social_links: JSON.stringify(sanitizeSocialLinks(
        String(formData.get("social_links") ?? "")
          .split("\n")
          .map((line) => {
            const m = line.trim().match(/^(?:([^:\s][^:]*?):\s*)?(https?:\/\/\S+)$/i);
            return m ? { platform: (m[1] ?? "").toLowerCase(), url: m[2] } : null;
          })
          .filter(Boolean),
      )),
    },
  });
  await reindex("profile", () => indexProfile(user.id));
  revalidateAll();
}

/**
 * Wipe the account's data and send the user back through guided onboarding.
 * The button lives at the bottom of the Profile tab; clearing onboardedAt is
 * what routes the next admin visit into the flow again.
 *
 * "Wipe" is a full content reset, not just the profile: everything onboarding
 * or the dashboard populated — knowledge (sources/chunks and the entity graph
 * hanging off them), photos, projects, chat history, canned answers,
 * directives, UI cards, ingestion sources and their item classifications,
 * address book, contacts, A2A tasks, persona, and theme — so a re-run starts
 * from a genuinely empty account instead of stacking on stale data. The login
 * itself and the Gmail connection (GmailAuth) are kept.
 */
export async function restartOnboarding() {
  const user = await requireUser();
  const where = { where: { userId: user.id } };
  await prisma.$transaction([
    // Chunks first, then entities — mentions/edges/edge-origins cascade.
    prisma.chunk.deleteMany(where),
    prisma.source.deleteMany(where),
    prisma.entity.deleteMany(where),
    prisma.mergeDismissal.deleteMany(where),
    prisma.photo.deleteMany(where),
    prisma.project.deleteMany(where),
    prisma.chatSession.deleteMany(where), // messages cascade
    prisma.cannedAnswer.deleteMany(where),
    prisma.agentDirective.deleteMany(where),
    prisma.uiCard.deleteMany(where),
    prisma.itemClassification.deleteMany(where),
    prisma.ingestionSource.deleteMany(where),
    prisma.addressBookEntry.deleteMany(where),
    prisma.contact.deleteMany(where),
    prisma.a2ATask.deleteMany(where),
    prisma.personaConfig.deleteMany(where),
    prisma.themeConfig.deleteMany(where),
    prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        company_name: "", owner_name: "", company_address: "",
        company_phone_number: "", company_email: "", company_hours: "",
        social_links: "[]",
      },
      create: { userId: user.id },
    }),
    prisma.user.update({ where: { id: user.id }, data: { onboardedAt: null } }),
  ]);

  // The transaction above clears the rows a NEW account is provisioned with —
  // ingestion sources, A2UI cards, starter answers, persona and theme. Without
  // putting them back the account restarts onboarding with no content tabs, no
  // cards and no starter questions, which is what "reset isn't working" looked
  // like: it wiped everything and rebuilt nothing.
  await provisionUserDefaults(user.id);

  revalidateAll();
  redirect("/admin/onboarding");
}

// ── Persona (the section catalogue in lib/persona.ts) ──
export async function savePersona(formData: FormData) {
  const user = await requireUser();

  // Driven by the catalogue so adding a section can't silently fail to save.
  const sections: Record<string, string> = {};
  for (const s of PERSONA_SECTIONS) {
    sections[s.key] = String(formData.get(`section_${s.key}`) ?? "");
  }

  // A tagline edited here is the owner's own wording — the extracted/
  // suggested provenance flag only survives while the text is unchanged.
  const tagline = String(formData.get("tagline") ?? "");
  const existing = await prisma.personaConfig.findUnique({ where: { userId: user.id } });
  const taglineSource = existing && existing.tagline === tagline ? existing.taglineSource : "";
  await prisma.personaConfig.upsert({
    where: { userId: user.id },
    update: { tagline, taglineSource },
    create: { userId: user.id, tagline, taglineSource },
  });
  await writePersonaSections(user.id, sections);
  await reindex("persona", () => indexPersona(user.id));
  revalidateAll();
}

// ── Theme (aesthetic description + the design tokens the site renders from) ──
export async function saveTheme(formData: FormData) {
  const user = await requireUser();

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
  await prisma.themeConfig.upsert({
    where: { userId: user.id },
    update: theme,
    create: { userId: user.id, ...theme },
  });

  // Brand voice lives on the Theme tab too — tagline (with its extracted/
  // suggested provenance flag), brand values (one per line), tone of voice.
  // An edited tagline is the owner's own wording, so the provenance flag
  // only survives while the text matches what is stored.
  const tagline = String(formData.get("tagline") ?? "");
  const existingPersona = await prisma.personaConfig.findUnique({ where: { userId: user.id } });
  await savePersonaBrand(user.id, {
    tagline,
    taglineSource:
      existingPersona && existingPersona.tagline === tagline.trim()
        ? String(formData.get("taglineSource") ?? "")
        : "",
    values: String(formData.get("brandValues") ?? "").split("\n"),
    tone: String(formData.get("toneOfVoice") ?? ""),
  });
  revalidateAll();
}

/** Company logo image upload. */
export async function uploadLogo(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  const filename = await saveUpload(file);
  const company_logo = `/api/uploads/${filename}`;
  await prisma.personaConfig.upsert({
    where: { userId: user.id },
    update: { company_logo },
    create: { userId: user.id, company_logo },
  });
  revalidateAll();
}

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

  // Ask Claude vision for a one-paragraph description (best-effort).
  const ext = path.extname(filename);
  const description = await describeImage(bytes, ext);

  const photo = await prisma.photo.create({
    data: {
      userId: user.id,
      filename,
      description,
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

// ── Contacts (submissions from the in-chat contact form) ──
export async function toggleContactHandled(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const handled = String(formData.get("handled") ?? "") === "true";
  if (id) {
    await prisma.contact
      .updateMany({ where: { id, userId: user.id }, data: { handled: !handled } })
      .catch(() => {});
  }
  revalidatePath("/admin/dashboard");
}

export async function deleteContact(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await prisma.contact.deleteMany({ where: { id, userId: user.id } }).catch(() => {});
  }
  revalidatePath("/admin/dashboard");
}

function clampInt(raw: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Delete one recorded conversation (messages cascade). */
export async function deleteChatSession(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return revalidatePath("/admin/dashboard");

  // Any approved answers in this conversation were indexed as knowledge;
  // chunks don't cascade off ChatMessage, so drop them before the rows go.
  const approved = await prisma.chatMessage.findMany({
    where: { sessionId: id, role: "assistant", rating: "up", session: { userId: user.id } },
    select: { id: true },
  });
  await prisma.chatSession
    .deleteMany({ where: { id, userId: user.id } })
    .catch(() => {});
  for (const m of approved) {
    await reindex(`activity ${m.id}`, () => dropOrigin(user.id, "activity", m.id));
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
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const ratingRaw = String(formData.get("rating") ?? "");
  const rating = ratingRaw === "up" || ratingRaw === "down" ? ratingRaw : null;
  const noteRaw = String(formData.get("note") ?? "").trim();
  const note = noteRaw ? noteRaw.slice(0, 2000) : null;
  if (id) {
    await prisma.chatMessage
      .updateMany({
        where: { id, session: { userId: user.id } },
        data: { rating, note },
      })
      .catch(() => {});
    await reindex(`activity ${id}`, () => indexApprovedAnswer(user.id, id));
  }
  revalidatePath("/admin/dashboard");
}

// ── Knowledge graph (Graph tab) ──
// Thin auth + revalidate wrappers; the repair logic lives in lib/retrieval/graph.

/** Rename/retype an entity. A name that collides merges the two entities. */
export async function saveEntity(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  const type = String(formData.get("type") ?? "other");
  if (id && name.trim()) await renameEntity(user.id, id, name, type);
  revalidatePath("/admin/dashboard");
}

export async function removeEntity(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEntity(user.id, id);
  revalidatePath("/admin/dashboard");
}

/**
 * Recompute graph neighborhoods and rewrite their overview paragraphs — up to
 * 6 Claude calls, so it only runs when Blake presses the button.
 */
export async function rebuildOverviews() {
  const user = await requireUser();
  const { buildClusterOverviews } = await import("@/lib/retrieval/clusters");
  await buildClusterOverviews(user.id).catch((e) =>
    console.error("rebuildOverviews failed:", e),
  );
  revalidatePath("/admin/dashboard");
}

/**
 * Repair the chunks whose embedding failed, and only those — embedding calls
 * only, no Claude calls, graph untouched. Best-effort like every other index
 * write here: a provider outage leaves the chunks lexically searchable and the
 * Graph tab still reporting the gap.
 */
export async function backfillEmbeddings() {
  const user = await requireUser();
  await embedMissingChunks(user.id).catch((e) =>
    console.error("backfillEmbeddings failed:", e),
  );
  revalidatePath("/admin/dashboard");
}

/** Read-only: what retrieve() returns for a question. No revalidate needed. */
export async function previewRetrieval(query: string): Promise<RetrievalPreview> {
  const user = await requireUser();
  return retrievalPreview(user.id, String(query ?? "").slice(0, 500));
}

/** One-click merge for a suggested duplicate pair. Stale ids fail soft. */
export async function mergeSuggestedEntities(formData: FormData) {
  const user = await requireUser();
  await mergeEntities(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

/** "Don't merge": persist that a suggested pair is not the same thing. */
export async function dismissSuggestedMerge(formData: FormData) {
  const user = await requireUser();
  await dismissMerge(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("intoId") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

export async function createEntityEdge(formData: FormData) {
  const user = await requireUser();
  await addEdge(
    user.id,
    String(formData.get("fromId") ?? ""),
    String(formData.get("toId") ?? ""),
    String(formData.get("relation") ?? ""),
  );
  revalidatePath("/admin/dashboard");
}

export async function removeEntityEdge(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteEdge(user.id, id);
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
  const user = await requireUser();
  await saveCannedAnswer(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    question: String(formData.get("question") ?? ""),
    label: String(formData.get("label") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    cardTool: String(formData.get("cardTool") ?? "") || null,
    cardInput: String(formData.get("cardInput") ?? "") || null,
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidatePath("/admin/dashboard");
}

export async function deleteCanned(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteCannedAnswer(user.id, id);
  revalidatePath("/admin/dashboard");
}

// ── Agent directives (Goals / Rules tabs) ───────────────────────────────────
// Thin auth wrappers; the logic lives in lib/directives.ts so it stays testable.

export async function saveDirectiveAction(formData: FormData) {
  const user = await requireUser();
  const kind = String(formData.get("kind") ?? "");
  if (!DIRECTIVE_KINDS.includes(kind as DirectiveKind)) return;
  await saveDirective(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    kind: kind as DirectiveKind,
    text: String(formData.get("text") ?? ""),
    enabled: formData.get("enabled") === "on",
    order: Number(formData.get("order") ?? 0) || 0,
  });
  revalidatePath("/admin/dashboard");
}

export async function deleteDirectiveAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteDirective(user.id, id);
  revalidatePath("/admin/dashboard");
}

// ── Address book (Agent Behavior → Contacts tab) ────────────────────────────
// Thin auth wrappers; the logic lives in lib/addressBook.ts so it stays testable.

export async function saveAddressBookAction(formData: FormData) {
  const user = await requireUser();
  const error = await saveAddressBookEntry(user.id, {
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
  const user = await requireUser();
  const { gmailReader } = await import("@/lib/gmail/client");
  const { syncSentContacts } = await import("@/lib/gmail/sync");

  let message: string;
  try {
    const r = await syncSentContacts({ userId: user.id, reader: gmailReader(user.id) });
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
  const user = await requireUser();
  const { disconnectGmail } = await import("@/lib/gmail/client");
  await disconnectGmail(user.id);
  revalidatePath("/admin/dashboard");
  redirect(
    "/admin/dashboard?tab=contacts&gmail=" +
      encodeURIComponent("Gmail disconnected. Contacts already saved are kept."),
  );
}

export async function deleteAddressBookAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteAddressBookEntry(user.id, id);
  revalidatePath("/admin/dashboard");
}

/**
 * Throw away a row's text and write a fresh draft. Best-effort like the
 * indexing wrappers above: a provider failure leaves the existing text in place
 * and logs, rather than throwing an error page over the whole dashboard.
 */
/**
 * Rebuild the starter-question list from today's business context. The lib
 * pass keeps every owner-authored row and swallows provider failures, so this
 * wrapper only authenticates and revalidates.
 */
export async function regenerateCanned() {
  const user = await requireUser();
  await regenerateStarterQuestions(user.id);
  revalidatePath("/admin/dashboard");
}

export async function redraftCanned(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  try {
    await redraftAnswer(user.id, id);
  } catch (e) {
    console.error(`redraftCanned(${id}) failed:`, e);
  }
  revalidatePath("/admin/dashboard");
}

export async function deleteCard(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "").trim();
  if (id) await deleteUiCard(user.id, id);
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
  const user = await requireUser();
  const error = await saveUiCard(user.id, {
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

/** Create a new ingestion source from the Content "+ New ingestion source" sub-tab. */
export async function createIngestionSourceAction(formData: FormData) {
  const user = await requireUser();
  const error = await saveIngestionSource(user.id, {
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
  if (error) redirect(`/admin/dashboard?tab=new-source&error=${encodeURIComponent(error)}`);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/**
 * Approve a chat-proposed ingestion. Object-in/object-out like the builder
 * saves, but over FormData because the approval card may carry a file. The
 * routing and writes live in lib/adminBrain.approveIngestion.
 */
export async function approveIngestionAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const method = String(formData.get("method") ?? "text");
  const proposal = {
    sourceKey: String(formData.get("sourceKey") ?? ""),
    method: (["url", "text", "file", "image"].includes(method) ? method : "text") as IngestMethod,
    title: String(formData.get("title") ?? "") || undefined,
    url: String(formData.get("url") ?? "") || undefined,
    text: String(formData.get("text") ?? "") || undefined,
    caption: String(formData.get("caption") ?? "") || undefined,
    classification: String(formData.get("classification") ?? "") || undefined,
  };
  const f = formData.get("file");
  const file =
    isUpload(f) && f.size > 0
      ? { bytes: Buffer.from(await f.arrayBuffer()), filename: f.name, contentType: f.type }
      : undefined;
  const error = await approveIngestion(user.id, proposal, { file });
  revalidateAll();
  return error ? { ok: false, error } : { ok: true };
}

/**
 * The chat-first admin's focused theme edit: Save on the copilot's pre-filled
 * color card. One role is written; lib/adminBrain.applyThemeColor leaves the
 * rest of the theme alone.
 */
export async function applyThemeColorAction(
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const error = await applyThemeColor(
    user.id,
    String(formData.get("role") ?? ""),
    String(formData.get("value") ?? ""),
  );
  revalidateAll();
  return error ? { ok: false, error } : { ok: true };
}

/** Ingest pasted text into a custom source's marked rows. */
export async function ingestCustomTextAction(formData: FormData) {
  const user = await requireUser();
  await ingestCustomText(user.id, String(formData.get("sourceKey") ?? ""), {
    title: String(formData.get("title") ?? ""),
    text: String(formData.get("text") ?? ""),
    classification: String(formData.get("classification") ?? ""),
  });
  revalidateAll();
}

/** Scan a URL into a custom source's marked rows. */
export async function ingestCustomUrlAction(formData: FormData) {
  const user = await requireUser();
  await ingestCustomUrl(
    user.id,
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
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomFile(
    user.id,
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
  const user = await requireUser();
  await deleteIngestedItem(
    user.id,
    String(formData.get("sourceKey") ?? ""),
    String(formData.get("itemId") ?? ""),
  );
  revalidateAll();
}

/** Ingest an image into a custom source's marked rows. */
export async function ingestCustomImageAction(formData: FormData) {
  const user = await requireUser();
  const file = formData.get("file");
  if (!isUpload(file) || file.size === 0) return;
  await ingestCustomImage(
    user.id,
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
  const user = await requireUser();
  const error = await saveIngestionSource(user.id, {
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
  const saved = await prisma.ingestionSource.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
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
  const user = await requireUser();
  if (!(await isEditAuthed())) {
    return { ok: false, error: "The edit session expired — go back and unlock again." };
  }
  const existing = await prisma.ingestionSource.findFirst({
    where: { id: draft.id, userId: user.id },
  });
  if (!existing) return { ok: false, error: "This ingestion source no longer exists." };
  const error = await saveIngestionSource(user.id, {
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
  const saved = await prisma.ingestionSource.findFirst({
    where: { id: draft.id, userId: user.id },
  });
  return { ok: true, key: saved?.key };
}

/** Editing source CONFIG needs the local edit password's cookie too. */
async function requireEditAuth(key: string) {
  if (!(await isEditAuthed())) redirect(`/admin/sources/${key}?locked=1`);
}

/** Check the locally-stored edit password and unlock an edit session. */
export async function unlockIngestionEditAction(formData: FormData) {
  await requireUser();
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
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  // The checkbox is `required` client-side; re-check server-side so a raw
  // POST can't skip the confirmation.
  if (formData.get("confirm") !== "on") {
    redirect(`/admin/sources/${key}?error=${encodeURIComponent("Tick the confirmation box to delete this source.")}`);
  }
  const id = String(formData.get("id") ?? "");
  if (id) await deleteIngestionSourceAndData(user.id, id);
  revalidateAll();
  redirect("/admin/dashboard?tab=content");
}

/** Hide or show a source's Content tab. Reversible, so admin auth suffices. */
export async function setIngestionSourceHiddenAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setIngestionSourceHidden(user.id, id, formData.get("hidden") === "1");
  revalidateAll();
}

/** Save edits to an existing ingestion source (config, not content). */
export async function updateIngestionSourceAction(formData: FormData) {
  const user = await requireUser();
  const key = String(formData.get("key") ?? "");
  await requireEditAuth(key);
  const error = await saveIngestionSource(user.id, {
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

// ── Appointments ──

export async function setBookingEnabledAction(formData: FormData) {
  const user = await requireUser();
  await setBookingEnabled(user.id, formData.get("enabled") === "on");
  revalidateAll();
}

export async function saveAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  // The form only renders the inputs its type uses, so every part of the
  // config is read as "absent unless posted"; saveAppointmentField keeps the
  // parts the type can use and drops the rest.
  const int = (name: string) => {
    const raw = String(formData.get(name) ?? "").trim();
    return raw && Number.isInteger(Number(raw)) ? Number(raw) : undefined;
  };
  // "Only ask when…": a condition on another question's key, with optional
  // values — empty values means "whenever that question has any answer".
  const showIfKey = String(formData.get("showIfKey") ?? "").trim();
  const showIfValues = String(formData.get("showIfValues") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const role = formData.get("role");
  await saveAppointmentField(user.id, {
    key: String(formData.get("key") ?? "") || undefined,
    label: String(formData.get("label") ?? ""),
    type: String(formData.get("type") ?? "short_text"),
    required: formData.get("required") === "on",
    role: isFieldRole(role) ? role : undefined,
    screen: int("screen"),
    config: {
      options: parseOptionLines(String(formData.get("options") ?? "")),
      allowOther: formData.get("allowOther") === "on",
      min: int("min"),
      max: int("max"),
      text: String(formData.get("waiverText") ?? "") || undefined,
      showIf: showIfKey ? { key: showIfKey, values: showIfValues } : undefined,
      placeholder: String(formData.get("placeholder") ?? "").trim() || undefined,
      help: String(formData.get("help") ?? "").trim() || undefined,
    },
  });
  revalidateAll();
}

export async function deleteAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  await deleteAppointmentField(user.id, String(formData.get("key") ?? ""));
  revalidateAll();
}

export async function moveAppointmentFieldAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveAppointmentField(user.id, String(formData.get("key") ?? ""), dir);
  revalidateAll();
}

export async function deleteOrderAction(formData: FormData) {
  const user = await requireUser();
  const { deleteOrder } = await import("@/lib/orders");
  await deleteOrder(user.id, String(formData.get("id") ?? ""));
  revalidateAll();
}

// ── Booking (app/admin/booking/): services, providers, locations, settings,
// and the richer Calendar's status actions. Thin auth wrappers around
// lib/booking/store, same idiom as every action above — the parsing helpers
// live in ./booking/forms.ts and ./booking/lines.ts so they stay testable
// without a request context.

/** Only assign a key when its parsed value is defined, so a blank/invalid
 *  number field never overwrites a stored setting with `undefined` when the
 *  patch is merged over it. */
function setDefined(obj: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined) obj[key] = value;
}

export async function saveServiceAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  // imageFilename left out (undefined) keeps the stored image; "" from a
  // removed image, and the store's own saveUpload-derived name from a new one.
  let imageFilename: string | null | undefined;
  const file = formData.get("image");
  if (isUpload(file) && file.size > 0) {
    imageFilename = await saveUpload(file);
  } else if (formData.get("removeImage") === "on") {
    imageFilename = null;
  }

  const pricing: Pricing = {
    kind: (String(formData.get("pricingKind") ?? "fixed")) as Pricing["kind"],
    amount: numOrUndef(formData.get("pricingAmount")),
    maxAmount: numOrUndef(formData.get("pricingMaxAmount")),
    unitLabel: strOrUndef(formData.get("pricingUnitLabel")),
    note: strOrUndef(formData.get("pricingNote")),
  };
  const deposit: Deposit = {
    kind: (String(formData.get("depositKind") ?? "none")) as Deposit["kind"],
    amount: numOrUndef(formData.get("depositAmount")),
  };

  await saveService(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    category: String(formData.get("category") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    imageFilename,
    pricing,
    durationMinutes: intOr(formData.get("durationMinutes"), 30),
    bufferBeforeMinutes: intOr(formData.get("bufferBeforeMinutes"), 0),
    bufferAfterMinutes: intOr(formData.get("bufferAfterMinutes"), 0),
    deposit,
    modes: formData.getAll("modes").map(String) as ServiceMode[],
    staffIds: formData.getAll("staffIds").map(String),
    locationIds: formData.getAll("locationIds").map(String),
    eligibility: String(formData.get("eligibility") ?? ""),
    preparation: String(formData.get("preparation") ?? ""),
    cancellationPolicy: String(formData.get("cancellationPolicy") ?? ""),
    maxQuantity: numOrUndef(formData.get("maxQuantity")),
    variants: parseVariantLines(String(formData.get("variants") ?? "")),
    addons: parseAddonLines(String(formData.get("addons") ?? "")),
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteServiceAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteService(user.id, id);
  revalidateAll();
}

export async function moveServiceAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveService(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

export async function saveStaffAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  let photoFilename: string | null | undefined;
  const file = formData.get("photo");
  if (isUpload(file) && file.size > 0) {
    photoFilename = await saveUpload(file);
  } else if (formData.get("removePhoto") === "on") {
    photoFilename = null;
  }

  // Per-service price/duration overrides post as "priceOverride.<serviceId>"
  // / "durationOverride.<serviceId>" rows, one per service on file.
  const priceOverrides: Record<string, number> = {};
  const durationOverrides: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("priceOverride.")) {
      const n = numOrUndef(value);
      if (n !== undefined) priceOverrides[key.slice("priceOverride.".length)] = n;
    } else if (key.startsWith("durationOverride.")) {
      const n = intOrUndef(value);
      if (n !== undefined) durationOverrides[key.slice("durationOverride.".length)] = n;
    }
  }

  await saveStaff(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    role: String(formData.get("role") ?? ""),
    bio: String(formData.get("bio") ?? ""),
    photoFilename,
    specialties: listOf(formData.get("specialties")),
    languages: listOf(formData.get("languages")),
    credentials: listOf(formData.get("credentials")),
    genderLabel: String(formData.get("genderLabel") ?? ""),
    // An all-closed WeeklyHours (every day empty — either "Use business
    // hours" was checked, or every day really was marked Closed)
    // sanitizes to null via sanitizeOptionalHours, so this needs no branch.
    hours: hoursFromForm(formData, "hours"),
    timeOff: parseTimeOffLines(String(formData.get("timeOff") ?? "")),
    priceOverrides,
    durationOverrides,
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteStaffAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteStaff(user.id, id);
  revalidateAll();
}

export async function moveStaffAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveStaff(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

export async function saveLocationAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const kind = String(formData.get("kind") ?? "business");

  // Per-service price overrides post as "priceOverride.<serviceId>" rows, one
  // per service on file — same idiom as the provider form's overrides.
  const priceOverrides: Record<string, number> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("priceOverride.")) {
      const n = numOrUndef(value);
      if (n !== undefined) priceOverrides[key.slice("priceOverride.".length)] = n;
    }
  }

  await saveLocation(user.id, {
    id: String(formData.get("id") ?? "").trim() || undefined,
    name,
    kind: (["business", "virtual", "mobile"].includes(kind) ? kind : "business") as LocationKind,
    address: String(formData.get("address") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    timezone: String(formData.get("timezone") ?? ""),
    hours: hoursFromForm(formData, "hours"),
    serviceArea: {
      postalCodes: String(formData.get("postalCodes") ?? "")
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      radiusMiles: numOrUndef(formData.get("radiusMiles")),
      travelFee: numOrUndef(formData.get("travelFee")),
      description: strOrUndef(formData.get("serviceAreaDescription")),
    },
    meetingLink: String(formData.get("meetingLink") ?? ""),
    note: String(formData.get("note") ?? ""),
    capacity: intOr(formData.get("capacity"), 1),
    priceOverrides,
    enabled: formData.get("enabled") === "on",
  });
  revalidateAll();
}

export async function deleteLocationAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteLocation(user.id, id);
  revalidateAll();
}

export async function moveLocationAction(formData: FormData) {
  const user = await requireUser();
  const dir = formData.get("dir") === "up" ? "up" : "down";
  await moveLocation(user.id, String(formData.get("id") ?? ""), dir);
  revalidateAll();
}

/**
 * One action for the three BookingSettings sub-panels (Hours & rules,
 * Customer details, Pricing & policies) — a hidden "section" field says which
 * slice of the form posted, so each builds only the patch its own fields
 * cover. saveBookingSettings merges the patch over the stored config, so a
 * field this call leaves out keeps its current value.
 */
export async function saveBookingSettingsAction(formData: FormData) {
  const user = await requireUser();
  const section = String(formData.get("section") ?? "");
  const patch: Record<string, unknown> = {};

  if (section === "hours") {
    patch.timezone = String(formData.get("timezone") ?? "");
    patch.hours = hoursFromForm(formData, "hours");
    patch.holidays = parseHolidayLines(String(formData.get("holidays") ?? ""));
    setDefined(patch, "slotIntervalMinutes", intOrUndef(formData.get("slotIntervalMinutes")));
    setDefined(patch, "leadTimeMinutes", intOrUndef(formData.get("leadTimeMinutes")));
    patch.dailyCutoff = String(formData.get("dailyCutoff") ?? "");
    patch.sameDayBooking = formData.get("sameDayBooking") === "on";
    setDefined(patch, "maxAdvanceDays", intOrUndef(formData.get("maxAdvanceDays")));
    setDefined(patch, "bufferBeforeMinutes", intOrUndef(formData.get("bufferBeforeMinutes")));
    setDefined(patch, "bufferAfterMinutes", intOrUndef(formData.get("bufferAfterMinutes")));
    setDefined(patch, "defaultDurationMinutes", intOrUndef(formData.get("defaultDurationMinutes")));
    patch.waitlist = formData.get("waitlist") === "on";
    patch.recurring = formData.get("recurring") === "on";
    patch.staffSelection = String(formData.get("staffSelection") ?? "optional");
    patch.genderPreference = formData.get("genderPreference") === "on";
    // The owner's word on confirmation outlives any later site read.
    patch.confirmation = formData.get("confirmation") === "request" ? "request" : "instant";
    patch.confirmationOwner = true;
  } else if (section === "pricing") {
    const currencySelect = String(formData.get("currency") ?? "").trim().toUpperCase();
    const currencyOther = String(formData.get("currencyOther") ?? "").trim().toUpperCase();
    const currency = currencySelect || currencyOther;
    if (currency) patch.currency = currency;
    setDefined(patch, "taxRate", numOrUndef(formData.get("taxRate")));
    patch.taxLabel = String(formData.get("taxLabel") ?? "");
    patch.serviceFee = {
      kind: String(formData.get("serviceFeeKind") ?? "none"),
      amount: numOrUndef(formData.get("serviceFeeAmount")),
      label: String(formData.get("serviceFeeLabel") ?? ""),
    };
    patch.tips = {
      enabled: formData.get("tipsEnabled") === "on",
      presets: listOf(formData.get("tipsPresets"))
        .map((s) => Number.parseFloat(s))
        .filter((n) => Number.isFinite(n)),
    };
    patch.promoCodes = parsePromoLines(String(formData.get("promoCodes") ?? ""));
    patch.memberships = parseMembershipLines(String(formData.get("memberships") ?? ""));
    patch.cancellationPolicy = String(formData.get("cancellationPolicy") ?? "");
    patch.depositPolicy = String(formData.get("depositPolicy") ?? "");
    patch.confirmationNote = String(formData.get("confirmationNote") ?? "");
  }

  await saveBookingSettings(user.id, patch);
  revalidateAll();
}

/** Cancel a booking: the row keeps its status history (lib/booking/store.ts). */
export async function cancelBookingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setBookingStatus(user.id, id, "cancelled");
  revalidateAll();
}

/**
 * Re-read the site for the services' prices, durations, add-ons, policies
 * and photos, filling only what is blank (lib/onboarding/refreshServices.ts).
 * Runs inline — a site read takes tens of seconds, which the pending button
 * shows — and lands back on the Services tab with a one-line result.
 */
export async function refreshServicesFromSiteAction(formData: FormData) {
  const user = await requireUser();
  const site = String(formData.get("site") ?? "").trim();
  const result = await refreshServicesFromSite(user.id, () => {}, site || undefined);
  revalidateAll();
  const notice = result.ok
    ? `Read ${result.site}: ${result.services} service${result.services === 1 ? "" : "s"} found, ${result.added} added, ${result.updated} updated, ${result.imaged} photo${result.imaged === 1 ? "" : "s"} attached.`
    : result.error;
  redirect(`/admin/dashboard?tab=booking-services&booking=${encodeURIComponent(notice)}`);
}

/** Confirm a waitlisted booking. */
export async function confirmBookingAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (id) await setBookingStatus(user.id, id, "confirmed");
  revalidateAll();
}

function err(e: unknown): string {
  return e instanceof Error ? e.message : "operation failed";
}

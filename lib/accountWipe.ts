import { prisma } from "@/lib/db";
import { deleteUpload, UPLOAD_FILENAME } from "@/lib/uploads";

/**
 * Full content reset for one account — what "Restart onboarding" runs.
 *
 * Everything onboarding or the dashboard populated goes: knowledge (sources,
 * chunks and the entity graph hanging off them), photos, projects, chat
 * history, canned answers, directives, UI cards, ingestion sources and their
 * item classifications, A2A tasks, persona, theme, the whole booking domain
 * (services, staff, locations, settings, form fields, appointments), menu
 * items and orders. The profile is blanked rather than dropped. The login
 * itself is kept.
 *
 * Uploaded files are removed from the volume too. Filenames are collected
 * BEFORE the rows go (the rows are the only record of which files are ours)
 * and unlinked only AFTER the transaction commits, so a failed wipe never
 * leaves rows pointing at files that no longer exist.
 */
export async function wipeAccountContent(userId: string): Promise<{ filesDeleted: number }> {
  const filenames = await collectUploadFilenames(userId);
  const where = { where: { userId } };
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
    prisma.a2ATask.deleteMany(where),
    prisma.appointment.deleteMany(where),
    prisma.appointmentField.deleteMany(where),
    prisma.service.deleteMany(where),
    prisma.staffMember.deleteMany(where),
    prisma.bookingLocation.deleteMany(where),
    prisma.bookingSettings.deleteMany(where),
    prisma.menuItem.deleteMany(where),
    prisma.order.deleteMany(where),
    prisma.personaConfig.deleteMany(where),
    prisma.themeConfig.deleteMany(where),
    prisma.profile.upsert({
      where: { userId },
      update: {
        company_name: "", owner_name: "", company_address: "",
        company_phone_number: "", company_email: "", company_hours: "",
        social_links: "[]", bookingEnabled: true,
      },
      create: { userId },
    }),
    prisma.user.update({ where: { id: userId }, data: { onboardedAt: null } }),
  ]);

  let filesDeleted = 0;
  for (const name of filenames) {
    if (await deleteUpload(name)) filesDeleted++;
  }
  return { filesDeleted };
}

const UPLOAD_URL = /\/api\/uploads\/([a-f0-9-]+\.(?:jpg|png|webp|gif|pdf))/gi;

/**
 * Every stored upload this account's rows point at. Three columns hold a bare
 * filename (Photo, Service image, StaffMember photo); everything else — logo,
 * project image, card samples, menu item data, chat messages, canned-answer
 * card input, booking configs — carries a `/api/uploads/<name>` URL inside a
 * string or JSON blob. Scanning each row's serialized form for that URL means
 * a new column that stores an upload the same way is covered without an edit
 * here. Filenames are per-upload UUIDs, so nothing found is shared with
 * another account.
 */
async function collectUploadFilenames(userId: string): Promise<Set<string>> {
  const where = { where: { userId } };
  const [photos, services, staff, rows] = await Promise.all([
    prisma.photo.findMany({ ...where, select: { filename: true } }),
    prisma.service.findMany({ ...where, select: { imageFilename: true, config: true } }),
    prisma.staffMember.findMany({ ...where, select: { photoFilename: true, config: true } }),
    Promise.all([
      prisma.personaConfig.findMany(where),
      prisma.project.findMany(where),
      prisma.uiCard.findMany(where),
      prisma.menuItem.findMany(where),
      prisma.cannedAnswer.findMany(where),
      prisma.agentDirective.findMany(where),
      prisma.bookingSettings.findMany(where),
      prisma.bookingLocation.findMany(where),
      prisma.ingestionSource.findMany(where),
      prisma.chatMessage.findMany({ where: { session: { userId } }, select: { content: true } }),
    ]),
  ]);

  const found = new Set<string>();
  const bare = [
    ...photos.map((p) => p.filename),
    ...services.map((s) => s.imageFilename),
    ...staff.map((s) => s.photoFilename),
  ];
  for (const name of bare) if (name && UPLOAD_FILENAME.test(name)) found.add(name);

  const blobs = [...services, ...staff, ...rows.flat()];
  for (const row of blobs) {
    for (const m of JSON.stringify(row).matchAll(UPLOAD_URL)) found.add(m[1]);
  }
  return found;
}

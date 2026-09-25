import type { User } from "@prisma/client";
import { prisma, getProfile, getPersonaConfig, getThemeConfig } from "@/lib/db";
import { safeJson } from "@/lib/util";
import { safePersonaSections } from "@/lib/persona";
import { getBookingConfig } from "@/lib/appointments";
import { listOrders } from "@/lib/orders";
import { listServices, listStaff, listLocations, getBookingSettings, listBookings } from "@/lib/booking/store";
import { isOperator, listAccounts } from "@/lib/accountAdmin";
import { listDirectives } from "@/lib/directives";
import { listAddressBook } from "@/lib/addressBook";
import { gmailStatus } from "@/lib/gmail/client";
import { listUiCards } from "@/lib/uiCards";
import { graphStats, listEntities, listEdges, suggestedMerges } from "@/lib/retrieval/graph";
import { listCannedAnswers } from "@/lib/canned";
import { draftBlankAnswers } from "@/lib/answerDrafts";
import { listIngestionSources } from "@/lib/ingestionSources";
import type { ThemeColors } from "@/lib/theme";
import { chatMetrics } from "@/lib/activity";

/** Everything the admin panels read, in two batches. `AdminData` is the shape every panel takes. */
export async function loadAdminData(
  user: User,
  query: { error?: string; gmail?: string; booking?: string } = {},
) {
  const [
    profile,
    personaConfig,
    themeConfig,
    projects,
    sources,
    photos,
    chatSessions,
    gStats,
    gEntities,
    gEdges,
    gSuggestions,
    gOverviews,
    canned,
    uiCards,
    ingestionSources,
    goalRows,
    ruleRows,
    addressBook,
    gmail,
    bookingConfig,
    orders,
  ] = await Promise.all([
      getProfile(user.id),
      getPersonaConfig(user.id),
      getThemeConfig(user.id),
      prisma.project.findMany({ where: { userId: user.id }, orderBy: { order: "asc" } }),
      prisma.source.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
      // Custom ingestion sources own their `ingest:*`-marked photos; the
      // built-in Photos tab shows only its own.
      prisma.photo.findMany({
        where: { userId: user.id, NOT: { kind: { startsWith: "ingest:" } } },
        orderBy: { order: "asc" },
      }),
      prisma.chatSession.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: { messages: { orderBy: { createdAt: "asc" } } },
      }),
      graphStats(user.id),
      listEntities(user.id),
      listEdges(user.id),
      suggestedMerges(user.id),
      prisma.chunk.findMany({
        where: { userId: user.id, originKind: "cluster" },
        orderBy: { originLabel: "asc" },
        select: { id: true, originLabel: true, text: true },
      }),
      // Starters are seeded at signup (lib/users.ts) and re-checked at boot;
      // the dashboard just reads. Any blank answer row still gets a first
      // draft here — that calls the model, which belongs in an admin visit,
      // not in boot. Best-effort: a provider outage must not take down the
      // admin.
      draftBlankAnswers(user.id)
        .catch(() => 0)
        .then(() => listCannedAnswers(user.id)),
      listUiCards(user.id),
      listIngestionSources(user.id),
      listDirectives(user.id, "goal"),
      listDirectives(user.id, "rule"),
      listAddressBook(user.id),
      gmailStatus(user.id),
      getBookingConfig(user.id),
      listOrders(user.id).catch(() => []),
    ]);
  const metrics = chatMetrics(chatSessions);
  // The Booking section's own data — a separate fetch from the big
  // Promise.all above because lib/booking/store.ts is a sibling feature's
  // module, kept apart so this block reads as one unit.
  const [services, staffList, locationList, bookingSettings, bookings] = await Promise.all([
    listServices(user.id),
    listStaff(user.id),
    listLocations(user.id),
    getBookingSettings(user.id),
    listBookings(user.id),
  ]);
  // Operator-only: account rows are fetched (and the Users tab rendered) for
  // operators alone; the actions re-check the gate on every call.
  const operator = await isOperator(user);
  const accounts = operator ? (await listAccounts({ pageSize: 100 })).rows : [];
  const colors = safeJson<ThemeColors>(themeConfig.themeColors, {});
  const personaSections = safePersonaSections(personaConfig.personaSections);
  return {
    user,
    query,
    profile,
    personaConfig,
    themeConfig,
    projects,
    sources,
    photos,
    chatSessions,
    gStats,
    gEntities,
    gEdges,
    gSuggestions,
    gOverviews,
    canned,
    uiCards,
    ingestionSources,
    goalRows,
    ruleRows,
    addressBook,
    gmail,
    bookingConfig,
    orders,
    metrics,
    services,
    staffList,
    locationList,
    bookingSettings,
    bookings,
    operator,
    accounts,
    colors,
    personaSections,
  };
}

export type AdminData = Awaited<ReturnType<typeof loadAdminData>>;

import { prisma } from "@/lib/db";
import { provisionUserDefaults } from "@/lib/users";

/**
 * Wipe an account's content so onboarding can run again from nothing: every
 * table onboarding or the dashboard populates — knowledge (sources, chunks
 * and the entity graph hanging off them), photos, projects, chat history,
 * canned answers, directives, UI cards, ingestion sources and their item
 * classifications, address book, contacts, A2A tasks, persona, theme, the
 * whole booking setup (services, providers, locations, rules, intake
 * questions, appointments) and the menu with its orders. The profile is
 * blanked with booking back on (its default), `onboardedAt` is cleared so
 * the next admin visit routes into the flow, and the rows a NEW account is
 * provisioned with (persona, theme, starter ingestion sources) are put back.
 * The login itself and the Gmail connection (GmailAuth) are kept.
 *
 * One transaction for the wipe, so a failure part-way leaves the account as
 * it was rather than half-cleared. The Profile tab's "Restart onboarding"
 * button is the one caller (app/admin/actions.ts restartOnboarding).
 */
export async function wipeAccountContent(userId: string): Promise<void> {
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
    prisma.addressBookEntry.deleteMany(where),
    prisma.contact.deleteMany(where),
    prisma.a2ATask.deleteMany(where),
    prisma.personaConfig.deleteMany(where),
    prisma.themeConfig.deleteMany(where),
    // The booking setup: bookings first (they name services and providers),
    // then the catalog, the rules and the intake questions the seeder wrote.
    prisma.appointment.deleteMany(where),
    prisma.appointmentField.deleteMany(where),
    prisma.service.deleteMany(where),
    prisma.staffMember.deleteMany(where),
    prisma.bookingLocation.deleteMany(where),
    prisma.bookingSettings.deleteMany(where),
    prisma.order.deleteMany(where),
    prisma.menuItem.deleteMany(where),
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
  await provisionUserDefaults(userId);
}

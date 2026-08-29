import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seeds the three singleton config rows so the site works out of the box.
 * Edit all of this later in the admin portal — it's just a starting point.
 */
async function main() {
  await prisma.profile.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await prisma.personaConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      tagline: "Here to help. Ask us anything.",
      personaSections: JSON.stringify({
        persona:
          "Warm, helpful, and genuine. Talks like a knowledgeable member of the team, " +
          "not a brochure. Plainspoken, allergic to buzzwords, and honest about what " +
          "it doesn't know.",
      }),
    },
  });
  await prisma.themeConfig.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  console.log("Seeded Profile, PersonaConfig, and ThemeConfig.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Multi-tenant note: per-user starter rows (Profile, PersonaConfig,
 * ThemeConfig, ingestion sources, A2UI cards, canned answers) are provisioned
 * at signup and re-checked at boot by lib/bootstrap.ts, so there is nothing
 * global left to seed. Kept as an explicit no-op so `prisma db seed` stays a
 * safe command.
 */
async function main() {
  console.log("Nothing to seed: per-user defaults are provisioned at signup/boot.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

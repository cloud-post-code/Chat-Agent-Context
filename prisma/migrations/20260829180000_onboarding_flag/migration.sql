-- Guided onboarding: track completion per user. Existing accounts predate the
-- flow and must never be routed into it, so they are stamped as onboarded at
-- migration time; only accounts created after this migration start NULL.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
UPDATE "User" SET "onboardedAt" = CURRENT_TIMESTAMP;

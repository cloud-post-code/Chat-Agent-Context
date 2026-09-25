-- The goal a preset question steers a visitor toward, for the per-chat tab
-- pick (lib/starterPick.ts). Additive with an empty default: existing rows are
-- general questions and keep working untouched.
ALTER TABLE "CannedAnswer" ADD COLUMN "goal" TEXT NOT NULL DEFAULT '';

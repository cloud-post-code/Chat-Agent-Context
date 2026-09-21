-- A short label for each preset question's starter tab on the public page.
-- Additive with an empty default: existing rows keep working untouched, and an
-- empty label means "derive one from the question" (lib/chipLabel.ts).
ALTER TABLE "CannedAnswer" ADD COLUMN "label" TEXT NOT NULL DEFAULT '';

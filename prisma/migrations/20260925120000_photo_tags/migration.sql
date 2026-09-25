-- Facets for the gallery's small addressable items: subject, colors, style,
-- service words. Additive with an empty-array default: existing photo rows
-- keep working untouched, and an empty "[]" means "not tagged yet" — the
-- filter falls back to matching words in the caption/description instead.
ALTER TABLE "Photo" ADD COLUMN "tags" TEXT NOT NULL DEFAULT '[]';

-- Multi-tenant conversion: User table, per-user ownership on every tenant
-- model, and a zero-data-loss backfill.
--
-- Order matters:
--   1. Create User.
--   2. If any tenant data exists (a live single-admin deployment), create the
--      founding user with an UNCLAIMED password (empty hash). lib/bootstrap.ts
--      claims it at boot from ADMIN_EMAIL/ADMIN_PASSWORD env, so the
--      pre-existing admin keeps logging in.
--   3. Add userId columns NULLABLE, backfill every existing row to the
--      founding user, then tighten to NOT NULL.
--   4. Swap global uniques for per-user compound uniques, add FKs.

-- 1 ── User table ────────────────────────────────────────────────────────────
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_slug_key" ON "User"("slug");

-- 2 ── Founding user, only when tenant data already exists ──────────────────
INSERT INTO "User" ("id", "email", "name", "slug", "passwordHash", "updatedAt")
SELECT 'founder', 'founder@unclaimed.invalid', 'Founder', 'founder', '', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "User")
  AND (
       EXISTS (SELECT 1 FROM "Profile")
    OR EXISTS (SELECT 1 FROM "PersonaConfig")
    OR EXISTS (SELECT 1 FROM "ThemeConfig")
    OR EXISTS (SELECT 1 FROM "Source")
    OR EXISTS (SELECT 1 FROM "Chunk")
    OR EXISTS (SELECT 1 FROM "Entity")
    OR EXISTS (SELECT 1 FROM "EntityEdgeOrigin")
    OR EXISTS (SELECT 1 FROM "MergeDismissal")
    OR EXISTS (SELECT 1 FROM "Photo")
    OR EXISTS (SELECT 1 FROM "Project")
    OR EXISTS (SELECT 1 FROM "ChatSession")
    OR EXISTS (SELECT 1 FROM "CannedAnswer")
    OR EXISTS (SELECT 1 FROM "AgentDirective")
    OR EXISTS (SELECT 1 FROM "UiCard")
    OR EXISTS (SELECT 1 FROM "IngestionSource")
    OR EXISTS (SELECT 1 FROM "ItemClassification")
    OR EXISTS (SELECT 1 FROM "AddressBookEntry")
    OR EXISTS (SELECT 1 FROM "GmailAuth")
    OR EXISTS (SELECT 1 FROM "Contact")
    OR EXISTS (SELECT 1 FROM "A2ATask")
  );

-- 3 ── Add userId (nullable), backfill to the founding user, tighten ────────
ALTER TABLE "Source" ADD COLUMN "userId" TEXT;
ALTER TABLE "Chunk" ADD COLUMN "userId" TEXT;
ALTER TABLE "Entity" ADD COLUMN "userId" TEXT;
ALTER TABLE "EntityEdgeOrigin" ADD COLUMN "userId" TEXT;
ALTER TABLE "MergeDismissal" ADD COLUMN "userId" TEXT;
ALTER TABLE "Photo" ADD COLUMN "userId" TEXT;
ALTER TABLE "Project" ADD COLUMN "userId" TEXT;
ALTER TABLE "ChatSession" ADD COLUMN "userId" TEXT;
ALTER TABLE "CannedAnswer" ADD COLUMN "userId" TEXT;
ALTER TABLE "AgentDirective" ADD COLUMN "userId" TEXT;
ALTER TABLE "UiCard" ADD COLUMN "userId" TEXT;
ALTER TABLE "IngestionSource" ADD COLUMN "userId" TEXT;
ALTER TABLE "ItemClassification" ADD COLUMN "userId" TEXT;
ALTER TABLE "AddressBookEntry" ADD COLUMN "userId" TEXT;
ALTER TABLE "GmailAuth" ADD COLUMN "userId" TEXT;
ALTER TABLE "GmailAuth" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Contact" ADD COLUMN "userId" TEXT;
ALTER TABLE "Profile" ADD COLUMN "userId" TEXT;
ALTER TABLE "PersonaConfig" ADD COLUMN "userId" TEXT;
ALTER TABLE "ThemeConfig" ADD COLUMN "userId" TEXT;
ALTER TABLE "A2ATask" ADD COLUMN "userId" TEXT;

UPDATE "Source" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Chunk" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Entity" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "EntityEdgeOrigin" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "MergeDismissal" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Photo" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Project" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "ChatSession" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "CannedAnswer" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "AgentDirective" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "UiCard" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "IngestionSource" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "ItemClassification" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "AddressBookEntry" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "GmailAuth" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Contact" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "Profile" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "PersonaConfig" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "ThemeConfig" SET "userId" = 'founder' WHERE "userId" IS NULL;
UPDATE "A2ATask" SET "userId" = 'founder' WHERE "userId" IS NULL;

ALTER TABLE "Source" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Chunk" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Entity" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "EntityEdgeOrigin" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "MergeDismissal" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Project" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ChatSession" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CannedAnswer" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "AgentDirective" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "UiCard" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "IngestionSource" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ItemClassification" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "AddressBookEntry" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "GmailAuth" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Contact" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Profile" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "PersonaConfig" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ThemeConfig" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "A2ATask" ALTER COLUMN "userId" SET NOT NULL;

-- The singleton config ids (always 1) become autoincrement so a second
-- user's row can be created. Seed each sequence past the existing max id.
CREATE SEQUENCE profile_id_seq;
ALTER TABLE "Profile" ALTER COLUMN "id" SET DEFAULT nextval('profile_id_seq');
ALTER SEQUENCE profile_id_seq OWNED BY "Profile"."id";
SELECT setval('profile_id_seq', COALESCE((SELECT MAX("id") FROM "Profile"), 0) + 1, false);

CREATE SEQUENCE personaconfig_id_seq;
ALTER TABLE "PersonaConfig" ALTER COLUMN "id" SET DEFAULT nextval('personaconfig_id_seq');
ALTER SEQUENCE personaconfig_id_seq OWNED BY "PersonaConfig"."id";
SELECT setval('personaconfig_id_seq', COALESCE((SELECT MAX("id") FROM "PersonaConfig"), 0) + 1, false);

CREATE SEQUENCE themeconfig_id_seq;
ALTER TABLE "ThemeConfig" ALTER COLUMN "id" SET DEFAULT nextval('themeconfig_id_seq');
ALTER SEQUENCE themeconfig_id_seq OWNED BY "ThemeConfig"."id";
SELECT setval('themeconfig_id_seq', COALESCE((SELECT MAX("id") FROM "ThemeConfig"), 0) + 1, false);

-- 4 ── Swap global uniques for per-user ones ────────────────────────────────
DROP INDEX "Source_url_key";
DROP INDEX "Chunk_originKind_originId_idx";
DROP INDEX "Entity_key_key";
DROP INDEX "EntityEdgeOrigin_originKind_originId_idx";
DROP INDEX "MergeDismissal_keyA_keyB_key";
DROP INDEX "ChatSession_visitorKey_key";
DROP INDEX "CannedAnswer_matchKey_key";
DROP INDEX "AgentDirective_kind_idx";
DROP INDEX "UiCard_key_key";
DROP INDEX "IngestionSource_key_key";
DROP INDEX "ItemClassification_itemId_key";
DROP INDEX "ItemClassification_sourceKey_idx";
DROP INDEX "AddressBookEntry_canonicalEmail_key";

CREATE INDEX "Source_userId_idx" ON "Source"("userId");
CREATE UNIQUE INDEX "Source_userId_url_key" ON "Source"("userId", "url");
CREATE INDEX "Chunk_userId_originKind_originId_idx" ON "Chunk"("userId", "originKind", "originId");
CREATE UNIQUE INDEX "Entity_userId_key_key" ON "Entity"("userId", "key");
CREATE INDEX "EntityEdgeOrigin_userId_originKind_originId_idx" ON "EntityEdgeOrigin"("userId", "originKind", "originId");
CREATE UNIQUE INDEX "MergeDismissal_userId_keyA_keyB_key" ON "MergeDismissal"("userId", "keyA", "keyB");
CREATE INDEX "Photo_userId_idx" ON "Photo"("userId");
CREATE INDEX "Project_userId_idx" ON "Project"("userId");
CREATE UNIQUE INDEX "ChatSession_userId_visitorKey_key" ON "ChatSession"("userId", "visitorKey");
CREATE UNIQUE INDEX "CannedAnswer_userId_matchKey_key" ON "CannedAnswer"("userId", "matchKey");
CREATE INDEX "AgentDirective_userId_kind_idx" ON "AgentDirective"("userId", "kind");
CREATE UNIQUE INDEX "UiCard_userId_key_key" ON "UiCard"("userId", "key");
CREATE UNIQUE INDEX "IngestionSource_userId_key_key" ON "IngestionSource"("userId", "key");
CREATE INDEX "ItemClassification_userId_sourceKey_idx" ON "ItemClassification"("userId", "sourceKey");
CREATE UNIQUE INDEX "ItemClassification_userId_itemId_key" ON "ItemClassification"("userId", "itemId");
CREATE UNIQUE INDEX "AddressBookEntry_userId_canonicalEmail_key" ON "AddressBookEntry"("userId", "canonicalEmail");
CREATE UNIQUE INDEX "GmailAuth_userId_key" ON "GmailAuth"("userId");
CREATE INDEX "Contact_userId_idx" ON "Contact"("userId");
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");
CREATE UNIQUE INDEX "PersonaConfig_userId_key" ON "PersonaConfig"("userId");
CREATE UNIQUE INDEX "ThemeConfig_userId_key" ON "ThemeConfig"("userId");
CREATE INDEX "A2ATask_userId_idx" ON "A2ATask"("userId");

-- 5 ── Foreign keys ─────────────────────────────────────────────────────────
ALTER TABLE "Source" ADD CONSTRAINT "Source_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityEdgeOrigin" ADD CONSTRAINT "EntityEdgeOrigin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MergeDismissal" ADD CONSTRAINT "MergeDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CannedAnswer" ADD CONSTRAINT "CannedAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentDirective" ADD CONSTRAINT "AgentDirective_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UiCard" ADD CONSTRAINT "UiCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IngestionSource" ADD CONSTRAINT "IngestionSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ItemClassification" ADD CONSTRAINT "ItemClassification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AddressBookEntry" ADD CONSTRAINT "AddressBookEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GmailAuth" ADD CONSTRAINT "GmailAuth_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonaConfig" ADD CONSTRAINT "PersonaConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ThemeConfig" ADD CONSTRAINT "ThemeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "A2ATask" ADD CONSTRAINT "A2ATask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

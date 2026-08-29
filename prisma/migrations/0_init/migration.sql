-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'link',
    "url" TEXT,
    "filename" TEXT,
    "title" TEXT,
    "rawText" TEXT,
    "summary" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "kind" TEXT NOT NULL DEFAULT 'other',
    "imageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "originKind" TEXT NOT NULL DEFAULT 'source',
    "originId" TEXT NOT NULL DEFAULT '',
    "originLabel" TEXT NOT NULL DEFAULT '',
    "sourceId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "text" TEXT NOT NULL,
    "embedding" BYTEA,
    "embedModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'topic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMention" (
    "id" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityEdge" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,

    CONSTRAINT "EntityEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityEdgeOrigin" (
    "id" TEXT NOT NULL,
    "edgeId" TEXT NOT NULL,
    "originKind" TEXT NOT NULL,
    "originId" TEXT NOT NULL,

    CONSTRAINT "EntityEdgeOrigin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MergeDismissal" (
    "id" TEXT NOT NULL,
    "keyA" TEXT NOT NULL,
    "keyB" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MergeDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "caption" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'gallery',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "blurb" TEXT NOT NULL,
    "detail" TEXT,
    "githubUrl" TEXT,
    "liveUrl" TEXT,
    "imageUrl" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "firstQuery" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" TEXT,
    "note" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CannedAnswer" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "answer" TEXT NOT NULL DEFAULT '',
    "aiDraft" BOOLEAN NOT NULL DEFAULT false,
    "draftedAt" TIMESTAMP(3),
    "cardTool" TEXT,
    "cardInput" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CannedAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDirective" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentDirective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UiCard" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "sampleBlock" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UiCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "uploadMethod" TEXT NOT NULL,
    "storageKinds" TEXT NOT NULL DEFAULT 'text',
    "splitMode" TEXT NOT NULL DEFAULT 'split',
    "panelHtml" TEXT NOT NULL DEFAULT '',
    "classification" TEXT NOT NULL DEFAULT 'public',
    "outputMethod" TEXT NOT NULL DEFAULT '',
    "builtin" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemClassification" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressBookEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "details" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "trust" TEXT NOT NULL DEFAULT 'public',
    "order" INTEGER NOT NULL DEFAULT 0,
    "canonicalEmail" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "firstContacted" TIMESTAMP(3),
    "lastContacted" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAuth" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "refreshToken" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailAuth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company_name" TEXT NOT NULL DEFAULT '',
    "owner_name" TEXT NOT NULL DEFAULT '',
    "company_address" TEXT NOT NULL DEFAULT '',
    "company_phone_number" TEXT NOT NULL DEFAULT '',
    "company_email" TEXT NOT NULL DEFAULT '',
    "company_hours" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "company_logo" TEXT,
    "tagline" TEXT NOT NULL DEFAULT '',
    "personaSections" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "themeFont" TEXT NOT NULL DEFAULT 'space-grotesk',
    "themeBodyFont" TEXT NOT NULL DEFAULT 'inter',
    "themeColors" TEXT NOT NULL DEFAULT '{}',
    "themeRadius" TEXT NOT NULL DEFAULT 'rounded',
    "themeFontSize" TEXT NOT NULL DEFAULT '',
    "themeHeadingWeight" TEXT NOT NULL DEFAULT '',
    "aesthetic" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "A2ATask" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'submitted',
    "history" TEXT NOT NULL DEFAULT '[]',
    "artifacts" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "A2ATask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Source_url_key" ON "Source"("url");

-- CreateIndex
CREATE INDEX "Chunk_sourceId_idx" ON "Chunk"("sourceId");

-- CreateIndex
CREATE INDEX "Chunk_originKind_originId_idx" ON "Chunk"("originKind", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "Entity_key_key" ON "Entity"("key");

-- CreateIndex
CREATE INDEX "EntityMention_entityId_idx" ON "EntityMention"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityMention_chunkId_entityId_key" ON "EntityMention"("chunkId", "entityId");

-- CreateIndex
CREATE INDEX "EntityEdge_toId_idx" ON "EntityEdge"("toId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityEdge_fromId_toId_relation_key" ON "EntityEdge"("fromId", "toId", "relation");

-- CreateIndex
CREATE INDEX "EntityEdgeOrigin_originKind_originId_idx" ON "EntityEdgeOrigin"("originKind", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "EntityEdgeOrigin_edgeId_originKind_originId_key" ON "EntityEdgeOrigin"("edgeId", "originKind", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "MergeDismissal_keyA_keyB_key" ON "MergeDismissal"("keyA", "keyB");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_visitorKey_key" ON "ChatSession"("visitorKey");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CannedAnswer_matchKey_key" ON "CannedAnswer"("matchKey");

-- CreateIndex
CREATE INDEX "AgentDirective_kind_idx" ON "AgentDirective"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "UiCard_key_key" ON "UiCard"("key");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionSource_key_key" ON "IngestionSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ItemClassification_itemId_key" ON "ItemClassification"("itemId");

-- CreateIndex
CREATE INDEX "ItemClassification_sourceKey_idx" ON "ItemClassification"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "AddressBookEntry_canonicalEmail_key" ON "AddressBookEntry"("canonicalEmail");

-- CreateIndex
CREATE INDEX "A2ATask_contextId_idx" ON "A2ATask"("contextId");

-- CreateIndex
CREATE INDEX "A2ATask_state_idx" ON "A2ATask"("state");

-- CreateIndex
CREATE INDEX "A2ATask_createdAt_idx" ON "A2ATask"("createdAt");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "Chunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityEdge" ADD CONSTRAINT "EntityEdge_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityEdge" ADD CONSTRAINT "EntityEdge_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityEdgeOrigin" ADD CONSTRAINT "EntityEdgeOrigin_edgeId_fkey" FOREIGN KEY ("edgeId") REFERENCES "EntityEdge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE "PersonaConfig" ADD COLUMN     "brandValues" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "taglineSource" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "toneOfVoice" TEXT NOT NULL DEFAULT '';

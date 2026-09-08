-- Social media profiles get their own onboarding extraction stage; the
-- reviewed links live on the profile as a JSON array of {platform, url}.
ALTER TABLE "Profile" ADD COLUMN "social_links" TEXT NOT NULL DEFAULT '[]';

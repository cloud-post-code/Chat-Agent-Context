-- Admin user management: operators can disable an account. NULL = active;
-- a timestamp blocks login and reads live sessions as logged out
-- (lib/accountAdmin.ts / lib/auth.ts).
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);

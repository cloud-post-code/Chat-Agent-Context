-- The full booking flow: services, providers, locations and tenant rules as
-- their own tables, and an appointment that records what was booked.

-- Two appointments may now share an instant (two providers, two chairs); the
-- write path's advisory lock + overlap check is the race guard instead.
DROP INDEX IF EXISTS "Appointment_userId_startsAt_key";

ALTER TABLE "Appointment"
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN "serviceId" TEXT,
  ADD COLUMN "serviceName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "variantName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "addons" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "staffId" TEXT,
  ADD COLUMN "staffName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "locationId" TEXT,
  ADD COLUMN "locationName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'in_person',
  ADD COLUMN "customer" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "pricing" TEXT NOT NULL DEFAULT '{}',
  ADD COLUMN "recurrence" TEXT NOT NULL DEFAULT '';

CREATE INDEX "Appointment_userId_startsAt_idx" ON "Appointment"("userId", "startsAt");
CREATE INDEX "Appointment_userId_staffId_startsAt_idx" ON "Appointment"("userId", "staffId", "startsAt");

CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "imageFilename" TEXT,
    "pricing" TEXT NOT NULL DEFAULT '{"kind":"variable"}',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Service_userId_order_idx" ON "Service"("userId", "order");
ALTER TABLE "Service" ADD CONSTRAINT "Service_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StaffMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "photoFilename" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffMember_userId_order_idx" ON "StaffMember"("userId", "order");
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BookingLocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'business',
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT '',
    "config" TEXT NOT NULL DEFAULT '{}',
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingLocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BookingLocation_userId_order_idx" ON "BookingLocation"("userId", "order");
ALTER TABLE "BookingLocation" ADD CONSTRAINT "BookingLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BookingSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookingSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BookingSettings_userId_key" ON "BookingSettings"("userId");
ALTER TABLE "BookingSettings" ADD CONSTRAINT "BookingSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

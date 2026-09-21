-- What a booking question needs beyond its label: a choice question's options
-- (with optional price / duration / description / menu section), or a number's
-- bounds. Additive with an empty default: existing text questions keep working
-- untouched, and '{}' reads as "no config" (lib/appointmentTypes.ts).
ALTER TABLE "AppointmentField" ADD COLUMN "config" TEXT NOT NULL DEFAULT '{}';

-- Booking starts on for new tenants.
-- Column default only: existing rows are deliberately NOT updated, so a tenant
-- who turned booking off stays off.
ALTER TABLE "Profile" ALTER COLUMN "bookingEnabled" SET DEFAULT true;

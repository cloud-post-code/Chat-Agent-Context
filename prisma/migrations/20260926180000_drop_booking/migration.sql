-- Booking, services, the menu and orders are removed from the product, and
-- their tables go with the code: AppointmentField / Appointment (the booking
-- form and the bookings taken through it), Service / StaffMember /
-- BookingLocation / BookingSettings (the booking model), MenuItem / Order
-- (the menu card and the cart's checkout) and Profile.bookingEnabled (the
-- switch). Destructive by design: existing rows are dropped, not archived.
DROP TABLE IF EXISTS "Order";
DROP TABLE IF EXISTS "MenuItem";
DROP TABLE IF EXISTS "BookingSettings";
DROP TABLE IF EXISTS "BookingLocation";
DROP TABLE IF EXISTS "StaffMember";
DROP TABLE IF EXISTS "Service";
DROP TABLE IF EXISTS "Appointment";
DROP TABLE IF EXISTS "AppointmentField";
ALTER TABLE "Profile" DROP COLUMN IF EXISTS "bookingEnabled";

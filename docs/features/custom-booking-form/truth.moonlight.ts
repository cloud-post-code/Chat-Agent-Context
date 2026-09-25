/**
 * What MoonLight Nails & Spa's own booking page asks, walked by hand on
 * 2026-09-21 (https://booking.gocheckin.net/v2/20986, linked as "Booking"
 * from https://moonlightnailsspabrighton.com). Nothing was submitted.
 *
 * Flow: Service (by category, priced, "Add more service") → Select Staff
 * ("Any available staff" or a name) → Select Date/Time (15-minute slots) →
 * "How do we say hello?": Full Name (*), Phone Number (*), Email,
 * Appointment Notes → agree to the cancellation policy → Book appointment.
 *
 * This is the yardstick the live cross-check (crosscheck.ts) scores a copied
 * form against; fixture.moonlight.ts is the same flow in miniature, as the
 * offline proofs replay it.
 */
export const MOONLIGHT = {
  site: "https://moonlightnailsspabrighton.com",
  bookingUrl: "https://booking.gocheckin.net/v2/20986",
  /** The menu headings, as the page writes them. */
  categories: [
    "Manicure", "PEDICURE", "ACRYLIC", "BUILDER GEL AND GEL X", "Dip NAILS",
    "ADDITIONAL SERVICES", "COLOR CHANGE GEL", "Design", "Take off", "Kid",
  ],
  /** A sample of rows to hold the menu to: name → the price the page shows. */
  prices: {
    "Basic Manicure": "$22.00",
    "Gel Manicure": "$35.00",
    "BASIC PEDICURE": "$36.00",
    "SPA PEDICURE": "$68.00",
    "Acrylic Short Nails full set": "$65.00",
    "Dip": "$50.00",
    "Take off Gel": "$10.00",
    "Kid Manicure": "$18.00",
  } as Record<string, string>,
  serviceCount: 63,
  /** Only visible after picking a service, so a single page read can't see them. */
  staff: ["Katherine", "Vivian", "Bao bao", "Trang", "Dan"],
  /** The step order the widget walks, in the flow's own kinds. */
  steps: ["service", "provider", "time", "questions", "review"],
  /** The questions screen, in on-screen order, with the required marks as shown. */
  fields: [
    { label: "Full Name", type: "short_text", required: true, role: "name" },
    { label: "Phone Number", type: "phone", required: true, role: "phone" },
    { label: "Email", type: "email", required: false, role: "email" },
    { label: "Appointment Notes", type: "long_text", required: false, role: "notes" },
    { label: "I agree to the cancellation policy", type: "waiver", required: true, role: "policy" },
  ],
  /** The provider screen offers "Any available staff" first. */
  anyStaffOffered: true,
} as const;

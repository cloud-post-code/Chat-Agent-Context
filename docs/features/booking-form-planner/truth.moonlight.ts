/**
 * What MoonLight Nails & Spa's own booking page asks, walked by hand on
 * 2026-09-21 (https://booking.gocheckin.net/v2/20986, linked as "Booking"
 * from https://moonlightnailsspabrighton.com). Nothing was submitted.
 *
 * Flow: Service (by category, priced, "Add more service") → Select Staff
 * ("Any available staff" or a name) → Select Date/Time (15-minute slots) →
 * "How do we say hello?": Full Name (*), Phone Number (*), Email,
 * Appointment Notes → agree to the cancellation policy → Book appointment.
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
  asks: {
    name: "required",
    phone: "required",
    email: "optional",
    notes: "optional",
    services: "pick several",
    staff: "pick one or any available",
  },
} as const;

/**
 * The extractor's answer for MoonLight, as the proof's scripted model returns
 * it: a slice of the menu, with the booking facts the live extractor reported
 * on 2026-09-21 (crosscheck.ts). Staff names are absent because the page only
 * lists them after a service is picked; what a single read does show is the
 * page's own line about a "preferred technician", which comes back as a
 * requirement.
 */
export const MOONLIGHT_EXTRACT = {
  services: [
    { name: "Gel manicure + removal", description: "", price: "$38.00", duration: "", category: "Manicure" },
    { name: "Basic Manicure", description: "", price: "$22.00", duration: "", category: "Manicure" },
    { name: "Gel Manicure", description: "", price: "$35.00", duration: "", category: "Manicure" },
    { name: "BASIC PEDICURE", description: "", price: "$36.00", duration: "", category: "PEDICURE" },
    { name: "SPA PEDICURE", description: "", price: "$68.00", duration: "", category: "PEDICURE" },
    { name: "Acrylic Short Nails full set", description: "", price: "$65.00", duration: "", category: "ACRYLIC" },
    { name: "Dip", description: "", price: "$50.00", duration: "", category: "Dip NAILS" },
    { name: "Take off Gel", description: "", price: "$10.00", duration: "", category: "Take off" },
    { name: "Kid Manicure", description: "", price: "$18.00", duration: "", category: "Kid" },
  ],
  booking: {
    takesAppointments: true,
    kind: "personal_service",
    staff: [],
    phone: "unknown",
    email: "unknown",
    notes: true,
    requirements: [{ label: "Preferred technician", type: "short_text", required: false, options: [] }],
  },
};

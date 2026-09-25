/**
 * Two real businesses, read on 2026-09-23, as the ground the proof holds the
 * card to. Nothing was submitted on either site.
 *
 * MoonLight: its gocheckin booking page (screenshot in the request) is a
 * Service / Staff tabbed form with a search box, category accordions
 * (Manicure open first), and one row per service showing the name and a
 * price like "$38.00" beside a pick control, "Add more service" below. No
 * photo, no duration, no description on any row. Prices come from the
 * booking-form-planner truth file so the two proofs share one source.
 *
 * Anthony's: a Wix one-pager. Bios for Anthony, Tina and Ed, each ending in
 * "TEXT <NAME> AT <number>"; "Text Us For an Appointment"; "Our Hours Vary";
 * 160 A Massachusetts Ave, Arlington, MA 02474; (781) 646-0990. No service
 * list, no price anywhere, no booking link, no form, no widget. The bios say
 * they cut hair and that Ed "specializes in beards and straight edge shaves".
 */
import { MOONLIGHT as PLANNER_MOONLIGHT } from "../booking-form-planner/truth.moonlight";

export const MOONLIGHT = {
  site: PLANNER_MOONLIGHT.site,
  bookingUrl: PLANNER_MOONLIGHT.bookingUrl,
  prices: PLANNER_MOONLIGHT.prices,
  /** What the booking page's own layout shows, per the screenshot. */
  form: {
    source: "booking_page",
    sections: true,
    pickMany: true,
    staffStep: true,
    search: true,
    shows: { price: true, duration: false, image: false, description: false },
  },
  /** Section order as the page lists them, for the slice below. */
  sectionOrder: ["Manicure", "PEDICURE", "ACRYLIC", "Dip NAILS", "Take off", "Kid"],
} as const;

/** The extractor's answer for MoonLight: the planner's recorded slice plus the form. */
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
    staffContacts: [],
    phone: "unknown",
    email: "unknown",
    notes: true,
    channels: ["online"],
    form: MOONLIGHT.form,
    requirements: [{ label: "Preferred technician", type: "short_text", required: false, options: [] }],
  },
};

export const ANTHONY = {
  site: "https://www.anthonysbarberstyling.com/",
  phone: "(781) 646-0990",
  address: "160 A Massachusetts Ave Arlington, MA 02474",
  staff: [
    { name: "Anthony", phone: "781-962-7881" },
    { name: "Tina", phone: "(781) 799-1545" },
    { name: "Ed", phone: "781-710-5918" },
  ],
  /** The page text the extractor is given, cut from the live page (bios shortened). */
  text: `HOME WHO WE ARE CLIENT REVIEWS INSTAGRAM TEXT FOR APPOINTMENT
Who We Are 25 Years on the Avenue
Anthony. Anthony has owned Anthony's Barber Styling for 25 years, and he's been cutting hair since he was a teenager. He is all about giving quality haircuts. TEXT ANTHONY 781-962-7881
Tina. Tina is a co-owner of the shop with her brother Anthony. Tina takes her time to give a quality haircut. She is especially good with styling kids of all ages. TEXT TINA AT (781) 799-1545
Ed. He specializes in beards and straight edge shaves. TEXT ED AT 781-710-5918
Reach Out. Text Us For an Appointment. Our Hours Vary. 160 A Massachusetts Ave Arlington, MA 02474 (781) 646-0990 ANTHONY TINA ED`,
} as const;

/** The extractor's answer for Anthony's: only what the text states. */
export const ANTHONY_EXTRACT = {
  services: [
    { name: "Haircut", description: "Quality haircuts; styling for kids of all ages.", price: "", duration: "", category: "" },
    { name: "Beard and straight edge shave", description: "", price: "", duration: "", category: "" },
  ],
  booking: {
    takesAppointments: true,
    kind: "personal_service",
    staff: ["Anthony", "Tina", "Ed"],
    staffContacts: ANTHONY.staff.map((s) => ({ name: s.name, phone: s.phone })),
    phone: "unknown",
    email: "unknown",
    notes: false,
    channels: ["text"],
    form: null,
    requirements: [],
  },
};

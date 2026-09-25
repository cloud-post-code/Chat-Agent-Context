/**
 * The four screens the fake widget (reader.html) renders — MoonLight Nails'
 * GoCheckIn flow in miniature (see docs/features/booking-form-planner/
 * truth.moonlight.ts for the real one) — as the reader snapshots them, and
 * the FormSpec the transcriber is expected to return for that snapshot.
 * Written by hand: the proof holds the reader and the sanitizer to it.
 */
import type { FormSnapshot } from "../../../lib/onboarding/formReader";
import type { FormSpec } from "../../../lib/onboarding/formTranscribe";

export const MOONLIGHT_URL = "https://booking.gocheckin.net/v2/20986";

export const MOONLIGHT_POLICY =
  "Cancellation policy: Please give us at least 24 hours notice if you need to cancel or reschedule. Appointments cancelled with less than 24 hours notice or no-shows may be charged 50% of the service price.";

export const MOONLIGHT_SERVICES = [
  "Basic Manicure",
  "Gel Manicure",
  "Gel manicure + removal",
  "BASIC PEDICURE",
  "SPA PEDICURE",
  "Kid Pedicure",
];

export const MOONLIGHT_STAFF = ["Any available staff", "Katherine", "Vivian"];

export const MOONLIGHT_SNAPSHOT: FormSnapshot = {
  url: MOONLIGHT_URL,
  how: "playwright",
  truncated: false,
  screens: [
    {
      index: 1,
      url: MOONLIGHT_URL,
      headings: ["Select Service", "Manicure", "PEDICURE"],
      elements: [
        { tag: "tile_list", label: "Manicure", required: false, options: ["Basic Manicure $22.00", "Gel Manicure $35.00", "Gel manicure + removal $38.00"] },
        { tag: "tile_list", label: "PEDICURE", required: false, options: ["BASIC PEDICURE $36.00", "SPA PEDICURE $68.00", "Kid Pedicure $25.00"] },
        { tag: "button", label: "Next", required: false, disabled: true },
      ],
      text: "Select Service Manicure Basic Manicure $22.00 Gel Manicure $35.00 Gel manicure + removal $38.00 PEDICURE BASIC PEDICURE $36.00 SPA PEDICURE $68.00 Kid Pedicure $25.00 Next",
    },
    {
      index: 2,
      url: MOONLIGHT_URL,
      headings: ["Select Staff"],
      elements: [
        { tag: "tile_list", label: "Select Staff", required: false, options: MOONLIGHT_STAFF },
        { tag: "button", label: "Next", required: false, disabled: true },
      ],
      text: "Select Staff Any available staff Katherine Vivian Next",
    },
    {
      index: 3,
      url: MOONLIGHT_URL,
      headings: ["Select Date/Time"],
      elements: [{ tag: "button", label: "Continue", required: false, disabled: true }],
      text: "Select Date/Time 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 Continue",
    },
    {
      index: 4,
      url: MOONLIGHT_URL,
      headings: ["How do we say hello?"],
      elements: [
        { tag: "input", label: "Full Name", inputType: "text", required: true },
        { tag: "input", label: "Phone Number", inputType: "tel", required: true, placeholder: "(555) 555-5555" },
        { tag: "input", label: "Email", inputType: "email", required: false },
        { tag: "textarea", label: "Appointment Notes", required: false },
        { tag: "checkbox", label: "I agree to the cancellation policy", inputType: "checkbox", required: true },
        { tag: "button", label: "Book appointment", required: false },
      ],
      text: `How do we say hello? Full Name * Phone Number * Email Appointment Notes ${MOONLIGHT_POLICY} I agree to the cancellation policy Book appointment`,
    },
  ],
};

/** What the model is expected to return for MOONLIGHT_SNAPSHOT — verbatim, nothing added or dropped. */
export const MOONLIGHT_SPEC: FormSpec = {
  found: true,
  steps: [
    { kind: "service", title: "Select Service", screen: 1 },
    { kind: "provider", title: "Select Staff", screen: 2 },
    { kind: "time", title: "Select Date/Time", screen: 3 },
    { kind: "questions", title: "How do we say hello?", screen: 4 },
    { kind: "review", title: "How do we say hello?", screen: 4 },
  ],
  fields: [
    { label: "Full Name", type: "short_text", required: true, options: [], allowOther: false, role: "name", screen: 4, placeholder: "", help: "" },
    { label: "Phone Number", type: "phone", required: true, options: [], allowOther: false, role: "phone", screen: 4, placeholder: "(555) 555-5555", help: "" },
    { label: "Email", type: "email", required: false, options: [], allowOther: false, role: "email", screen: 4, placeholder: "", help: "" },
    { label: "Appointment Notes", type: "long_text", required: false, options: [], allowOther: false, role: "notes", screen: 4, placeholder: "", help: "" },
    { label: "I agree to the cancellation policy", type: "waiver", required: true, options: [], allowOther: false, role: "policy", screen: 4, placeholder: "", help: "", text: MOONLIGHT_POLICY },
  ],
  services: MOONLIGHT_SERVICES,
  staff: MOONLIGHT_STAFF,
  anyStaffOffered: true,
};

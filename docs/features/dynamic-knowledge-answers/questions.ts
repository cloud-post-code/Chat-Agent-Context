/**
 * The agent answer test set: a fictional salon's knowledge base plus the
 * questions a real visitor asks about it, in the sloppy words they use.
 *
 * `context` lists facts the system prompt MUST carry for the question — checked
 * offline by proof.ts, so a retrieval regression fails without a model call.
 * `answer` lists what a good spoken answer contains — checked only by
 * `proof.ts --live`, which runs the real model.
 */

export const BUSINESS = {
  company: "Proofline Nails & Spa",
  phone: "(555) 010-4294",
  hours: "Mon-Sat 9:30 am-7:00 pm, Sun 11 am-7 pm",
  address: "12 Proof St, Testville, MA",
};

/** One entry per chunk, exactly the shape lib/onboarding/services.ts saves. */
export const SERVICES: string[] = [
  "Classic Manicure. $22",
  "Gel Manicure. $38",
  "Deluxe Spa Manicure. $45",
  "Classic Pedicure. $35",
  "Gel Pedicure. $50",
  "Deluxe Spa Pedicure. $85",
  "Gel Add On. $15",
  "Callus Treatment Add On. $10",
  "Acrylic Short Nails Full Set. $65",
  "Acrylic Medium Nails Full Set. $70",
  "Acrylic Long Nails Full Set. $75",
  "Rebalance (Fill-In). $55",
  "Full Set Gel X Short. $70",
  "Full Set Gel X Medium. $75",
  "Full Set Gel X Long. $80",
  "Fill Gel X. $65",
  "Manicure Add On. $10",
  "Poly Gel Full Set. $75",
  "Poly Gel Refill. $65",
  "Builder Gel In Natural Nail. $65",
  "Fill Builder Gel With Gel Color Add-On. $60",
  "Dipping With Tip + No Take Off. $60",
  "Dipping With Tip + Take Off. $65",
  "Dip. $50",
  "Dip + Take Off. $55",
  "Dipping Manicure Add On. $8",
  "French Tip. $10",
  "Nail Art Per Nail. $5",
  "Chrome Finish. $15",
  "Polish Change Hands. $12",
  "Polish Change Feet. $15",
  "Color Change Gel Hands. $25",
  "Color Change Gel Feet. $30",
  "Soak Off Removal. $10",
  "Nail Repair. $5",
  "Paraffin Wax Treatment. $12",
  "Kids Manicure. $15",
  "Kids Pedicure. $25",
  "Eyebrow Wax. $12",
  "Lip Wax. $8",
];

/** Everything else the crawl found — the noise the menu has to be found in. */
export const OTHER_SOURCES: { title: string; url: string; pieces: string[] }[] = [
  {
    title: "About Us",
    url: "https://proofline.example/about",
    pieces: [
      "Proofline Nails & Spa is a family-run studio. We offer a full range of nail and spa " +
        "care, and we stay on top of trends and techniques so your designs stand out.",
      "Health matters to us. We use single-use buffers and files for every client, and metal " +
        "implements are sterilized in a medical-grade autoclave between visits.",
    ],
  },
  {
    title: "Gallery",
    url: "https://proofline.example/gallery",
    pieces: [
      "Lovely nail collection: hand-painted delicate florals, jeweled embellishments, glitter " +
        "accents, marble patterns, ombre gradients and metallic details.",
    ],
  },
  {
    title: "Coupons",
    url: "https://proofline.example/coupons",
    pieces: [
      "New clients take 10% off any full set on their first visit. Mention the website coupon " +
        "at checkout. Cannot be combined with other offers.",
    ],
  },
  {
    title: "Policies",
    url: "https://proofline.example/policies",
    pieces: [
      "Walk-ins are welcome but appointments are seated first. Please give 24 hours notice to " +
        "cancel. We accept cash and all major cards. Parking is free behind the building.",
    ],
  },
  {
    title: "Blog: Caring for gel nails",
    url: "https://proofline.example/blog/gel-care",
    pieces: [
      "Gel polish lasts two to three weeks with care. Wear gloves when cleaning, use cuticle " +
        "oil daily, and never peel the gel off — book a soak off removal instead.",
      "Builder gel adds strength to natural nails and suits clients who want length without " +
        "acrylic. Most clients come back for a fill every three weeks.",
    ],
  },
];

export type TestQuestion = {
  q: string;
  /** Why this question is in the set — the failure it guards. */
  guards: string;
  /** Facts the system prompt must contain (offline). */
  context: string[];
  /** Fragments a good live answer contains (--live only). */
  answer: string[];
};

export const QUESTIONS: TestQuestion[] = [
  {
    q: "show me all services and prices",
    guards: "the recorded failure: the whole menu exists but the agent said it had no price list",
    context: ["Classic Manicure. $22", "Deluxe Spa Pedicure. $85", "Dip. $50", "Lip Wax. $8"],
    answer: ["$22", "$85", "$50"],
  },
  {
    q: "What do you offer",
    guards: "a question sharing no words with any menu item",
    context: ["Classic Manicure. $22", "Acrylic Short Nails Full Set. $65"],
    answer: ["anicure", "edicure"],
  },
  {
    q: "Can I do mani pedi combo for less",
    guards: "the recorded failure: slang (mani/pedi) and an unlisted combo — should quote both prices",
    context: ["Classic Manicure. $22", "Classic Pedicure. $35"],
    answer: ["$22", "$35"],
  },
  {
    q: "how much for a gel x full set?",
    guards: "a specific item among near-identical neighbors",
    context: ["Full Set Gel X Short. $70", "Full Set Gel X Long. $80"],
    answer: ["$70", "$80"],
  },
  {
    q: "whats the cheapest pedicure",
    guards: "a comparison needs every pedicure row, not the top-scoring one",
    context: ["Classic Pedicure. $35", "Kids Pedicure. $25", "Gel Pedicure. $50"],
    // The adult answer; naming the $25 kids pedicure as well is fine, not required.
    answer: ["$35"],
  },
  {
    q: "pricing for acrylics",
    guards: "plural and -ing forms (acrylics/acrylic, pricing/price)",
    context: ["Acrylic Short Nails Full Set. $65", "Acrylic Long Nails Full Set. $75"],
    answer: ["$65", "$75"],
  },
  {
    q: "how much is a fill",
    guards: "a word that only appears inside a hyphenated token (Fill-In)",
    context: ["Rebalance (Fill-In). $55", "Fill Gel X. $65"],
    answer: ["$55"],
  },
  {
    q: "do you do dip powder?",
    guards: "a product name the menu spells differently (Dip / Dipping)",
    context: ["Dip. $50", "Dipping With Tip + Take Off. $65"],
    answer: ["$50"],
  },
  {
    q: "do you take care of calluses",
    guards: "plural of a word the menu has once",
    context: ["Callus Treatment Add On. $10"],
    answer: ["$10"],
  },
  {
    q: "do you wax eyebrows",
    guards: "a non-nail service buried at the end of the menu",
    context: ["Eyebrow Wax. $12"],
    answer: ["$12"],
  },
  {
    q: "how do you keep your tools clean?",
    guards: "a non-menu fact must still win over the menu",
    context: ["single-use buffers and files", "autoclave"],
    answer: ["autoclave"],
  },
  {
    q: "any deals for first time customers?",
    guards: "coupon page, asked without the word coupon",
    context: ["10% off any full set"],
    answer: ["10%"],
  },
  {
    q: "are you open on sundays",
    guards: "profile facts (hours) stay in the prompt for every question",
    context: [BUSINESS.hours],
    answer: ["11"],
  },
  {
    q: "is there parking",
    guards: "a one-word topic inside a policies paragraph",
    context: ["Parking is free behind the building"],
    answer: ["free"],
  },
];

/** A live answer containing one of these dodged a question the knowledge covers. */
export const DEFLECTIONS: RegExp[] = [
  /don['’]t have (the |a |any )?(complete|full|specific|detailed|exact)/i,
  /(isn['’]t|not) (listed|something i have)/i,
  /i['’]m not sure/i,
];

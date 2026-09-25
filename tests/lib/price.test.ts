import { describe, expect, it } from "vitest";
import { priceAmount, durationMinutes } from "@/lib/appointmentTypes";
import { parsePrice, formatMoney as menuFormatMoney } from "@/lib/menuTypes";
import { priceFromText, durationFromText } from "@/lib/serviceCatalog";
import { priceAmountFromLabel } from "@/lib/serviceIndex";
import { pricingFromText, formatMoney as bookingFormatMoney } from "@/lib/booking/types";

/**
 * Pin: the codebase carries several price/duration/money parsers that grew
 * up separately (see docs/features/cleanup — Phase 2 merges them). This table
 * records what each one returns TODAY for the same inputs, so merging them is
 * a no-behaviour-change refactor and any disagreement is a decision, not an
 * accident. Update the snapshot only when a behaviour change is intended.
 */
const PRICE_INPUTS = [
  "", "35", "$35", "$35.50", "$40+", "+$40", "from $25", "From $25", "starting at $30", "$30-$45", "$30–$45",
  "$30 to $45", "$60/hr", "$60 per hour", "$12 per person", "$12/person", "£25", "€18", "Free", "free!",
  "Call for a quote", "Varies", "Price: $99", "$1,200", "USD 50", "50 USD", "$0", "$5 and up", "Gel manicure $45 (60 min)",
  "two for $20",
];
const DURATION_INPUTS = ["", "30", "30 min", "30 minutes", "1 hr", "1 hour", "1.5 hours", "1 hr 30 min", "90m", "2h", "45-60 min", "about an hour", "Gel manicure $45 (60 min)"];

describe("price parsers (pinned)", () => {
  it("agree or disagree per input, as recorded", () => {
    const table = PRICE_INPUTS.map((input) => ({
      input,
      priceAmount: priceAmount(input),
      parsePrice: parsePrice(input),
      priceFromText: priceFromText(input),
      priceAmountFromLabel: priceAmountFromLabel(input),
      pricingFromText: pricingFromText(input),
    }));
    expect(table).toMatchSnapshot();
  });
});

describe("duration parsers (pinned)", () => {
  it("record their current outputs", () => {
    const table = DURATION_INPUTS.map((input) => ({ input, durationMinutes: durationMinutes(input), durationFromText: durationFromText(input) }));
    expect(table).toMatchSnapshot();
  });
});

describe("money formatters (pinned)", () => {
  it("record their current outputs", () => {
    const amounts = [0, 5, 5.5, 12.345, 1200, -3];
    expect({
      menu: amounts.map((a) => [a, menuFormatMoney(a, "$"), menuFormatMoney(a, "£")]),
      booking: amounts.map((a) => [a, bookingFormatMoney(a), bookingFormatMoney(a, "GBP"), bookingFormatMoney(a, "EUR")]),
    }).toMatchSnapshot();
  });
});

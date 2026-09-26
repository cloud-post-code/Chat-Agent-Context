import { describe, expect, it } from "vitest";
import { parseHoursText, weeklyHoursFrom } from "@/lib/booking/hours";

describe("parseHoursText", () => {
  it("reads the short a / p suffixes a salon writes", () => {
    expect(parseHoursText("9:30a – 6p")).toEqual([{ start: "09:30", end: "18:00" }]);
    expect(parseHoursText("9a-5p")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(parseHoursText("9 a.m. - 5 p.m.")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(parseHoursText("12p – 8p")).toEqual([{ start: "12:00", end: "20:00" }]);
  });
  it("still reads the long forms and bare ranges", () => {
    expect(parseHoursText("9 AM–7 PM")).toEqual([{ start: "09:00", end: "19:00" }]);
    expect(parseHoursText("09:00-17:00")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(parseHoursText("9 - 5")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(parseHoursText("Closed")).toEqual([]);
  });
  it("skips a day range written in front of the times", () => {
    expect(parseHoursText("Tues. – Sat., 9:30a – 6p")).toEqual([{ start: "09:30", end: "18:00" }]);
  });
  it("refuses what isn't a time", () => {
    expect(parseHoursText("9:30x – 6p")).toEqual([]);
    expect(parseHoursText("13pm - 5pm")).toEqual([]);
  });
});

describe("weeklyHoursFrom", () => {
  it("keeps a week whose only stated days use the short suffixes", () => {
    const week = weeklyHoursFrom({ tuesday: "9:30a – 6p", saturday: "9:30a – 6p" });
    expect(week?.tue).toEqual([{ start: "09:30", end: "18:00" }]);
    expect(week?.mon).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { capTags, flat, slugify, str } from "@/lib/util/text";
import { parsePrice, priceAmountOf } from "@/lib/util/money";
import { durationMinutes } from "@/lib/util/duration";
import { sniffImageType } from "@/lib/util/images";

describe("text helpers", () => {
  it("str trims, caps and rejects non-strings", () => {
    expect(str("  hi there  ", 4)).toBe("hi t");
    expect(str("  hi ")).toBe("hi");
    expect(str(42, 10)).toBe("");
    expect(str(null)).toBe("");
  });
  it("flat also collapses internal whitespace", () => {
    expect(flat("  a \n\n b\tc ", 100)).toBe("a b c");
    expect(flat(["x"], 5)).toBe("");
  });
  it("slugify strips accents, dashes runs, and never ends in a dash", () => {
    expect(slugify("Café Déjà Vu!")).toBe("cafe-deja-vu");
    expect(slugify("  --Hello   World--  ")).toBe("hello-world");
    expect(slugify("abcdefghij-klmnop", 11)).toBe("abcdefghij");
    expect(slugify("!!!")).toBe("");
  });
  it("capTags lowercases, dedupes and caps", () => {
    expect(capTags([" Red ", "red", "Gel", 3, "", "nails"])).toEqual(["red", "gel", "nails"]);
    expect(capTags("nope")).toEqual([]);
    expect(capTags(Array.from({ length: 12 }, (_, i) => `t${i}`), 3)).toHaveLength(3);
  });
});

describe("money and duration", () => {
  it("parsePrice reads amount, exactness and symbol", () => {
    expect(parsePrice("$35")).toEqual({ amount: 35, exact: true, symbol: "$" });
    expect(parsePrice("$40+")).toMatchObject({ amount: 40, exact: false });
    expect(parsePrice("+$5")).toMatchObject({ amount: 5, exact: true });
    expect(parsePrice("$1,200")).toMatchObject({ amount: 1200 });
    expect(parsePrice("Free")).toEqual({ amount: 0, exact: true, symbol: "" });
    expect(parsePrice("call us")).toBeNull();
    expect(priceAmountOf("from £25")).toBe(25);
    expect(priceAmountOf("")).toBeNull();
  });
  it("durationMinutes", () => {
    expect(durationMinutes("45 min")).toBe(45);
    expect(durationMinutes("1h 30m")).toBe(90);
    expect(durationMinutes("1.5 hours")).toBe(90);
    expect(durationMinutes("soon")).toBeNull();
  });
});

describe("sniffImageType", () => {
  const withMagic = (bytes: number[]) => Buffer.from([...bytes, ...new Array(12).fill(0)]);
  it("reads the magic number", () => {
    expect(sniffImageType(withMagic([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(sniffImageType(withMagic([0x89, 0x50, 0x4e]))).toBe("image/png");
    expect(sniffImageType(withMagic([0x47, 0x49, 0x46]))).toBe("image/gif");
    expect(sniffImageType(Buffer.from("RIFF0000WEBP"))).toBe("image/webp");
    expect(sniffImageType(Buffer.from("hello world!"))).toBeNull();
    expect(sniffImageType(Buffer.from("x"))).toBeNull();
  });
});

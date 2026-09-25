import { describe, expect, it } from "vitest";
import { plainUserAgent, summarizeDiag, type PageDiag } from "@/lib/onboarding/crawl";

describe("plainUserAgent", () => {
  it("drops only the Headless mark, keeping version and platform", () => {
    const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.7922.34 Safari/537.36";
    expect(plainUserAgent(ua)).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36",
    );
  });
  it("leaves a user agent without the mark alone", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
    expect(plainUserAgent(ua)).toBe(ua);
  });
});

describe("summarizeDiag", () => {
  const diag = (over: Partial<PageDiag> = {}): PageDiag => ({ blocked: new Map(), failed: [], errors: [], ...over });

  it("is empty when nothing went wrong", () => {
    expect(summarizeDiag(diag())).toBe("");
  });
  it("counts the guard's refusals by host and names the failures", () => {
    const d = diag({
      blocked: new Map([["api.example.dev", 3], ["cdn.example.dev", 1]]),
      failed: ["403 api.example.dev/v2/business", "net::ERR_CONNECTION_RESET api.example.dev/v2/staff"],
      errors: ["TypeError: x is undefined"],
    });
    expect(summarizeDiag(d)).toBe(
      "4 requests refused by the network guard (api.example.dev, cdn.example.dev) · " +
        "2 failed: 403 api.example.dev/v2/business; net::ERR_CONNECTION_RESET api.example.dev/v2/staff · " +
        "script error: TypeError: x is undefined",
    );
  });
  it("uses the singular for one refusal and shows at most three failures", () => {
    const d = diag({ blocked: new Map([["a.dev", 1]]), failed: ["500 a", "500 b", "500 c", "500 d"] });
    expect(summarizeDiag(d)).toBe("1 request refused by the network guard (a.dev) · 4 failed: 500 a; 500 b; 500 c");
  });
});

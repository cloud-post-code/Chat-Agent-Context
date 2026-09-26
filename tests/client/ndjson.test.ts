import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/client/ndjson";

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

describe("readNdjson", () => {
  it("dispatches one event per line even when a chunk splits a line", async () => {
    const events: unknown[] = [];
    let chunks = 0;
    await readNdjson(stream(['{"t":"text","v":"He', 'llo"}\n{"t":"card","v":{"type":"cart"}}\n', '{"t":"text","v":"!"}']), (e) => events.push(e), () => chunks++);
    expect(events).toEqual([{ t: "text", v: "Hello" }, { t: "card", v: { type: "cart" } }, { t: "text", v: "!" }]);
    // Three chunks, plus one repaint for the trailing line that had no newline.
    expect(chunks).toBe(4);
  });
  it("skips blank and malformed lines and propagates handler errors", async () => {
    const events: unknown[] = [];
    await readNdjson(stream(['\n{bad json}\n{"t":"ok"}\n\n']), (e) => events.push(e));
    expect(events).toEqual([{ t: "ok" }]);
    await expect(readNdjson(stream(['{"t":"error","v":"boom"}\n']), () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});

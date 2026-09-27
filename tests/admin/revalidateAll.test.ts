import { describe, expect, it, vi } from "vitest";

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn() }));
vi.mock("@/lib/retrieval/indexer", () => ({ indexSource: vi.fn() }));

import { revalidateAll } from "@/app/admin/actions/_shared";

// Regression: the actions split (fffc5e5) rewrote the dashboard revalidation as
// a call to revalidateAll itself, so every admin save overflowed the stack in
// production ("Maximum call stack size exceeded", digest 944680955).
describe("revalidateAll", () => {
  it("revalidates the dashboard, the chat and the public page, and returns", () => {
    expect(() => revalidateAll()).not.toThrow();
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(["/admin/dashboard", "/admin/chat", "/"]);
  });
});

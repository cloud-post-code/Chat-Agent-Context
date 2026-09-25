import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Pure tests only: no database, no model, no network. Anything that needs
 * those is a proof script under docs/features/<id>/ run by `npm run crosscheck`.
 * tests/setup.ts makes @/lib/db throw on use so a test can't reach Postgres
 * by accident.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "lib/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    clearMocks: true,
  },
});

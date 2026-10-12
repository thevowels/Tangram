import { defineConfig } from "vitest/config";

// Separate from vite.config.ts: the Cloudflare plugin isn't needed for pure unit tests.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});

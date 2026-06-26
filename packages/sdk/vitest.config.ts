import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Match every other glyph pkg: forks isolate per-file so a native
    // binding crash in one spec can't cascade across the suite.
    pool: "forks",
    // The browser-bundle probe shells out to `vite build`, which is
    // slower than a unit test; give the suite generous headroom.
    testTimeout: 60_000,
  },
});

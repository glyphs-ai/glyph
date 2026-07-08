import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Forks, not threads. libsql's native binding requires process-level
    // isolation on Windows. Match every other glyph pkg.
    pool: "forks",
  },
});

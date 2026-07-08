import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Forks, not threads. libsql's native binding requires process-level
    // isolation on Windows. Match every other glyph pkg.
    // on Windows when the worker thread tears down (exit code 3221225477 =
    // 0xC0000005 access violation). Forks let each test file's process
    // exit cleanly without poisoning the parent runner.
    pool: "forks",
    testTimeout: 15000,
  },
});
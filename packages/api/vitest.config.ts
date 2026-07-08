import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Forks isolate per-file with a separate process, matching every
    // other glyph package. Required to prevent cascading failures on
    // pnpm-r runs when a single test file crashes.
    pool: "forks",
    // Windows CI runners need extra time for afterEach hooks that
    // close libsql clients and remove temp directories — WAL file
    // locks are released asynchronously on NTFS.
    hookTimeout: 30_000,
  },
});

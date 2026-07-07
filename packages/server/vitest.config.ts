import { defineConfig } from "vitest/config";

// `pool: "forks"` (not threads) -- the test suite opens real SQLite
// handles (`:memory:` Drizzle dbs in `_test-support.ts`) and the
// workspace registry's per-instance state would race across thread-pool
// workers sharing one process. Each fork gets its own module graph and
// its own SQLite ABI, which is what the tests assume.

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
    pool: "forks",
    testTimeout: 15000,
    // Windows CI: libsql WAL-mode checkpoint + NTFS deferred lock
    // release make teardown (module drain → client.close → rm) slower
    // than on Unix; 60s gives ample headroom for the heaviest tests.
    hookTimeout: 60_000,
  },
});

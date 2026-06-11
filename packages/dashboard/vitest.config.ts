import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * Vitest config for the dashboard package — distinct from `vite.config.ts`
 * so the dev/build server config isn't loaded for unit tests.
 *
 * `happy-dom` is the lightweight DOM env (vs jsdom) — sufficient for
 * the React Testing Library snapshots used by the viewer/ArtifactsTab
 * suites.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDom: {
        // Sentinel non-listening host — any stub-miss in the global
        // `fetch` setup (see ./vitest.setup.ts) fails fast on URL
        // semantics rather than DNS / TCP retries. The previous
        // `happy-dom` default of `http://localhost:3000/` caused
        // ECONNREFUSED ::1:3000 flakes on macOS and Windows CI legs
        // when a polling hook fired before the suite's own fetch
        // mock was installed.
        url: "http://test.invalid/",
      },
    },
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    include: ["test/**/*.test.{ts,tsx}"],
  },
});

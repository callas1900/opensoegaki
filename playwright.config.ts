import { defineConfig } from "@playwright/test";

// e2e smoke suite (TASK-39): a real-iPhone-viewport regression check for
// UI-layout bugs that unit tests (jsdom-less, environment: "node" —
// see vitest.config.ts) can never catch: overflow against a fixed-size
// container, and global resize/scroll listeners misfiring on the iOS soft
// keyboard. Runs against the same `dist-web`/`preview:web` build a real
// device test would use (see docs/WEB.md's preview:web caveat) — CI runs
// `pnpm build:web` before `pnpm test:e2e`; locally, run the same two
// commands yourself so this isn't testing stale output.
const PORT = 4173;
// vite.config.web.ts's `base` defaults to "/opensoegaki/"; preview serves
// the build at that same path, so tests must navigate under it too.
const BASE_URL = `http://localhost:${PORT}/opensoegaki/`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    {
      name: "iphone-webkit",
      use: {
        browserName: "webkit",
        // iPhone-14-like context, spelled out explicitly rather than a
        // bundled `devices[]` preset so these dimensions stay pinned
        // regardless of future Playwright device-list changes.
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: `pnpm preview:web -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

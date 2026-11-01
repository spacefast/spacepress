import { defineConfig } from "@playwright/test";

// The built site (dist/), served as static files under the same SITE_BASE it was built with: what
// visitors get, at the root or as a GitHub Pages project site.
const base = (process.env.SITE_BASE ?? "/").replace(/\/+$/, "");

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:4321${base}/` },
  webServer: {
    command: "node scripts/serve-dist.mjs",
    env: { PORT: "4321", SITE_BASE: base || "/" },
    url: `http://127.0.0.1:4321${base}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

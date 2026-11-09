import { defineConfig } from "@playwright/test";

// The built site (dist/), served as static files: what visitors get.
const base = "";

export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:4321${base}/` },
  webServer: {
    command: "node scripts/serve-dist.mjs",
    env: { PORT: "4321" },
    url: `http://127.0.0.1:4321${base}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

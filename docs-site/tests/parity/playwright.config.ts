import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The parity suite (tests/parity/parity.spec.ts). It reads the built site, served as static files the
// way GitHub Pages serves it, from PARITY_DIST (default: dist/). With PARITY_BASE_URL it reads a
// deployed site instead and starts no server.
const here = path.dirname(fileURLToPath(import.meta.url));
// A base URL is a directory: every path the suite asks for is relative to it.
const deployed = process.env.PARITY_BASE_URL?.replace(/\/?$/, "/");
const port = 4322;

export default defineConfig({
	testDir: here,
	testMatch: "parity.spec.ts",
	fullyParallel: true,
	forbidOnly: true,
	reporter: "list",
	use: { baseURL: deployed ?? `http://127.0.0.1:${port}/` },
	webServer: deployed
		? undefined
		: {
				command: "node scripts/serve-dist.mjs",
				cwd: path.resolve(here, "../.."),
				env: { PORT: String(port), DIST: path.resolve(process.env.PARITY_DIST ?? path.resolve(here, "../../dist")) },
				url: `http://127.0.0.1:${port}/`,
				reuseExistingServer: false,
				timeout: 60_000,
			},
	projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});

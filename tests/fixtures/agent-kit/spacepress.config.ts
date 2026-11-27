// The project `spacepress mcp` is driven against (tests/cli.rs): kinds, an action, a job, pages and an
// HTTP route, each registered from its export, with a global and a file bucket exported here.
import { defineConfig, global, files, f } from "spacepress";

export const settings = global({ storeName: f.text().default("Corner shop"), open: f.boolean().default(true) }, { access: { read: "anyone", update: "admin" } });
export const receipts = files({ accept: ["application/pdf"], maxBytes: 5_000_000, access: { read: "owner", delete: "editor" } });

export default defineConfig({
  name: "agentkit",
});

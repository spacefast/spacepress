// The project `first mcp` is driven against (tests/cli.rs): kinds, an action, a job, pages and an
// HTTP route, each registered from its export; a global, a file bucket and a hook from the config.
import { defineConfig, global, files, text, boolean } from "first";

const settings = global("settings", { storeName: text().default("Corner shop"), open: boolean().default(true) }, { access: { read: "anyone", update: "admin" } });

export default defineConfig({
  name: "agentkit",
  globals: { settings },
  files: { receipts: files("receipts", { accept: ["application/pdf"], maxBytes: 5_000_000, access: { read: "owner", delete: "editor" } }) },
  hooks: {
    shoppingList: {
      beforeCreate: (data) => {
        data.name = data.name.trim();
      },
    },
  },
});

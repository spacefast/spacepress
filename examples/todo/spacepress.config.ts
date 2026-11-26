import { defineConfig } from "spacepress";

export default defineConfig({
  name: "todo",
  // Seed starter GTD/PARA buckets and tasks from content/ on first boot.
  seed: true,
  retention: { deleted: "forever", revisions: "forever" },
  xmlrpc: false,
  pings: false,
});

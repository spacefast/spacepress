import { defineConfig, env } from "spacepress";

export default defineConfig({
  name: "astro-fixture",
  permalinks: { notes: "/notes/[slug]" },
  // Every write to notes is POSTed, signed, to the Astro site's receiver.
  webhooks: [{ url: env("ASTRO_HOOK_URL"), secret: env("ASTRO_HOOK_SECRET"), events: ["notes.created", "notes.updated", "notes.deleted"] }],
});

// Prebuilt pages next to server-rendered ones (docs/decisions/2026-11-13-static-output.md): /about and
// each note are prebuilt; / and /live render per request.
import { defineConfig, collection, f } from "spacepress";

export const notes = collection({
  title: f.text(),
  slug: f.slug({ source: "title" }),
  // Stored as post meta, not a core post field: an edit to it reaches no core post hook.
  summary: f.text().optional(),
}, { title: "title", access: { read: (ctx) => (ctx.user ? true : { status: "published" }), create: "editor", update: "editor", delete: "editor" } });

export default defineConfig({ name: "prebuilt" });
